"use client";

import { useEffect, useState } from "react";
import { DisconnectReason, Room, RoomEvent } from "livekit-client";
import type { GameRole, PlatformRole } from "@/features/room-session/types";
import {
  areSetsEqual,
  formatConnectionError,
  resolveLivekitUrl
} from "@/features/room-session/lib/session-helpers";

type UseRoomConnectionInput = {
  roomName: string;
  displayName: string;
  purpose?: "session" | "lobby";
};

const DISCONNECT_MESSAGES: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the room.",
  [DisconnectReason.ROOM_DELETED]: "The room was deleted.",
  [DisconnectReason.SERVER_SHUTDOWN]: "Server is shutting down.",
  [DisconnectReason.STATE_MISMATCH]: "Connection state went out of sync.",
  [DisconnectReason.JOIN_FAILURE]: "Failed to join the room."
};

export function useRoomConnection({ roomName, displayName, purpose = "session" }: UseRoomConnectionInput) {
  const [gameRole, setGameRole] = useState<GameRole | undefined>(undefined);
  const [platformRole, setPlatformRole] = useState<PlatformRole | undefined>(undefined);
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
      setPlatformRole(undefined);
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
    setPlatformRole(undefined);
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
            name: displayName,
            purpose: purpose.toUpperCase()
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
        setPlatformRole(normalizePlatformRole(body?.platform_role));
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
  }, [displayName, purpose, roomName]);

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
      RoomEvent.ParticipantNameChanged,
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
    platformRole,
    identity,
    isConnecting,
    renderVersion,
    room
  };
}

export type RoomConnectionState = ReturnType<typeof useRoomConnection>;

export function normalizeGameRole(value: unknown): GameRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.toLowerCase();
  return normalized === "gamemaster" || normalized === "player" ? normalized : undefined;
}

function normalizePlatformRole(value: unknown): PlatformRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.toLowerCase();
  return normalized === "admin" || normalized === "user" ? normalized : undefined;
}
