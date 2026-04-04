import type { SplitRoom, SplitState } from "@/lib/protocol";
import { MAIN_SPLIT_ROOM_ID, MAIN_SPLIT_ROOM_NAME } from "@/features/room-session/lib/session-selectors";
import { canAddSideRoom, MAX_SIDE_ROOMS } from "@/features/room-session/lib/split-room-rules";

export const DEFAULT_SIDE_ROOM_NAME_PREFIX = "Side Room";
export { MAX_SIDE_ROOMS };

type CreateSplitStartStateInput = {
  participantIdentities: string[];
  gmIdentity: string;
  updatedAt: number;
};

export function createSplitStartState({
  participantIdentities,
  gmIdentity,
  updatedAt
}: CreateSplitStartStateInput): SplitState {
  const firstSideRoom = createNextSideRoom([], updatedAt);
  const roomIds = new Set(participantIdentities.filter(Boolean));
  if (gmIdentity) {
    roomIds.add(gmIdentity);
  }

  const assignments = Object.fromEntries(
    Array.from(roomIds)
      .sort((left, right) => left.localeCompare(right))
      .map((participantIdentity) => [participantIdentity, MAIN_SPLIT_ROOM_ID])
  );

  return {
    isActive: true,
    rooms: [
      {
        id: MAIN_SPLIT_ROOM_ID,
        name: MAIN_SPLIT_ROOM_NAME,
        kind: "main",
        updatedAt
      },
      firstSideRoom ?? {
        id: "side-1",
        name: `${DEFAULT_SIDE_ROOM_NAME_PREFIX} 1`,
        kind: "side",
        updatedAt
      }
    ],
    assignments,
    gmIdentity,
    gmBroadcastActive: false,
    updatedAt
  };
}

export function createNextSideRoom(existingRooms: SplitRoom[], updatedAt: number): SplitRoom | null {
  if (!canAddSideRoom(existingRooms)) {
    return null;
  }

  const nextNumber = findNextSideRoomNumber(existingRooms);

  return {
    id: `side-${nextNumber}`,
    name: `${DEFAULT_SIDE_ROOM_NAME_PREFIX} ${nextNumber}`,
    kind: "side",
    updatedAt
  };
}

function findNextSideRoomNumber(existingRooms: SplitRoom[]): number {
  const usedNumbers = new Set(
    existingRooms
      .filter((room) => room.kind === "side")
      .map((room) => {
        const match = room.id.match(/^side-(\d+)$/);
        return match ? Number.parseInt(match[1], 10) : NaN;
      })
      .filter((value) => Number.isFinite(value) && value > 0)
  );

  let candidate = 1;
  while (usedNumbers.has(candidate)) {
    candidate += 1;
  }

  return candidate;
}
