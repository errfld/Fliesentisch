"use client";

import { useEffect, useMemo, useState } from "react";
import { DisconnectReason, Room, RoomEvent } from "livekit-client";
import { getOrCreateClientId, toIdentity } from "@/lib/client-id";
import {
  areSetsEqual,
  formatConnectionError,
  resolveLivekitUrl
} from "@/features/room-session/lib/session-helpers";

type UseRoomConnectionInput = {
  roomName: string;
  displayName: string;
  joinKey?: string;
};

const DISCONNECT_MESSAGES: Partial<Record<DisconnectReason, string>> = {
  [DisconnectReason.PARTICIPANT_REMOVED]: "You were removed from the room.",
  [DisconnectReason.ROOM_DELETED]: "The room was deleted.",
  [DisconnectReason.SERVER_SHUTDOWN]: "Server is shutting down.",
  [DisconnectReason.STATE_MISMATCH]: "Connection state went out of sync.",
  [DisconnectReason.JOIN_FAILURE]: "Failed to join the room."
};

export function useRoomConnection({ roomName, displayName, joinKey }: UseRoomConnectionInput) {
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());

  const livekitUrl = useMemo(() => resolveLivekitUrl(), []);
  const identity = useMemo(() => {
    if (!clientId) {
      return "";
    }
    return toIdentity(displayName, clientId);
  }, [clientId, displayName]);

  useEffect(() => {
    setClientId(getOrCreateClientId());
  }, []);

  useEffect(() => {
    if (!identity) {
      return;
    }

    const controller = new AbortController();
    setToken("");
    setIsConnecting(true);
    setError(null);

    const fetchToken = async () => {
      try {
        const response = await fetch("/api/v1/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            room: roomName,
            identity,
            name: displayName,
            join_key: joinKey
          }),
          signal: controller.signal
        });

        const body = await response.json();
        if (!response.ok) {
          const code = body?.error?.code ?? "TOKEN_REQUEST_FAILED";
          const message = body?.error?.message ?? "Failed to fetch access token";
          throw new Error(`${code}: ${message}`);
        }

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
  }, [displayName, identity, joinKey, roomName]);

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
          setError("Disconnected: duplicate identity. Refresh to generate a new client ID.");
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

    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
    room.on(RoomEvent.TrackPublished, refresh);
    room.on(RoomEvent.TrackUnpublished, refresh);
    room.on(RoomEvent.TrackSubscribed, refresh);
    room.on(RoomEvent.TrackUnsubscribed, refresh);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.ParticipantConnected, refresh);
      room.off(RoomEvent.ParticipantDisconnected, refresh);
      room.off(RoomEvent.TrackPublished, refresh);
      room.off(RoomEvent.TrackUnpublished, refresh);
      room.off(RoomEvent.TrackSubscribed, refresh);
      room.off(RoomEvent.TrackUnsubscribed, refresh);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  return {
    activeSpeakers,
    disconnect: () => room?.disconnect(),
    error,
    identity,
    isConnecting,
    renderVersion,
    room
  };
}
