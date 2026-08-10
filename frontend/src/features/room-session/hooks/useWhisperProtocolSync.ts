"use client";

import { useCallback, useEffect } from "react";
import type {
  RoomProtocol,
  RoomProtocolPublishResult
} from "@/features/room-session/lib/room-protocol";
import { createEnvelope } from "@/lib/protocol";
import type { AnyProtocolEnvelope, StateSnapshotPayload } from "@/lib/protocol";

type UseWhisperProtocolSyncInput = Readonly<{
  enabled: boolean;
  protocol: RoomProtocol;
  identity: string;
  applyEnvelope: (envelope: AnyProtocolEnvelope) => void;
  getSnapshot: () => StateSnapshotPayload;
}>;

type UseWhisperProtocolSyncResult = Readonly<{
  publishEnvelope: (
    envelope: AnyProtocolEnvelope,
    applyLocally?: boolean
  ) => Promise<RoomProtocolPublishResult>;
}>;

export function useWhisperProtocolSync({
  enabled,
  protocol,
  identity,
  applyEnvelope,
  getSnapshot
}: UseWhisperProtocolSyncInput): UseWhisperProtocolSyncResult {
  const publishEnvelope = useCallback(
    async (envelope: AnyProtocolEnvelope, applyLocally = true) => {
      const result = await protocol.publish(envelope);
      if (result.ok && applyLocally) {
        applyEnvelope(envelope);
      }
      return result;
    },
    [applyEnvelope, protocol]
  );

  useEffect(() => {
    if (!enabled || !identity) {
      return;
    }

    const onStateRequest = () => {
      const snapshot = createEnvelope("STATE_SNAPSHOT", identity, getSnapshot());
      void publishEnvelope(snapshot, false);
    };
    const unsubscribers = [
      protocol.subscribe("STATE_REQUEST", onStateRequest),
      protocol.subscribe("STATE_SNAPSHOT", applyEnvelope),
      protocol.subscribe("WHISPER_CREATE", applyEnvelope),
      protocol.subscribe("WHISPER_UPDATE", applyEnvelope),
      protocol.subscribe("WHISPER_CLOSE", applyEnvelope),
      protocol.subscribe("SPOTLIGHT_UPDATE", applyEnvelope)
    ];

    void publishEnvelope(createEnvelope("STATE_REQUEST", identity, {}), false);

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [applyEnvelope, enabled, getSnapshot, identity, protocol, publishEnvelope]);

  return { publishEnvelope };
}
