import type { AnyProtocolEnvelope, SplitRoom, SplitState, Whisper } from "@/lib/protocol";
import { MAIN_SPLIT_ROOM_ID, resolveParticipantRoomId } from "@/features/room-session/lib/session-selectors";
import type { GameRole } from "@/features/room-session/types";

export const MAX_SIDE_ROOMS = 3;

type SplitViewInput = {
  splitState: SplitState;
  viewerIdentity: string;
  viewerIsGamemaster: boolean;
};

type SplitAuthorityInput = {
  splitState: SplitState;
  identity: string;
  gameRole?: GameRole;
};

type SplitEnvelopeSenderInput = {
  currentState: SplitState;
  envelope: AnyProtocolEnvelope;
  senderIdentity: string;
  senderGameRole?: GameRole;
};

export function countSideRooms(rooms: SplitRoom[]): number {
  return rooms.filter((room) => room.kind === "side").length;
}

export function canAddSideRoom(rooms: SplitRoom[]): boolean {
  return countSideRooms(rooms) < MAX_SIDE_ROOMS;
}

export function normalizeSplitRoomName(name: string, fallbackName: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 40) : fallbackName;
}

export function canManageSplitAuthority({ splitState, identity, gameRole }: SplitAuthorityInput): boolean {
  if (!identity || gameRole !== "gamemaster") {
    return false;
  }

  if (!splitState.isActive || !splitState.gmIdentity) {
    return true;
  }

  return splitState.gmIdentity === identity;
}

export function canViewSplitAsGamemaster({ splitState, identity, gameRole }: SplitAuthorityInput): boolean {
  if (!identity || gameRole !== "gamemaster") {
    return false;
  }

  if (!splitState.isActive || !splitState.gmIdentity) {
    return true;
  }

  return splitState.gmIdentity === identity;
}

export function resolveParticipantGameRole(attributes?: Readonly<Record<string, string>> | null): GameRole | undefined {
  const gameRole = attributes?.game_role;
  return gameRole === "gamemaster" || gameRole === "player" ? gameRole : undefined;
}

export function shouldAcceptSplitEnvelopeFromSender({
  currentState,
  envelope,
  senderIdentity,
  senderGameRole
}: SplitEnvelopeSenderInput): boolean {
  if (!envelope.type.startsWith("SPLIT_")) {
    return true;
  }

  if (envelope.type === "SPLIT_STATE_SNAPSHOT" || envelope.type === "SPLIT_START") {
    const nextGmIdentity = envelope.payload.splitState.gmIdentity;
    if (senderGameRole !== "gamemaster" || !nextGmIdentity || nextGmIdentity !== senderIdentity) {
      return false;
    }

    if (currentState.isActive && currentState.gmIdentity && currentState.gmIdentity !== senderIdentity) {
      return false;
    }

    return true;
  }

  if (!currentState.isActive || !currentState.gmIdentity) {
    return false;
  }

  return currentState.gmIdentity === senderIdentity;
}

export function resolveWhisperRoomId(splitState: SplitState, whisper: Whisper): string | null {
  if (!splitState.isActive) {
    return MAIN_SPLIT_ROOM_ID;
  }

  const memberRoomIds = Array.from(
    new Set(
      whisper.members
        .filter((participantIdentity) => participantIdentity !== splitState.gmIdentity)
        .map((participantIdentity) => resolveParticipantRoomId(splitState, participantIdentity))
    )
  );

  if (memberRoomIds.length === 0) {
    return MAIN_SPLIT_ROOM_ID;
  }

  return memberRoomIds.length === 1 ? memberRoomIds[0] : null;
}

export function canUseWhisperMembersInSplit(
  splitState: SplitState,
  memberIdentities: string[],
  actorIdentity: string
): boolean {
  if (!splitState.isActive) {
    return true;
  }

  const distinctRoomIds = Array.from(
    new Set(
      memberIdentities
        .filter((participantIdentity) => participantIdentity !== splitState.gmIdentity)
        .map((participantIdentity) => resolveParticipantRoomId(splitState, participantIdentity))
    )
  );

  if (distinctRoomIds.length > 1) {
    return false;
  }

  if (distinctRoomIds.length === 0) {
    return true;
  }

  if (splitState.gmIdentity && actorIdentity === splitState.gmIdentity) {
    return true;
  }

  return resolveParticipantRoomId(splitState, actorIdentity) === distinctRoomIds[0];
}

export function filterWhispersForSplitView(whispers: Whisper[], splitView: SplitViewInput): Whisper[] {
  if (!splitView.splitState.isActive) {
    return whispers;
  }

  return whispers.filter((whisper) => {
    const whisperRoomId = resolveWhisperRoomId(splitView.splitState, whisper);
    if (!whisperRoomId) {
      return false;
    }

    if (splitView.viewerIsGamemaster) {
      return true;
    }

    const viewerRoomId = resolveParticipantRoomId(splitView.splitState, splitView.viewerIdentity);
    return whisperRoomId === viewerRoomId;
  });
}
