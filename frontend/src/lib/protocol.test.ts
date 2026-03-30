import { describe, expect, it, vi, afterEach } from "vitest";
import { createEnvelope, parseProtocolEnvelope } from "@/lib/protocol";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createEnvelope", () => {
  it("creates v1 protocol envelope with generated event metadata", () => {
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const uuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");

    const envelope = createEnvelope("WHISPER_CREATE", "alice", { hello: "world" });

    expect(uuidSpy).toHaveBeenCalledTimes(1);
    expect(envelope).toEqual({
      type: "WHISPER_CREATE",
      v: 1,
      eventId: "11111111-1111-4111-8111-111111111111",
      actor: "alice",
      ts: 1700000000000,
      payload: { hello: "world" }
    });
  });
});

describe("parseProtocolEnvelope", () => {
  it("returns null for invalid JSON", () => {
    expect(parseProtocolEnvelope("not-json")).toBeNull();
  });

  it("returns null when required metadata fields are missing", () => {
    expect(parseProtocolEnvelope(JSON.stringify({ type: "WHISPER_CREATE", v: 1 }))).toBeNull();
    expect(
      parseProtocolEnvelope(
        JSON.stringify({
          type: "WHISPER_CREATE",
          v: 1,
          eventId: 123,
          actor: "alice"
        })
      )
    ).toBeNull();
  });

  it("returns null for unsupported envelope shape", () => {
    expect(
      parseProtocolEnvelope(
        JSON.stringify({
          type: 123,
          v: 1,
          eventId: "evt-1",
          actor: "alice"
        })
      )
    ).toBeNull();

    expect(
      parseProtocolEnvelope(
        JSON.stringify({
          type: "WHISPER_CREATE",
          v: 2,
          eventId: "evt-1",
          actor: "alice"
        })
      )
    ).toBeNull();
  });

  it("parses a valid protocol envelope", () => {
    const raw = JSON.stringify({
      type: "SPOTLIGHT_UPDATE",
      v: 1,
      eventId: "evt-1",
      actor: "alice",
      ts: 1700000000000,
      payload: {
        identity: "bob",
        updatedAt: 1700000000000
      }
    });

    const parsed = parseProtocolEnvelope(raw);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      type: "SPOTLIGHT_UPDATE",
      v: 1,
      eventId: "evt-1",
      actor: "alice"
    });
  });

  it("parses a valid split-state snapshot envelope", () => {
    const raw = JSON.stringify({
      type: "SPLIT_STATE_SNAPSHOT",
      v: 1,
      eventId: "evt-split",
      actor: "gm",
      ts: 1700000000000,
      payload: {
        splitState: {
          isActive: true,
          rooms: [
            { id: "main", name: "Main Table", kind: "main", updatedAt: 10 },
            { id: "side-1", name: "Library", kind: "side", updatedAt: 10 }
          ],
          assignments: {
            alice: "main",
            bob: "side-1"
          },
          gmIdentity: "gm",
          gmFocusRoomId: "side-1",
          gmBroadcastActive: false,
          updatedAt: 10
        }
      }
    });

    const parsed = parseProtocolEnvelope(raw);

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      type: "SPLIT_STATE_SNAPSHOT",
      payload: {
        splitState: {
          gmIdentity: "gm",
          gmFocusRoomId: "side-1"
        }
      }
    });
  });
});
