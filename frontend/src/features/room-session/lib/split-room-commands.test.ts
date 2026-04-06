import { describe, expect, it } from "vitest";
import { MAIN_SPLIT_ROOM_ID } from "@/features/room-session/lib/session-selectors";
import { createNextSideRoom, createSplitStartState, MAX_SIDE_ROOMS } from "@/features/room-session/lib/split-room-commands";

describe("split-room-commands", () => {
  it("creates an initial split state with a default side room and main-table assignments", () => {
    const splitState = createSplitStartState({
      participantIdentities: ["alice", "bob", "alice"],
      gmIdentity: "gm",
      updatedAt: 42
    });

    expect(splitState).toMatchObject({
      isActive: true,
      gmIdentity: "gm",
      gmBroadcastActive: false,
      updatedAt: 42
    });
    expect(splitState.rooms.map((room) => room.id)).toEqual(["main", "side-1"]);
    expect(splitState.assignments).toEqual({
      alice: MAIN_SPLIT_ROOM_ID,
      bob: MAIN_SPLIT_ROOM_ID,
      gm: MAIN_SPLIT_ROOM_ID
    });
  });

  it("picks the first free side-room number", () => {
    expect(
      createNextSideRoom(
        [
          { id: "main", name: "Main Table", kind: "main", updatedAt: 10 },
          { id: "side-1", name: "Side Room 1", kind: "side", updatedAt: 10 },
          { id: "side-3", name: "Side Room 3", kind: "side", updatedAt: 10 }
        ],
        12
      )
    ).toEqual({
      id: "side-2",
      name: "Side Room 2",
      kind: "side",
      updatedAt: 12
    });
  });

  it("stops creating rooms when the side-room cap is reached", () => {
    expect(
      createNextSideRoom(
        [
          { id: "main", name: "Main Table", kind: "main", updatedAt: 10 },
          { id: "side-1", name: "Side Room 1", kind: "side", updatedAt: 10 },
          { id: "side-2", name: "Side Room 2", kind: "side", updatedAt: 10 },
          { id: "side-3", name: "Side Room 3", kind: "side", updatedAt: 10 }
        ],
        12
      )
    ).toBeNull();
    expect(MAX_SIDE_ROOMS).toBe(3);
  });
});
