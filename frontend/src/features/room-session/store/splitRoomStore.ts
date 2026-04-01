import { create } from "zustand";
import type {
  AnyProtocolEnvelope,
  ProtocolEnvelope,
  SplitAssignmentSetPayload,
  SplitEndPayload,
  SplitGmBroadcastPayload,
  SplitGmFocusPayload,
  SplitRoom,
  SplitRoomRemovePayload,
  SplitState,
  SplitStateSnapshotPayload
} from "@/lib/protocol";
import { MAIN_SPLIT_ROOM_ID, MAIN_SPLIT_ROOM_NAME } from "@/features/room-session/lib/session-selectors";

type SplitRoomCoreState = {
  isActive: boolean;
  rooms: Record<string, SplitRoom>;
  roomOrder: string[];
  removedRoomUpdatedAts: Record<string, number>;
  assignments: Record<string, string>;
  assignmentUpdatedAts: Record<string, number>;
  gmIdentity?: string;
  gmFocusRoomId?: string;
  focusUpdatedAt: number;
  gmBroadcastActive: boolean;
  broadcastUpdatedAt: number;
  updatedAt: number;
  seenEventIds: Record<string, true>;
};

type SplitRoomActions = {
  applyEnvelope: (envelope: AnyProtocolEnvelope) => void;
  reset: () => void;
};

const MAX_SEEN_EVENT_IDS = 256;
const inactiveSplitState = createInactiveSplitState();
const initialState = createSplitRoomCoreState(inactiveSplitState);

export const useSplitRoomStore = create<SplitRoomCoreState & SplitRoomActions>((set) => ({
  ...initialState,
  applyEnvelope: (envelope) => set((state) => reduceSplitRoomState(state, envelope)),
  reset: () => set(initialState)
}));

export function createInactiveSplitState(updatedAt = 0): SplitState {
  return {
    isActive: false,
    rooms: [
      {
        id: MAIN_SPLIT_ROOM_ID,
        name: MAIN_SPLIT_ROOM_NAME,
        kind: "main",
        updatedAt
      }
    ],
    assignments: {},
    gmBroadcastActive: false,
    updatedAt
  };
}

export function selectSplitState(state: SplitRoomCoreState): SplitState {
  return {
    isActive: state.isActive,
    rooms: state.roomOrder.map((roomId) => state.rooms[roomId]).filter((room): room is SplitRoom => Boolean(room)),
    assignments: { ...state.assignments },
    gmIdentity: state.gmIdentity,
    gmFocusRoomId: state.gmFocusRoomId,
    gmBroadcastActive: state.gmBroadcastActive,
    updatedAt: state.updatedAt
  };
}

export function reduceSplitRoomState(
  state: SplitRoomCoreState,
  envelope: AnyProtocolEnvelope
): SplitRoomCoreState {
  if (!isSplitRoomEnvelope(envelope)) {
    return state;
  }

  if (state.seenEventIds[envelope.eventId]) {
    return state;
  }

  const nextSeen = appendSeenEventId(state.seenEventIds, envelope.eventId);

  switch (envelope.type) {
    case "SPLIT_STATE_REQUEST":
      return { ...state, seenEventIds: nextSeen };
    case "SPLIT_STATE_SNAPSHOT":
    case "SPLIT_START":
      return applySplitSnapshot(state, envelope, nextSeen);
    case "SPLIT_END":
      return applySplitEnd(state, envelope.payload, nextSeen);
    case "SPLIT_ROOM_UPSERT":
      return applyRoomUpsert(state, envelope.payload, nextSeen);
    case "SPLIT_ROOM_REMOVE":
      return applyRoomRemove(state, envelope.payload, nextSeen);
    case "SPLIT_ASSIGNMENT_SET":
      return applyAssignment(state, envelope.payload, nextSeen);
    case "SPLIT_GM_FOCUS_UPDATE":
      return applyFocusUpdate(state, envelope.payload, nextSeen);
    case "SPLIT_GM_BROADCAST_UPDATE":
      return applyBroadcastUpdate(state, envelope.payload, nextSeen);
    default:
      return state;
  }
}

function isSplitRoomEnvelope(envelope: AnyProtocolEnvelope): envelope is Extract<
  AnyProtocolEnvelope,
  | ProtocolEnvelope<"SPLIT_STATE_REQUEST", Record<string, never>>
  | ProtocolEnvelope<"SPLIT_STATE_SNAPSHOT", SplitStateSnapshotPayload>
  | ProtocolEnvelope<"SPLIT_START", SplitStateSnapshotPayload>
  | ProtocolEnvelope<"SPLIT_END", SplitEndPayload>
  | ProtocolEnvelope<"SPLIT_ROOM_UPSERT", SplitRoom>
  | ProtocolEnvelope<"SPLIT_ROOM_REMOVE", SplitRoomRemovePayload>
  | ProtocolEnvelope<"SPLIT_ASSIGNMENT_SET", SplitAssignmentSetPayload>
  | ProtocolEnvelope<"SPLIT_GM_FOCUS_UPDATE", SplitGmFocusPayload>
  | ProtocolEnvelope<"SPLIT_GM_BROADCAST_UPDATE", SplitGmBroadcastPayload>
