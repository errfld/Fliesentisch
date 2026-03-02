export type Whisper = {
  id: string;
  title?: string;
  members: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type ProtocolEventType =
  | "STATE_REQUEST"
  | "STATE_SNAPSHOT"
  | "WHISPER_CREATE"
  | "WHISPER_UPDATE"
  | "WHISPER_CLOSE"
  | "SPOTLIGHT_UPDATE";

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
  | ProtocolEnvelope<"SPOTLIGHT_UPDATE", SpotlightPayload>;

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
