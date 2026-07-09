import { describe, expect, it, vi } from "vitest";
import type { Participant, Room } from "livekit-client";
import {
  createRoomProtocolRouter,
  decodeRoomProtocolEnvelope,
  encodeRoomProtocolEnvelope,
  publishRoomProtocolEnvelope
} from "@/features/room-session/lib/room-protocol";
import { createEnvelope } from "@/lib/protocol";

describe("room protocol router", () => {
  it("routes whisper and split envelopes only to their typed subscribers", () => {
    const router = createRoomProtocolRouter();
    const whisperHandler = vi.fn();
    const whisperObserver = vi.fn();
    const splitHandler = vi.fn();
    const unsubscribeWhisper = router.subscribe("WHISPER_CREATE", whisperHandler);
    router.subscribe("WHISPER_CREATE", whisperObserver);
    router.subscribe("SPLIT_STATE_SNAPSHOT", splitHandler);

    const whisperEnvelope = createEnvelope("WHISPER_CREATE", "alice", {
      id: "whisper-1",
      members: ["alice", "bob"],
      createdBy: "alice",
      createdAt: 10,
      updatedAt: 10
    });
    const splitEnvelope = createEnvelope("SPLIT_STATE_SNAPSHOT", "gm", {
      splitState: {
        isActive: true,
        rooms: [{ id: "main", name: "Main Table", kind: "main", updatedAt: 20 }],
        assignments: { alice: "main" },
        gmIdentity: "gm",
        gmBroadcastActive: false,
        updatedAt: 20
      }
    });
    const gmParticipant = {
      identity: "gm",
      attributes: { game_role: "gamemaster" }
    } as unknown as Participant;

    expect(router.route(encodeRoomProtocolEnvelope(whisperEnvelope))).toBe(true);
    expect(whisperHandler).toHaveBeenCalledWith(
      whisperEnvelope,
      expect.objectContaining({ senderIdentity: "alice" })
    );
    expect(whisperObserver).toHaveBeenCalledTimes(1);
    expect(splitHandler).not.toHaveBeenCalled();

    expect(router.route(encodeRoomProtocolEnvelope(splitEnvelope), gmParticipant)).toBe(true);
    expect(splitHandler).toHaveBeenCalledWith(splitEnvelope, {
      participant: gmParticipant,
      senderIdentity: "gm"
    });
    expect(whisperHandler).toHaveBeenCalledTimes(1);

    unsubscribeWhisper();
    router.route(encodeRoomProtocolEnvelope(whisperEnvelope));
    expect(whisperHandler).toHaveBeenCalledTimes(1);
    expect(whisperObserver).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed data before routing", () => {
    const router = createRoomProtocolRouter();
    const handler = vi.fn();
    router.subscribe("WHISPER_UPDATE", handler);

    expect(router.route(new TextEncoder().encode('{"type":"WHISPER_UPDATE"}'))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("room protocol publishing", () => {
  it("encodes and reliably publishes an envelope", async () => {
    const publishData = vi.fn().mockResolvedValue(undefined);
    const room = { localParticipant: { publishData } } as unknown as Room;
    const envelope = createEnvelope("SPOTLIGHT_UPDATE", "alice", {
      identity: "bob",
      updatedAt: 30
    });

    await expect(publishRoomProtocolEnvelope(room, envelope)).resolves.toEqual({ ok: true });
    expect(publishData).toHaveBeenCalledTimes(1);
    const [payload, options] = publishData.mock.calls[0] as [Uint8Array, { reliable: boolean }];
    expect(options).toEqual({ reliable: true });
    expect(decodeRoomProtocolEnvelope(payload)).toEqual(envelope);
  });

  it("returns typed failures when the room is unavailable or publish rejects", async () => {
    const envelope = createEnvelope("STATE_REQUEST", "alice", {});
    await expect(publishRoomProtocolEnvelope(null, envelope)).resolves.toEqual({
      ok: false,
      reason: "room-unavailable"
    });

    const room = {
      localParticipant: { publishData: vi.fn().mockRejectedValue(new Error("offline")) }
    } as unknown as Room;
    await expect(publishRoomProtocolEnvelope(room, envelope)).resolves.toEqual({
      ok: false,
      reason: "publish-failed"
    });
  });
});
