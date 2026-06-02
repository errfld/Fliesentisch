"use client";

import { useMemo } from "react";
import type { Room } from "livekit-client";
import { buildParticipantDisplayNames } from "@/features/room-session/lib/session-selectors";

type UseRoomParticipantsInput = {
  room: Room | null;
  identity: string;
  renderVersion: number;
  displayName: string;
};

export function useRoomParticipants({ room, identity, renderVersion, displayName }: UseRoomParticipantsInput) {
  const participantIdentities = useMemo(() => {
    void renderVersion;

    if (!identity) {
      return room ? Array.from(room.remoteParticipants.keys()) : [];
    }

    return Array.from(new Set([identity, ...Array.from(room?.remoteParticipants.keys() ?? [])]));
  }, [identity, renderVersion, room]);

  const participantDisplayNames = useMemo(() => {
    void renderVersion;

    return buildParticipantDisplayNames(room, identity, displayName);
  }, [displayName, identity, renderVersion, room]);

  return { participantDisplayNames, participantIdentities };
}
