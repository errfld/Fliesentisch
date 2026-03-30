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

export type ProtocolEnvelope<T extends ProtocolEventType = ProtocolEventType, P = unknown> = {
  type: T;
  v: 1;
  eventId: string;
  actor: string;
  ts: number;
  payload: P;
};

export type AnyProtocolEnvelope =
  | ProtocolEnvelope<"STATE_REQUEST", Record<string, never>>
  | ProtocolEnvelope<"STATE_SNAPSHOT", StateSnapshotPayload>
  | ProtocolEnvelope<"WHISPER_CREATE", Whisper>
  | ProtocolEnvelope<"WHISPER_UPDATE", Whisper>
  | ProtocolEnvelope<"WHISPER_CLOSE", WhisperClosePayload>
  | ProtocolEnvelope<"SPOTLIGHT_UPDATE", SpotlightPayload>
  | ProtocolEnvelope<"SPLIT_STATE_REQUEST", Record<string, never>>
  | ProtocolEnvelope<"SPLIT_STATE_SNAPSHOT", SplitStateSnapshotPayload>
  | ProtocolEnvelope<"SPLIT_START", SplitStateSnapshotPayload>
  | ProtocolEnvelope<"SPLIT_END", SplitEndPayload>
  | ProtocolEnvelope<"SPLIT_ROOM_UPSERT", SplitRoom>
  | ProtocolEnvelope<"SPLIT_ROOM_REMOVE", SplitRoomRemovePayload>
  | ProtocolEnvelope<"SPLIT_ASSIGNMENT_SET", SplitAssignmentSetPayload>
  | ProtocolEnvelope<"SPLIT_GM_FOCUS_UPDATE", SplitGmFocusPayload>
  | ProtocolEnvelope<"SPLIT_GM_BROADCAST_UPDATE", SplitGmBroadcastPayload>;

export function createEnvelope<T extends ProtocolEventType, P>(
  type: T,
  actor: string,
  payload: P
): ProtocolEnvelope<T, P> {
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
    const parsed = JSON.parse(raw) as Partial<AnyProtocolEnvelope>;
    if (!parsed || parsed.v !== 1 || typeof parsed.type !== "string") {
      return null;
    }
    if (typeof parsed.eventId !== "string" || typeof parsed.actor !== "string") {
      return null;
    }
    return parsed as AnyProtocolEnvelope;
  } catch {
    return null;
  }
}
