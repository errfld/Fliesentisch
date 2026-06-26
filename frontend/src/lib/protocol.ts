export type Whisper = {
  id: string;
  title?: string;
  members: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type SplitRoomKind = "main" | "side";

export type SplitRoom = {
  id: string;
  name: string;
  kind: SplitRoomKind;
  updatedAt: number;
};

export type SplitState = {
  isActive: boolean;
  rooms: SplitRoom[];
  assignments: Record<string, string>;
  gmIdentity?: string;
  gmFocusRoomId?: string;
  gmBroadcastActive: boolean;
  updatedAt: number;
};

export type ProtocolEventType =
  | "STATE_REQUEST"
  | "STATE_SNAPSHOT"
  | "WHISPER_CREATE"
  | "WHISPER_UPDATE"
  | "WHISPER_CLOSE"
  | "SPOTLIGHT_UPDATE"
  | "SPLIT_STATE_REQUEST"
  | "SPLIT_STATE_SNAPSHOT"
  | "SPLIT_START"
  | "SPLIT_END"
  | "SPLIT_ROOM_UPSERT"
  | "SPLIT_ROOM_REMOVE"
  | "SPLIT_ASSIGNMENT_SET"
  | "SPLIT_GM_FOCUS_UPDATE"
  | "SPLIT_GM_BROADCAST_UPDATE";

export type StateSnapshotPayload = {
  whispers: Whisper[];
  spotlightIdentity?: string | null;
};

export type WhisperClosePayload = {
  id: string;
  updatedAt: number;
};

export type SpotlightPayload = {
  identity: string | null;
  updatedAt: number;
};

export type SplitStateSnapshotPayload = {
  splitState: SplitState;
};

export type SplitEndPayload = {
  updatedAt: number;
};

export type SplitRoomRemovePayload = {
  roomId: string;
  updatedAt: number;
};

export type SplitAssignmentSetPayload = {
  participantIdentity: string;
  roomId: string;
  updatedAt: number;
};

export type SplitGmFocusPayload = {
  roomId: string | null;
  updatedAt: number;
};

export type SplitGmBroadcastPayload = {
  active: boolean;
  updatedAt: number;
};

export type ProtocolPayloadByType = {
  STATE_REQUEST: Record<string, never>;
  STATE_SNAPSHOT: StateSnapshotPayload;
  WHISPER_CREATE: Whisper;
  WHISPER_UPDATE: Whisper;
  WHISPER_CLOSE: WhisperClosePayload;
  SPOTLIGHT_UPDATE: SpotlightPayload;
  SPLIT_STATE_REQUEST: Record<string, never>;
  SPLIT_STATE_SNAPSHOT: SplitStateSnapshotPayload;
  SPLIT_START: SplitStateSnapshotPayload;
  SPLIT_END: SplitEndPayload;
  SPLIT_ROOM_UPSERT: SplitRoom;
  SPLIT_ROOM_REMOVE: SplitRoomRemovePayload;
  SPLIT_ASSIGNMENT_SET: SplitAssignmentSetPayload;
  SPLIT_GM_FOCUS_UPDATE: SplitGmFocusPayload;
  SPLIT_GM_BROADCAST_UPDATE: SplitGmBroadcastPayload;
};

export type ProtocolEnvelope<
  T extends ProtocolEventType = ProtocolEventType,
  P extends ProtocolPayloadByType[T] = ProtocolPayloadByType[T]
> = {
  type: T;
  v: 1;
  eventId: string;
  actor: string;
  ts: number;
  payload: P;
};

export type AnyProtocolEnvelope = {
  [T in ProtocolEventType]: ProtocolEnvelope<T>;
}[ProtocolEventType];

export function createEnvelope<T extends ProtocolEventType>(
  type: T,
  actor: string,
  payload: ProtocolPayloadByType[T]
): ProtocolEnvelope<T> {
  return {
    type,
    v: 1,
    eventId: crypto.randomUUID(),
    actor,
    ts: Date.now(),
    payload
  };
}

export function parseProtocolEnvelope(raw: string): AnyProtocolEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    if (parsed.v !== 1 || !isProtocolEventType(parsed.type)) {
      return null;
    }
    if (
      typeof parsed.eventId !== "string" ||
      typeof parsed.actor !== "string" ||
      !isFiniteNumber(parsed.ts)
    ) {
      return null;
    }
    if (!isProtocolPayload(parsed.type, parsed.payload)) {
      return null;
    }

    return parsed as AnyProtocolEnvelope;
  } catch {
    return null;
  }
}

function isProtocolEventType(type: unknown): type is ProtocolEventType {
  return typeof type === "string" && type in protocolPayloadValidators;
}