> {
  return envelope.type.startsWith("SPLIT_");
}

function applySplitSnapshot(
  state: SplitRoomCoreState,
  envelope: ProtocolEnvelope<"SPLIT_STATE_SNAPSHOT", SplitStateSnapshotPayload> | ProtocolEnvelope<"SPLIT_START", SplitStateSnapshotPayload>,
  seenEventIds: Record<string, true>
): SplitRoomCoreState {
  if (envelope.payload.splitState.updatedAt < state.updatedAt) {
    return { ...state, seenEventIds };
  }

  return {
    ...createSplitRoomCoreState(envelope.payload.splitState),
    seenEventIds: { [envelope.eventId]: true }
  };
}

function applySplitEnd(
  state: SplitRoomCoreState,
  payload: SplitEndPayload,
  seenEventIds: Record<string, true>
): SplitRoomCoreState {
  if (payload.updatedAt < state.updatedAt) {
    return { ...state, seenEventIds };
  }

  return {
    ...createSplitRoomCoreState(createInactiveSplitState(payload.updatedAt)),
    seenEventIds
  };
}

function applyRoomUpsert(
  state: SplitRoomCoreState,
  room: SplitRoom,
  seenEventIds: Record<string, true>
): SplitRoomCoreState {
  if (!state.isActive) {
    return { ...state, seenEventIds };
  }

  const removedUpdatedAt = state.removedRoomUpdatedAts[room.id] ?? -1;
  const existing = state.rooms[room.id];
  if (room.updatedAt <= removedUpdatedAt || room.updatedAt < (existing?.updatedAt ?? -1)) {
    return { ...state, seenEventIds };
  }

  const nextRooms = { ...state.rooms, [room.id]: room };
  const nextRoomOrder = state.roomOrder.includes(room.id)
    ? [...state.roomOrder]
    : room.kind === "main"
      ? [room.id, ...state.roomOrder.filter((entry) => entry !== room.id)]
      : [...state.roomOrder, room.id];

  return {
    ...state,
    rooms: nextRooms,
    roomOrder: ensureMainRoomFirst(nextRoomOrder, nextRooms),
    updatedAt: Math.max(state.updatedAt, room.updatedAt),
    seenEventIds
  };
}

function applyRoomRemove(
  state: SplitRoomCoreState,
  payload: SplitRoomRemovePayload,
  seenEventIds: Record<string, true>
): SplitRoomCoreState {
  if (!state.isActive || payload.roomId === MAIN_SPLIT_ROOM_ID) {
    return { ...state, seenEventIds };
  }

  const existing = state.rooms[payload.roomId];
  const removedUpdatedAt = state.removedRoomUpdatedAts[payload.roomId] ?? -1;
  if (payload.updatedAt <= removedUpdatedAt || payload.updatedAt < (existing?.updatedAt ?? -1)) {
    return { ...state, seenEventIds };
  }

  const nextRooms = { ...state.rooms };
  delete nextRooms[payload.roomId];

  const nextAssignments = { ...state.assignments };
  const nextAssignmentUpdatedAts = { ...state.assignmentUpdatedAts };
  for (const [participantIdentity, roomId] of Object.entries(state.assignments)) {
    if (roomId === payload.roomId) {
      nextAssignments[participantIdentity] = MAIN_SPLIT_ROOM_ID;
      nextAssignmentUpdatedAts[participantIdentity] = payload.updatedAt;
    }
  }

  return {
    ...state,
    rooms: nextRooms,
    roomOrder: ensureMainRoomFirst(state.roomOrder.filter((roomId) => roomId !== payload.roomId), nextRooms),
    removedRoomUpdatedAts: {
      ...state.removedRoomUpdatedAts,
      [payload.roomId]: payload.updatedAt
    },
    assignments: nextAssignments,
    assignmentUpdatedAts: nextAssignmentUpdatedAts,
    gmFocusRoomId:
      state.gmFocusRoomId === payload.roomId && payload.updatedAt >= state.focusUpdatedAt
        ? undefined
        : state.gmFocusRoomId,
    focusUpdatedAt:
      state.gmFocusRoomId === payload.roomId && payload.updatedAt >= state.focusUpdatedAt
        ? payload.updatedAt
        : state.focusUpdatedAt,
    updatedAt: Math.max(state.updatedAt, payload.updatedAt),
    seenEventIds
  };
}

