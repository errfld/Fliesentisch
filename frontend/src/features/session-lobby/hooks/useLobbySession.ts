import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoomProtocol } from "@/features/room-session/lib/room-protocol";
import { createEnvelope, type LobbyParticipantReadiness } from "@/lib/protocol";

type UseLobbySessionInput = {
  protocol: RoomProtocol;
  identity: string;
  displayName: string;
  connectedParticipants: ReadonlyArray<{ identity: string; displayName: string }>;
};

export function useLobbySession({
  protocol,
  identity,
  displayName,
  connectedParticipants
}: UseLobbySessionInput) {
  const [readiness, setReadiness] = useState<Record<string, LobbyParticipantReadiness>>({});
  const [error, setError] = useState<string | null>(null);
  const readinessRef = useRef(readiness);
  readinessRef.current = readiness;

  const applyReadiness = useCallback((next: LobbyParticipantReadiness) => {
    setReadiness((current) => {
      const previous = current[next.identity];
      if (previous && previous.updatedAt > next.updatedAt) return current;
      return { ...current, [next.identity]: next };
    });
  }, []);

  const publishOwnState = useCallback(
    async (ready: boolean) => {
      if (!identity) return false;
      const next = { identity, displayName, ready, updatedAt: Date.now() };
      applyReadiness(next);
      const result = await protocol.publish(createEnvelope("LOBBY_READY_UPDATE", identity, next));
      if (!result.ok) {
        setError("Readiness could not be shared. Check the room connection and try again.");
        return false;
      }
      setError(null);
      return true;
    },
    [applyReadiness, displayName, identity, protocol]
  );

  useEffect(() => {
    const unsubscribeReady = protocol.subscribe("LOBBY_READY_UPDATE", (envelope, context) => {
      if (context.senderIdentity !== envelope.payload.identity) return;
      applyReadiness(envelope.payload);
    });
    const unsubscribeRequest = protocol.subscribe("LOBBY_STATE_REQUEST", () => {
      const ownReady = readinessRef.current[identity]?.ready ?? false;
      void publishOwnState(ownReady);
    });

    return () => {
      unsubscribeReady();
      unsubscribeRequest();
    };
  }, [applyReadiness, identity, protocol, publishOwnState]);

  useEffect(() => {
    if (!identity) return;
    void publishOwnState(false);
    void protocol.publish(createEnvelope("LOBBY_STATE_REQUEST", identity, {}));
  }, [identity, protocol, publishOwnState]);

  const participants = useMemo(
    () =>
      connectedParticipants.map((participant) => ({
        ...participant,
        ready: readiness[participant.identity]?.ready ?? false,
        updatedAt: readiness[participant.identity]?.updatedAt
      })),
    [connectedParticipants, readiness]
  );

  return {
    error,
    isReady: readiness[identity]?.ready ?? false,
    participants,
    setReady: publishOwnState
  };
}
