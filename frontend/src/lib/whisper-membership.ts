import { Whisper, WhisperClosePayload } from "@/lib/protocol";

export type WhisperMutation =
  | {
      type: "update";
      whisper: Whisper;
    }
  | {
      type: "close";
      payload: WhisperClosePayload;
    };

function uniqueMembers(members: string[]): string[] {
  return Array.from(new Set(members));
}

function byMostRecentlyUpdatedDesc(a: Whisper, b: Whisper): number {
  if (a.updatedAt === b.updatedAt) {
    return b.id.localeCompare(a.id);
  }
  return b.updatedAt - a.updatedAt;
}

export function enforceSingleWhisperMembership(whispers: Record<string, Whisper>): Record<string, Whisper> {
  const sorted = Object.values(whispers)
    .map((whisper) => ({ ...whisper, members: uniqueMembers(whisper.members) }))
    .sort(byMostRecentlyUpdatedDesc);

  const claimedMembers = new Set<string>();
  const next: Record<string, Whisper> = {};

  for (const whisper of sorted) {
    const remainingMembers = whisper.members.filter((member) => !claimedMembers.has(member));

    if (remainingMembers.length < 2) {
      continue;
    }

    remainingMembers.forEach((member) => {
      claimedMembers.add(member);
    });

    next[whisper.id] = {
      ...whisper,
      members: remainingMembers
    };
  }

  return next;
}

export function collectReassignmentMutations(
  whispers: Record<string, Whisper>,
  targetWhisperId: string,
  movedMembers: string[],
  updatedAt: number
): WhisperMutation[] {
  const movedSet = new Set(uniqueMembers(movedMembers));
  if (movedSet.size === 0) {
    return [];
  }

  const mutations: WhisperMutation[] = [];

  for (const whisper of Object.values(whispers)) {
    if (whisper.id === targetWhisperId) {
      continue;
    }

    const remainingMembers = whisper.members.filter((member) => !movedSet.has(member));
    if (remainingMembers.length === whisper.members.length) {
      continue;
    }

    if (remainingMembers.length < 2) {
      mutations.push({
        type: "close",
        payload: {
          id: whisper.id,
          updatedAt
        }
      });
      continue;
    }

    mutations.push({
      type: "update",
      whisper: {
        ...whisper,
        members: remainingMembers,
        updatedAt
      }
    });
  }

  return mutations.sort((a, b) => {
    const aId = a.type === "close" ? a.payload.id : a.whisper.id;
    const bId = b.type === "close" ? b.payload.id : b.whisper.id;
    if (aId === bId) {
      return a.type.localeCompare(b.type);
    }
    return aId.localeCompare(bId);
  });
}
