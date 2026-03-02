import { create } from "zustand";
import {
  AnyProtocolEnvelope,
  ProtocolEnvelope,
  SpotlightPayload,
  StateSnapshotPayload,
  Whisper,
  WhisperClosePayload
} from "@/lib/protocol";

export type WhisperCoreState = {
  localIdentity: string;
  whispers: Record<string, Whisper>;
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

  const nextSeen = { ...state.seenEventIds, [envelope.eventId]: true };
  let nextWhispers = { ...state.whispers };
  let nextSpotlight = state.spotlightIdentity;

  switch (envelope.type) {
    case "STATE_REQUEST": {
      return { ...state, seenEventIds: nextSeen };
    }
    case "STATE_SNAPSHOT": {
      nextWhispers = applySnapshot(nextWhispers, envelope as ProtocolEnvelope<"STATE_SNAPSHOT", StateSnapshotPayload>);
      nextSpotlight = envelope.payload.spotlightIdentity ?? nextSpotlight;
      break;
    }
    case "WHISPER_CREATE":
    case "WHISPER_UPDATE": {
      nextWhispers = applyWhisperUpsert(nextWhispers, envelope.payload);
      break;
    }
    case "WHISPER_CLOSE": {
      nextWhispers = applyWhisperClose(nextWhispers, envelope.payload);
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

  const selectedWhisperId =
    state.selectedWhisperId && nextWhispers[state.selectedWhisperId] ? state.selectedWhisperId : undefined;

  return {
    ...state,
    whispers: nextWhispers,
    selectedWhisperId,
    spotlightIdentity: nextSpotlight,
    mainVolume: calculateMainVolume(nextWhispers, selectedWhisperId, state.localIdentity),
    seenEventIds: nextSeen
  };
}

function applySnapshot(
  current: Record<string, Whisper>,
  envelope: ProtocolEnvelope<"STATE_SNAPSHOT", StateSnapshotPayload>
): Record<string, Whisper> {
  let merged = { ...current };
  for (const whisper of envelope.payload.whispers) {
    merged = applyWhisperUpsert(merged, whisper);
  }
  return merged;
}

function applyWhisperUpsert(
  current: Record<string, Whisper>,
  incoming: Whisper
): Record<string, Whisper> {
  const existing = current[incoming.id];
  if (!existing) {
    return {
      ...current,
      [incoming.id]: normalizeWhisper(incoming)
    };
  }

  if (incoming.updatedAt < existing.updatedAt) {
    return current;
  }

  const shouldReplace =
    incoming.updatedAt > existing.updatedAt || incoming.id.localeCompare(existing.id) >= 0;
  if (!shouldReplace) {
    return current;
  }

  return {
    ...current,
    [incoming.id]: normalizeWhisper(incoming)
  };
}

function applyWhisperClose(
  current: Record<string, Whisper>,
  payload: WhisperClosePayload
): Record<string, Whisper> {
  const existing = current[payload.id];
  if (!existing || payload.updatedAt < existing.updatedAt) {
    return current;
  }

  const next = { ...current };
  delete next[payload.id];
  return next;
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
