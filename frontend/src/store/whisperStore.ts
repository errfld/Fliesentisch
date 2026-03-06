import { create } from "zustand";
import type {
  AnyProtocolEnvelope,
  ProtocolEnvelope,
  SpotlightPayload,
  StateSnapshotPayload,
  Whisper,
  WhisperClosePayload
} from "@/lib/protocol";
import { enforceSingleWhisperMembership } from "@/lib/whisper-membership";

export const MAX_CLOSED_WHISPERS = 256;

export type WhisperCoreState = {
  localIdentity: string;
  whispers: Record<string, Whisper>;
  closedWhisperUpdatedAts: Record<string, number>;
  selectedWhisperId?: string;
  mainVolume: number;
  spotlightIdentity?: string;
  followSpotlight: boolean;
  seenEventIds: Record<string, true>;
};

type WhisperActions = {
  setLocalIdentity: (identity: string) => void;
  setSelectedWhisperId: (id?: string) => void;
  setFollowSpotlight: (follow: boolean) => void;
  applyEnvelope: (envelope: AnyProtocolEnvelope) => void;
  reset: () => void;
};

const initialState: WhisperCoreState = {
  localIdentity: "",
  whispers: {},
  closedWhisperUpdatedAts: {},
  selectedWhisperId: undefined,
  mainVolume: 1,
  spotlightIdentity: undefined,
  followSpotlight: true,
  seenEventIds: {}
};

export const useWhisperStore = create<WhisperCoreState & WhisperActions>((set) => ({
  ...initialState,
  setLocalIdentity: (identity) =>
    set((state) => ({
      ...state,
      localIdentity: identity,
      mainVolume: calculateMainVolume(state.whispers, state.selectedWhisperId, identity)
    })),
  setSelectedWhisperId: (id) =>
    set((state) => ({
      ...state,
      selectedWhisperId: id,
      mainVolume: calculateMainVolume(state.whispers, id, state.localIdentity)
    })),
  setFollowSpotlight: (follow) => set((state) => ({ ...state, followSpotlight: follow })),
  applyEnvelope: (envelope) => set((state) => reduceWhisperState(state, envelope)),
  reset: () => set(initialState)
}));

export function calculateMainVolume(
  whispers: Record<string, Whisper>,
  selectedWhisperId: string | undefined,
  localIdentity: string
): number {
  if (!selectedWhisperId || !localIdentity) {
    return 1;
  }

  const whisper = whispers[selectedWhisperId];
  if (!whisper) {
    return 1;
  }

  return whisper.members.includes(localIdentity) ? 0.3 : 1;
}

export function reduceWhisperState(
  state: WhisperCoreState,
  envelope: AnyProtocolEnvelope
): WhisperCoreState {
  if (state.seenEventIds[envelope.eventId]) {
    return state;
  }

  const nextSeen: Record<string, true> = { ...state.seenEventIds, [envelope.eventId]: true };
  let nextWhispers = { ...state.whispers };
  let nextClosedWhisperUpdatedAts = { ...state.closedWhisperUpdatedAts };
  let nextSpotlight = state.spotlightIdentity;

  switch (envelope.type) {
    case "STATE_REQUEST": {
      return { ...state, seenEventIds: nextSeen };
    }
    case "STATE_SNAPSHOT": {
      const snapshotResult = applySnapshot(
        nextWhispers,
        nextClosedWhisperUpdatedAts,
        envelope as ProtocolEnvelope<"STATE_SNAPSHOT", StateSnapshotPayload>
      );
      nextWhispers = snapshotResult.whispers;
      nextClosedWhisperUpdatedAts = snapshotResult.closedWhisperUpdatedAts;
      nextSpotlight = envelope.payload.spotlightIdentity ?? nextSpotlight;
      break;
    }
    case "WHISPER_CREATE":
    case "WHISPER_UPDATE": {
      const upsertResult = applyWhisperUpsert(nextWhispers, nextClosedWhisperUpdatedAts, envelope.payload);
      nextWhispers = upsertResult.whispers;
      nextClosedWhisperUpdatedAts = upsertResult.closedWhisperUpdatedAts;
      break;
    }
    case "WHISPER_CLOSE": {
      const closeResult = applyWhisperClose(nextWhispers, nextClosedWhisperUpdatedAts, envelope.payload);
      nextWhispers = closeResult.whispers;
      nextClosedWhisperUpdatedAts = closeResult.closedWhisperUpdatedAts;
      break;
    }
    case "SPOTLIGHT_UPDATE": {
      nextSpotlight = applySpotlight(nextSpotlight, envelope.payload);
      break;
    }
    default:
      break;
  }

  nextWhispers = enforceWhisperLimit(nextWhispers);
  nextWhispers = enforceSingleWhisperMembership(nextWhispers);

  const selectedWhisper =
    state.selectedWhisperId && nextWhispers[state.selectedWhisperId]
      ? nextWhispers[state.selectedWhisperId]
      : undefined;
  const selectedWhisperId =
    selectedWhisper && selectedWhisper.members.includes(state.localIdentity) ? selectedWhisper.id : undefined;

  return {
    ...state,
    whispers: nextWhispers,
    closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts,
    selectedWhisperId,
    spotlightIdentity: nextSpotlight,
    mainVolume: calculateMainVolume(nextWhispers, selectedWhisperId, state.localIdentity),
    seenEventIds: nextSeen
  };
}

