import type { Participant, Room } from "livekit-client";
import type {
  AnyProtocolEnvelope,
  ProtocolEventType
} from "@/lib/protocol";
import { parseProtocolEnvelope } from "@/lib/protocol";

export type RoomProtocolMessageContext = Readonly<{
  participant?: Participant;
  senderIdentity: string;
}>;

export type RoomProtocolMessageHandler<T extends ProtocolEventType> = (
  envelope: Extract<AnyProtocolEnvelope, { type: T }>,
  context: RoomProtocolMessageContext
) => void;

export type RoomProtocolPublishResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: "room-unavailable" | "publish-failed" }>;

export type RoomProtocol = Readonly<{
  publish: <T extends ProtocolEventType>(
    envelope: Extract<AnyProtocolEnvelope, { type: T }>
  ) => Promise<RoomProtocolPublishResult>;
  subscribe: <T extends ProtocolEventType>(
    type: T,
    handler: RoomProtocolMessageHandler<T>
  ) => () => void;
}>;

type AnyRoomProtocolMessageHandler = (
  envelope: AnyProtocolEnvelope,
  context: RoomProtocolMessageContext
) => void;

type ProtocolSubscription = Readonly<{
  type: ProtocolEventType;
  handler: AnyRoomProtocolMessageHandler;
}>;

export type RoomProtocolRouter = Readonly<{
  route: (payload: Uint8Array, participant?: Participant) => boolean;
  subscribe: RoomProtocol["subscribe"];
}>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function createRoomProtocolRouter(): RoomProtocolRouter {
  const subscriptions = new Set<ProtocolSubscription>();

  const subscribe: RoomProtocol["subscribe"] = (type, handler) => {
    const subscription: ProtocolSubscription = {
      type,
      handler: handler as AnyRoomProtocolMessageHandler
    };
    subscriptions.add(subscription);

    return () => {
      subscriptions.delete(subscription);
    };
  };

  return {
    route: (payload, participant) => {
      const envelope = decodeRoomProtocolEnvelope(payload);
      if (!envelope) {
        return false;
      }

      const context: RoomProtocolMessageContext = {
        participant,
        senderIdentity: participant?.identity ?? envelope.actor
      };

      for (const subscription of subscriptions) {
        if (subscription.type === envelope.type) {
          subscription.handler(envelope, context);
        }
      }

      return true;
    },
    subscribe
  };
}

export async function publishRoomProtocolEnvelope<T extends ProtocolEventType>(
  room: Room | null,
  envelope: Extract<AnyProtocolEnvelope, { type: T }>
): Promise<RoomProtocolPublishResult> {
  if (!room) {
    return { ok: false, reason: "room-unavailable" };
  }

  try {
    await room.localParticipant.publishData(encodeRoomProtocolEnvelope(envelope), {
      reliable: true
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "publish-failed" };
  }
}

export function encodeRoomProtocolEnvelope(envelope: AnyProtocolEnvelope): Uint8Array {
  return textEncoder.encode(JSON.stringify(envelope));
}

export function decodeRoomProtocolEnvelope(payload: Uint8Array): AnyProtocolEnvelope | null {
  return parseProtocolEnvelope(textDecoder.decode(payload));
}
