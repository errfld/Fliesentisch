"use client";

import { useEffect, useState } from "react";
import { DisconnectReason, Room, RoomEvent } from "livekit-client";
import type { GameRole } from "@/features/room-session/types";
import {
  areSetsEqual,
  formatConnectionError,
  resolveLivekitUrl
} from "@/features/room-session/lib/session-helpers";

type UseRoomConnectionInput = {
  roomName: string;
  displayName: string;
};

const DISCONNECT_MESSAGES: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the room.",
  [DisconnectReason.ROOM_DELETED]: "The room was deleted.",
  [DisconnectReason.SERVER_SHUTDOWN]: "Server is shutting down.",
  [DisconnectReason.STATE_MISMATCH]: "Connection state went out of sync.",
  [DisconnectReason.JOIN_FAILURE]: "Failed to join the room."
};

export function useRoomConnection({ roomName, displayName }: UseRoomConnectionInput) {
  const [gameRole, setGameRole] = useState<GameRole | undefined>(undefined);
  const [token, setToken] = useState("");
  const [identity, setIdentity] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());

  const livekitUrl = resolveLivekitUrl();

  useEffect(() => {
    if (!displayName.trim()) {
      setGameRole(undefined);
      setToken("");
      setIdentity("");
      setRoom(null);
      setActiveSpeakers(new Set());
      setError("Display name cannot be empty");
      setIsConnecting(false);
      return;
    }

    const controller = new AbortController();
    setGameRole(undefined);
    setToken("");
    setIdentity("");
    setIsConnecting(true);
    setError(null);

    const fetchToken = async () => {
      try {
        const response = await fetch("/api/v1/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            room: roomName,
            name: displayName
          }),
          credentials: "include",
          signal: controller.signal
        });

        const body = await response.json();
        if (!response.ok) {
          const code = body?.error?.code ?? "TOKEN_REQUEST_FAILED";
          const message = body?.error?.message ?? "Failed to fetch access token";
          throw new Error(`${code}: ${message}`);
        }

        setGameRole(normalizeGameRole(body?.game_role));
        setIdentity(body.identity ?? "");
        setToken(body.token);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        setError(err instanceof Error ? err.message : "Failed to fetch access token");
        setIsConnecting(false);
      }
    };

    void fetchToken();

    return () => controller.abort();
  }, [displayName, roomName]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    const livekitRoom = new Room({ adaptiveStream: true, dynacast: true });

    const connect = async () => {
      try {
        setIsConnecting(true);
        setError(null);
        await livekitRoom.connect(livekitUrl, token);

        if (cancelled) {
          livekitRoom.disconnect();
          return;
        }

        setRoom(livekitRoom);
        setIsConnecting(false);
      } catch (err) {
        livekitRoom.disconnect();
        setRoom(null);
        setError(formatConnectionError(err, "Failed to connect to LiveKit"));
        setIsConnecting(false);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      livekitRoom.disconnect();
      setRoom(null);
      setActiveSpeakers(new Set());
    };
  }, [livekitUrl, token]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const refresh = () => setRenderVersion((current) => current + 1);
    const onDisconnected = (reason?: DisconnectReason) => {
      setRoom(null);
      setIsConnecting(false);
      setActiveSpeakers(new Set());

      if (reason && reason !== DisconnectReason.CLIENT_INITIATED) {
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          setError("Disconnected: duplicate identity.");
        } else {
          setError(DISCONNECT_MESSAGES[reason] ?? `Disconnected (${String(reason)}).`);
        }
      }

      setRenderVersion((current) => current + 1);
    };
    const onActiveSpeakers = () => {
      const nextActiveSpeakers = new Set(room.activeSpeakers.map((participant) => participant.identity));
      setActiveSpeakers((current) => (areSetsEqual(current, nextActiveSpeakers) ? current : nextActiveSpeakers));
    };

    const refreshEvents = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackStreamStateChanged,
      RoomEvent.TrackSubscriptionStatusChanged
    ] as const;

    refreshEvents.forEach((eventName) => {
      room.on(eventName, refresh);
    });
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      refreshEvents.forEach((eventName) => {
        room.off(eventName, refresh);
      });
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  return {
    activeSpeakers,
    disconnect: () => room?.disconnect(),
    error,
    gameRole,
    identity,
    isConnecting,
    renderVersion,
    room
  };
}

function normalizeGameRole(value: unknown): GameRole | undefined {
  return value === "gamemaster" || value === "player" ? value : undefined;
}
