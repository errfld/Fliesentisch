import { create } from "zustand";
import type {
  AnyProtocolEnvelope,
  HandoutSpotlight,
  HandoutSpotlightStatePayload,
  ProtocolEnvelope
} from "@/lib/protocol";

export type HandoutSpotlightCoreState = {
  handout?: HandoutSpotlight;
  updatedAt: number;
  seenEventIds: Record<string, true>;
};

type HandoutSpotlightActions = {
  applyEnvelope: (envelope: AnyProtocolEnvelope) => void;
  reset: () => void;
};

const MAX_SEEN_EVENT_IDS = 256;
const initialState: HandoutSpotlightCoreState = {
  handout: undefined,
  updatedAt: 0,
  seenEventIds: {}
};

export const useHandoutSpotlightStore = create<HandoutSpotlightCoreState & HandoutSpotlightActions>((set) => ({
  ...initialState,
  applyEnvelope: (envelope) => set((state) => reduceHandoutSpotlightState(state, envelope)),
  reset: () => set(initialState)
}));

export function reduceHandoutSpotlightState(
  state: HandoutSpotlightCoreState,
  envelope: AnyProtocolEnvelope
): HandoutSpotlightCoreState {
  if (!isHandoutEnvelope(envelope)) {
    return state;
  }
  if (state.seenEventIds[envelope.eventId]) {
    return state;
  }

  const seenEventIds = appendSeenEventId(state.seenEventIds, envelope.eventId);
  if (envelope.type === "HANDOUT_STATE_REQUEST") {
    return { ...state, seenEventIds };
  }
  if (envelope.payload.updatedAt < state.updatedAt) {
    return { ...state, seenEventIds };
  }

  return {
    handout: envelope.payload.handout ?? undefined,
    updatedAt: envelope.payload.updatedAt,
    seenEventIds
  };
}

function isHandoutEnvelope(envelope: AnyProtocolEnvelope): envelope is Extract<
  AnyProtocolEnvelope,
  | ProtocolEnvelope<"HANDOUT_STATE_REQUEST", Record<string, never>>
  | ProtocolEnvelope<"HANDOUT_STATE_SNAPSHOT", HandoutSpotlightStatePayload>
  | ProtocolEnvelope<"HANDOUT_SPOTLIGHT_UPDATE", HandoutSpotlightStatePayload>
> {
  return (
    envelope.type === "HANDOUT_STATE_REQUEST" ||
    envelope.type === "HANDOUT_STATE_SNAPSHOT" ||
    envelope.type === "HANDOUT_SPOTLIGHT_UPDATE"
  );
}

function appendSeenEventId(seenEventIds: Record<string, true>, eventId: string): Record<string, true> {
  const nextSeen: Record<string, true> = { ...seenEventIds, [eventId]: true };
  const eventIds = Object.keys(nextSeen);
  if (eventIds.length <= MAX_SEEN_EVENT_IDS) {
    return nextSeen;
  }

  for (const seenId of eventIds.slice(0, eventIds.length - MAX_SEEN_EVENT_IDS)) {
    delete nextSeen[seenId];
  }
  return nextSeen;
}
