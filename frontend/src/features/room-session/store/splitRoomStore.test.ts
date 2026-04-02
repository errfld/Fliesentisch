import { describe, expect, it } from "vitest";
import { createEnvelope } from "@/lib/protocol";
import type { SplitState } from "@/lib/protocol";
import {
  createInactiveSplitState,
  createSplitRoomCoreState,
  reduceSplitRoomState,
  selectSplitState
} from "@/features/room-session/store/splitRoomStore";

function activeSplitState(updatedAt = 10): SplitState {
  return {
    isActive: true,
    rooms: [
      { id: "main", name: "Main Table", kind: "main", updatedAt },
      { id: "side-1", name: "Library", kind: "side", updatedAt }
    ],
    assignments: {
      alice: "main",
      bob: "side-1"
    },
    gmIdentity: "gm",
    gmFocusRoomId: "side-1",
    gmBroadcastActive: false,
    updatedAt
  };
}

describe("splitRoomStore", () => {
  it("starts from an inactive main-table-only state", () => {
    expect(createInactiveSplitState()).toEqual({
      isActive: false,
      rooms: [
        {
          id: "main",
          name: "Main Table",
          kind: "main",
          updatedAt: 0
        }
      ],
      assignments: {},
      gmBroadcastActive: false,
      updatedAt: 0
    });
  });

  it("applies a split snapshot", () => {
    const next = reduceSplitRoomState(
      createSplitRoomCoreState(),
      createEnvelope("SPLIT_STATE_SNAPSHOT", "gm", {
        splitState: activeSplitState(10)
      })
    );

    expect(selectSplitState(next)).toMatchObject({
      isActive: true,
      gmIdentity: "gm",
      gmFocusRoomId: "side-1"
    });
    expect(selectSplitState(next).rooms.map((room) => room.id)).toEqual(["main", "side-1"]);
  });

  it("rejects stale assignment updates", () => {
    const base = reduceSplitRoomState(
      createSplitRoomCoreState(),
      createEnvelope("SPLIT_START", "gm", {
        splitState: activeSplitState(10)
      })
    );

    const stale = reduceSplitRoomState(
      base,
      createEnvelope("SPLIT_ASSIGNMENT_SET", "gm", {
        participantIdentity: "bob",
        roomId: "main",
        updatedAt: 9
      })
    );

    expect(selectSplitState(stale).assignments.bob).toBe("side-1");
  });

  it("reassigns removed-room members back to the main table", () => {
    const base = reduceSplitRoomState(
      createSplitRoomCoreState(),
      createEnvelope("SPLIT_START", "gm", {
        splitState: activeSplitState(10)
      })
    );

    const next = reduceSplitRoomState(
      base,
      createEnvelope("SPLIT_ROOM_REMOVE", "gm", {
        roomId: "side-1",
        updatedAt: 11
      })
    );

    expect(selectSplitState(next).rooms.map((room) => room.id)).toEqual(["main"]);
    expect(selectSplitState(next).assignments.bob).toBe("main");
    expect(selectSplitState(next).gmFocusRoomId).toBeUndefined();
  });

  it("resets to inactive state on split end", () => {
    const base = reduceSplitRoomState(
      createSplitRoomCoreState(),
      createEnvelope("SPLIT_START", "gm", {
        splitState: activeSplitState(10)
      })
    );

    const next = reduceSplitRoomState(
      base,
      createEnvelope("SPLIT_END", "gm", {
        updatedAt: 12
      })
    );

    expect(selectSplitState(next)).toEqual(createInactiveSplitState(12));
  });

  it("ignores assignment updates that target missing rooms", () => {
    const base = reduceSplitRoomState(
      createSplitRoomCoreState(),
      createEnvelope("SPLIT_START", "gm", {
        splitState: activeSplitState(10)
      })
    );

    const next = reduceSplitRoomState(
      base,
      createEnvelope("SPLIT_ASSIGNMENT_SET", "gm", {
        participantIdentity: "bob",
        roomId: "missing-room",
        updatedAt: 11
      })
    );

    expect(selectSplitState(next).assignments.bob).toBe("side-1");
  });

  it("ignores GM focus updates that target missing rooms", () => {
    const base = reduceSplitRoomState(
      createSplitRoomCoreState(),
      createEnvelope("SPLIT_START", "gm", {
        splitState: activeSplitState(10)
      })
    );

    const next = reduceSplitRoomState(
      base,
      createEnvelope("SPLIT_GM_FOCUS_UPDATE", "gm", {
        roomId: "missing-room",
        updatedAt: 11
      })
    );

    expect(selectSplitState(next).gmFocusRoomId).toBe("side-1");
  });
});