function applyAssignment(
  state: SplitRoomCoreState,
  payload: SplitAssignmentSetPayload,
  seenEventIds: Record<string, true>
): SplitRoomCoreState {
  if (!state.isActive) {
    return { ...state, seenEventIds };
  }

  const existingUpdatedAt = state.assignmentUpdatedAts[payload.participantIdentity] ?? -1;
  if (payload.updatedAt < existingUpdatedAt) {
    return { ...state, seenEventIds };
  }

  return {
    ...state,
    assignments: {
      ...state.assignments,
      [payload.participantIdentity]: payload.roomId
    },
    assignmentUpdatedAts: {
      ...state.assignmentUpdatedAts,
      [payload.participantIdentity]: payload.updatedAt
    },
    updatedAt: Math.max(state.updatedAt, payload.updatedAt),
    seenEventIds
  };
}

function applyFocusUpdate(
  state: SplitRoomCoreState,
  payload: SplitGmFocusPayload,
  seenEventIds: Record<string, true>
): SplitRoomCoreState {
  if (!state.isActive || payload.updatedAt < state.focusUpdatedAt) {
    return { ...state, seenEventIds };
  }

  return {
    ...state,
    gmFocusRoomId: payload.roomId ?? undefined,
    focusUpdatedAt: payload.updatedAt,
    updatedAt: Math.max(state.updatedAt, payload.updatedAt),
    seenEventIds
  };
}

function applyBroadcastUpdate(
  state: SplitRoomCoreState,
  payload: SplitGmBroadcastPayload,
  seenEventIds: Record<string, true>
): SplitRoomCoreState {
  if (!state.isActive || payload.updatedAt < state.broadcastUpdatedAt) {
    return { ...state, seenEventIds };
  }

  return {
    ...state,
    gmBroadcastActive: payload.active,
    broadcastUpdatedAt: payload.updatedAt,
    updatedAt: Math.max(state.updatedAt, payload.updatedAt),
    seenEventIds
  };
}

export function createSplitRoomCoreState(splitState: SplitState = createInactiveSplitState()): SplitRoomCoreState {
  const normalizedRooms = normalizeRooms(splitState.rooms, splitState.updatedAt);
  const roomOrder = ensureMainRoomFirst(normalizedRooms.map((room) => room.id), Object.fromEntries(normalizedRooms.map((room) => [room.id, room])));

  return {
    isActive: splitState.isActive,
    rooms: Object.fromEntries(normalizedRooms.map((room) => [room.id, room])),
    roomOrder,
    removedRoomUpdatedAts: {},
    assignments: { ...splitState.assignments },
    assignmentUpdatedAts: Object.fromEntries(
      Object.keys(splitState.assignments).map((participantIdentity) => [participantIdentity, splitState.updatedAt])
    ),
    gmIdentity: splitState.gmIdentity,
    gmFocusRoomId: splitState.gmFocusRoomId,
    focusUpdatedAt: splitState.updatedAt,
    gmBroadcastActive: splitState.gmBroadcastActive,
    broadcastUpdatedAt: splitState.updatedAt,
    updatedAt: splitState.updatedAt,
    seenEventIds: {}
  };
}

function normalizeRooms(rooms: SplitRoom[], updatedAt: number): SplitRoom[] {
  const nextRooms = [...rooms];
  if (!nextRooms.some((room) => room.id === MAIN_SPLIT_ROOM_ID)) {
    nextRooms.unshift({
      id: MAIN_SPLIT_ROOM_ID,
      name: MAIN_SPLIT_ROOM_NAME,
      kind: "main",
      updatedAt
    });
  }

  const deduped = new Map<string, SplitRoom>();
  for (const room of nextRooms) {
    const existing = deduped.get(room.id);
    if (!existing || room.updatedAt >= existing.updatedAt) {
      deduped.set(room.id, room);
    }
  }

  return ensureMainRoomFirst(
    Array.from(deduped.values()).map((room) => room.id),
    Object.fromEntries(Array.from(deduped.values()).map((room) => [room.id, room]))
  ).map((roomId) => deduped.get(roomId))
    .filter((room): room is SplitRoom => Boolean(room));
}

function ensureMainRoomFirst(roomOrder: string[], rooms: Record<string, SplitRoom>): string[] {
  const deduped = Array.from(new Set(roomOrder)).filter((roomId) => Boolean(rooms[roomId]));
  const withoutMain = deduped.filter((roomId) => roomId !== MAIN_SPLIT_ROOM_ID);
  return rooms[MAIN_SPLIT_ROOM_ID] ? [MAIN_SPLIT_ROOM_ID, ...withoutMain] : withoutMain;
}

function appendSeenEventId(seenEventIds: Record<string, true>, eventId: string): Record<string, true> {
  const nextSeen: Record<string, true> = { ...seenEventIds, [eventId]: true };
  const seenEventIdsOrder = Object.keys(nextSeen);
  if (seenEventIdsOrder.length <= MAX_SEEN_EVENT_IDS) {
    return nextSeen;
  }

  for (const seenId of seenEventIdsOrder.slice(0, seenEventIdsOrder.length - MAX_SEEN_EVENT_IDS)) {
    delete nextSeen[seenId];
  }

  return nextSeen;
}