function isProtocolPayload<T extends ProtocolEventType>(
  type: T,
  payload: unknown
): payload is ProtocolPayloadByType[T] {
  return protocolPayloadValidators[type](payload);
}

const protocolPayloadValidators: {
  [T in ProtocolEventType]: (payload: unknown) => payload is ProtocolPayloadByType[T];
} = {
  STATE_REQUEST: isEmptyRecord,
  STATE_SNAPSHOT: isStateSnapshotPayload,
  WHISPER_CREATE: isWhisper,
  WHISPER_UPDATE: isWhisper,
  WHISPER_CLOSE: isWhisperClosePayload,
  SPOTLIGHT_UPDATE: isSpotlightPayload,
  SPLIT_STATE_REQUEST: isEmptyRecord,
  SPLIT_STATE_SNAPSHOT: isSplitStateSnapshotPayload,
  SPLIT_START: isSplitStateSnapshotPayload,
  SPLIT_END: isUpdatedAtPayload,
  SPLIT_ROOM_UPSERT: isSplitRoom,
  SPLIT_ROOM_REMOVE: isSplitRoomRemovePayload,
  SPLIT_ASSIGNMENT_SET: isSplitAssignmentSetPayload,
  SPLIT_GM_FOCUS_UPDATE: isSplitGmFocusPayload,
  SPLIT_GM_BROADCAST_UPDATE: isSplitGmBroadcastPayload
};

function isStateSnapshotPayload(payload: unknown): payload is StateSnapshotPayload {
  if (!isRecord(payload) || !Array.isArray(payload.whispers)) {
    return false;
  }
  if (!payload.whispers.every(isWhisper)) {
    return false;
  }
  return payload.spotlightIdentity === undefined || isNullableString(payload.spotlightIdentity);
}

function isWhisper(payload: unknown): payload is Whisper {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    (payload.title === undefined || typeof payload.title === "string") &&
    Array.isArray(payload.members) &&
    payload.members.every((member) => typeof member === "string") &&
    typeof payload.createdBy === "string" &&
    isFiniteNumber(payload.createdAt) &&
    isFiniteNumber(payload.updatedAt)
  );
}

function isWhisperClosePayload(payload: unknown): payload is WhisperClosePayload {
  return isRecord(payload) && typeof payload.id === "string" && isFiniteNumber(payload.updatedAt);
}

function isSpotlightPayload(payload: unknown): payload is SpotlightPayload {
  return isRecord(payload) && isNullableString(payload.identity) && isFiniteNumber(payload.updatedAt);
}

function isSplitStateSnapshotPayload(payload: unknown): payload is SplitStateSnapshotPayload {
  return isRecord(payload) && isSplitState(payload.splitState);
}

function isSplitState(payload: unknown): payload is SplitState {
  return (
    isRecord(payload) &&
    typeof payload.isActive === "boolean" &&
    Array.isArray(payload.rooms) &&
    payload.rooms.every(isSplitRoom) &&
    isStringRecord(payload.assignments) &&
    (payload.gmIdentity === undefined || typeof payload.gmIdentity === "string") &&
    (payload.gmFocusRoomId === undefined || typeof payload.gmFocusRoomId === "string") &&
    typeof payload.gmBroadcastActive === "boolean" &&
    isFiniteNumber(payload.updatedAt)
  );
}

function isSplitRoom(payload: unknown): payload is SplitRoom {
  return (
    isRecord(payload) &&
    typeof payload.id === "string" &&
    typeof payload.name === "string" &&
    (payload.kind === "main" || payload.kind === "side") &&
    isFiniteNumber(payload.updatedAt)
  );
}

function isUpdatedAtPayload(payload: unknown): payload is SplitEndPayload {
  return isRecord(payload) && isFiniteNumber(payload.updatedAt);
}

function isSplitRoomRemovePayload(payload: unknown): payload is SplitRoomRemovePayload {
  return isRecord(payload) && typeof payload.roomId === "string" && isFiniteNumber(payload.updatedAt);
}

function isSplitAssignmentSetPayload(payload: unknown): payload is SplitAssignmentSetPayload {
  return (
    isRecord(payload) &&
    typeof payload.participantIdentity === "string" &&
    typeof payload.roomId === "string" &&
    isFiniteNumber(payload.updatedAt)
  );
}

function isSplitGmFocusPayload(payload: unknown): payload is SplitGmFocusPayload {
  return isRecord(payload) && isNullableString(payload.roomId) && isFiniteNumber(payload.updatedAt);
}

function isSplitGmBroadcastPayload(payload: unknown): payload is SplitGmBroadcastPayload {
  return isRecord(payload) && typeof payload.active === "boolean" && isFiniteNumber(payload.updatedAt);
}

function isEmptyRecord(payload: unknown): payload is Record<string, never> {
  return isRecord(payload) && Object.keys(payload).length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