function applySnapshot(
  current: Record<string, Whisper>,
  closedWhisperUpdatedAts: Record<string, number>,
  envelope: ProtocolEnvelope<"STATE_SNAPSHOT", StateSnapshotPayload>
): {
  whispers: Record<string, Whisper>;
  closedWhisperUpdatedAts: Record<string, number>;
} {
  let merged = { ...current };
  let nextClosedWhisperUpdatedAts = closedWhisperUpdatedAts;
  for (const whisper of envelope.payload.whispers) {
    const upsertResult = applyWhisperUpsert(merged, nextClosedWhisperUpdatedAts, whisper);
    merged = upsertResult.whispers;
    nextClosedWhisperUpdatedAts = upsertResult.closedWhisperUpdatedAts;
  }
  return { whispers: merged, closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts };
}

function applyWhisperUpsert(
  current: Record<string, Whisper>,
  closedWhisperUpdatedAts: Record<string, number>,
  incoming: Whisper
): {
  whispers: Record<string, Whisper>;
  closedWhisperUpdatedAts: Record<string, number>;
} {
  const closedUpdatedAt = closedWhisperUpdatedAts[incoming.id];
  if (closedUpdatedAt !== undefined && incoming.updatedAt <= closedUpdatedAt) {
    return { whispers: current, closedWhisperUpdatedAts };
  }

  let nextClosedWhisperUpdatedAts = closedWhisperUpdatedAts;
  if (closedUpdatedAt !== undefined && incoming.updatedAt > closedUpdatedAt) {
    nextClosedWhisperUpdatedAts = { ...closedWhisperUpdatedAts };
    delete nextClosedWhisperUpdatedAts[incoming.id];
  }

  const existing = current[incoming.id];
  if (!existing) {
    return {
      whispers: {
        ...current,
        [incoming.id]: normalizeWhisper(incoming)
      },
      closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts
    };
  }

  if (incoming.updatedAt < existing.updatedAt) {
    return { whispers: current, closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts };
  }

  const shouldReplace =
    incoming.updatedAt > existing.updatedAt || incoming.id.localeCompare(existing.id) >= 0;
  if (!shouldReplace) {
    return { whispers: current, closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts };
  }

  return {
    whispers: {
      ...current,
      [incoming.id]: normalizeWhisper(incoming)
    },
    closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts
  };
}

function applyWhisperClose(
  current: Record<string, Whisper>,
  closedWhisperUpdatedAts: Record<string, number>,
  payload: WhisperClosePayload
): {
  whispers: Record<string, Whisper>;
  closedWhisperUpdatedAts: Record<string, number>;
} {
  const closedUpdatedAt = closedWhisperUpdatedAts[payload.id];
  if (closedUpdatedAt !== undefined && payload.updatedAt <= closedUpdatedAt) {
    return { whispers: current, closedWhisperUpdatedAts };
  }

  const existing = current[payload.id];
  if (existing && payload.updatedAt < existing.updatedAt) {
    return { whispers: current, closedWhisperUpdatedAts };
  }

  const nextClosedWhisperUpdatedAts = addClosedWhisperTimestamp(
    closedWhisperUpdatedAts,
    payload.id,
    payload.updatedAt
  );

  if (!existing) {
    return {
      whispers: current,
      closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts
    };
  }

  const next = { ...current };
  delete next[payload.id];
  return {
    whispers: next,
    closedWhisperUpdatedAts: nextClosedWhisperUpdatedAts
  };
}

function applySpotlight(current: string | undefined, payload: SpotlightPayload): string | undefined {
  return payload.identity ?? current;
}

function normalizeWhisper(whisper: Whisper): Whisper {
  return {
    ...whisper,
    createdAt: whisper.createdAt || whisper.updatedAt,
    members: Array.from(new Set(whisper.members))
  };
}

function addClosedWhisperTimestamp(
  closedWhisperUpdatedAts: Record<string, number>,
  id: string,
  updatedAt: number
): Record<string, number> {
  const next = {
    ...closedWhisperUpdatedAts,
    [id]: updatedAt
  };

  const ids = Object.keys(next);
  if (ids.length <= MAX_CLOSED_WHISPERS) {
    return next;
  }

  const oldest = Object.entries(next)
    .sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] - b[1]))
    .slice(0, ids.length - MAX_CLOSED_WHISPERS);

  for (const [oldestId] of oldest) {
    delete next[oldestId];
  }

  return next;
}

function enforceWhisperLimit(whispers: Record<string, Whisper>): Record<string, Whisper> {
  const entries = Object.values(whispers);
  if (entries.length <= 3) {
    return whispers;
  }

  const allowed = entries
    .slice()
    .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt - b.createdAt))
    .slice(0, 3)
    .map((item) => item.id);

  const allowedSet = new Set(allowed);
  return Object.fromEntries(entries.filter((item) => allowedSet.has(item.id)).map((item) => [item.id, item]));
}
