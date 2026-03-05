import { describe, expect, it } from "vitest";
import { createEnvelope } from "@/lib/protocol";
import { calculateMainVolume, MAX_CLOSED_WHISPERS, reduceWhisperState } from "@/store/whisperStore";
import type { Whisper } from "@/lib/protocol";
import type { WhisperCoreState } from "@/store/whisperStore";

const baseState: WhisperCoreState = {
  localIdentity: "alice",
  whispers: {},
  closedWhisperUpdatedAts: {},
  selectedWhisperId: undefined,
  mainVolume: 1,
  spotlightIdentity: undefined,
  followSpotlight: true,
  seenEventIds: {}
};

function whisper(id: string, updatedAt: number, createdAt = updatedAt): Whisper {
  return {
    id,
    members: ["alice", "bob"],
    createdBy: "alice",
    createdAt,
    updatedAt
  };
}

describe("calculateMainVolume", () => {
  it("returns full volume when no whisper is selected", () => {
    expect(calculateMainVolume({}, undefined, "alice")).toBe(1);
  });

  it("returns full volume when selected whisper does not contain local identity", () => {
    const whispers = {
      w1: {
        ...whisper("w1", 10),
        members: ["bob", "charlie"]
      }
    };

    expect(calculateMainVolume(whispers, "w1", "alice")).toBe(1);
  });
});

function whisperWithMembers(id: string, members: string[], updatedAt: number, createdAt = updatedAt): Whisper {
  return {
    id,
    members,
    createdBy: members[0] ?? "system",
    createdAt,
    updatedAt
  };
}

describe("reduceWhisperState", () => {
  it("applies whisper create and deduplicates event id", () => {
    const evt = createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 10));
    const next = reduceWhisperState(baseState, evt);
    const dup = reduceWhisperState(next, evt);

    expect(Object.keys(next.whispers)).toEqual(["w1"]);
    expect(Object.keys(dup.whispers)).toEqual(["w1"]);
  });

  it("applies last-write-wins by updatedAt", () => {
    const state1 = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 10))
    );
    const stale = reduceWhisperState(
      state1,
      createEnvelope("WHISPER_UPDATE", "bob", whisper("w1", 9))
    );
    const fresh = reduceWhisperState(
      stale,
      createEnvelope("WHISPER_UPDATE", "bob", whisper("w1", 11))
    );

    expect(stale.whispers.w1.updatedAt).toBe(10);
    expect(fresh.whispers.w1.updatedAt).toBe(11);
  });

  it("enforces max three whispers by oldest createdAt", () => {
    const s1 = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisperWithMembers("w1", ["alice", "bob"], 1, 1))
    );
    const s2 = reduceWhisperState(
      s1,
      createEnvelope("WHISPER_CREATE", "alice", whisperWithMembers("w2", ["carol", "dave"], 2, 2))
    );
    const s3 = reduceWhisperState(
      s2,
      createEnvelope("WHISPER_CREATE", "alice", whisperWithMembers("w3", ["erin", "frank"], 3, 3))
    );
    const s4 = reduceWhisperState(
      s3,
      createEnvelope("WHISPER_CREATE", "alice", whisperWithMembers("w4", ["gina", "henry"], 4, 4))
    );

    expect(Object.keys(s4.whispers).sort()).toEqual(["w1", "w2", "w3"]);
  });

  it("keeps each participant in only one whisper based on most recent update", () => {
    const s1 = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisperWithMembers("w1", ["alice", "bob"], 10))
    );
    const s2 = reduceWhisperState(
      s1,
      createEnvelope("WHISPER_CREATE", "carol", whisperWithMembers("w2", ["alice", "carol"], 20))
    );

    expect(s2.whispers.w2.members).toEqual(["alice", "carol"]);
    expect(s2.whispers.w1).toBeUndefined();
  });

  it("ducks main volume when selected whisper includes local member", () => {
    const withWhisper = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 10))
    );

    const selectedState: WhisperCoreState = {
      ...withWhisper,
      selectedWhisperId: "w1",
      mainVolume: 1
    };

    const updated = reduceWhisperState(
      selectedState,
      createEnvelope("WHISPER_UPDATE", "alice", whisper("w1", 11))
    );

    expect(updated.mainVolume).toBe(0.3);
  });

  it("marks STATE_REQUEST as seen without mutating whispers", () => {
    const initial = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 10))
    );

    const preWhispersSnapshot = structuredClone(initial.whispers);
    const stateRequest = createEnvelope("STATE_REQUEST", "bob", {});
    const next = reduceWhisperState(initial, stateRequest);

    expect(next.whispers).toEqual(preWhispersSnapshot);
    expect(preWhispersSnapshot).toEqual(initial.whispers);
    expect(next.seenEventIds[stateRequest.eventId]).toBe(true);
  });

  it("merges snapshot whispers and applies spotlight identity from snapshot", () => {
    const snapshot = createEnvelope("STATE_SNAPSHOT", "bob", {
      whispers: [
        whisperWithMembers("w1", ["alice", "bob"], 10),
        whisperWithMembers("w2", ["carol", "dave"], 12)
      ],
      spotlightIdentity: "gm"
    });

    const next = reduceWhisperState(baseState, snapshot);

    expect(Object.keys(next.whispers).sort()).toEqual(["w1", "w2"]);
    expect(next.spotlightIdentity).toBe("gm");
  });

  it("keeps existing spotlight when snapshot spotlight identity is null", () => {
    const withSpotlight: WhisperCoreState = {
      ...baseState,
      spotlightIdentity: "gm"
    };

    const snapshot = createEnvelope("STATE_SNAPSHOT", "bob", {
      whispers: [whisper("w1", 10)],
      spotlightIdentity: null
    });

    const next = reduceWhisperState(withSpotlight, snapshot);

    expect(next.spotlightIdentity).toBe("gm");
  });

  it("applies whisper close only when update is fresh enough", () => {
    const created = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 10))
    );

    const staleClose = reduceWhisperState(
      created,
      createEnvelope("WHISPER_CLOSE", "alice", {
        id: "w1",
        updatedAt: 9
      })
    );

    const freshClose = reduceWhisperState(
      staleClose,
      createEnvelope("WHISPER_CLOSE", "alice", {
        id: "w1",
        updatedAt: 10
      })
    );

    expect(staleClose.whispers.w1).toBeDefined();
    expect(freshClose.whispers.w1).toBeUndefined();
  });

  it("does not resurrect a whisper from stale snapshot data after close", () => {
    const created = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 10))
    );
    const closed = reduceWhisperState(
      created,
      createEnvelope("WHISPER_CLOSE", "alice", {
        id: "w1",
        updatedAt: 11
      })
    );

    expect(closed.whispers.w1).toBeUndefined();
    expect(closed.closedWhisperUpdatedAts.w1).toBe(11);

    const staleSnapshot = createEnvelope("STATE_SNAPSHOT", "bob", {
      whispers: [whisper("w1", 10)],
      spotlightIdentity: null
    });
    const next = reduceWhisperState(closed, staleSnapshot);

    expect(next.whispers.w1).toBeUndefined();
  });

  it("accepts newer whisper updates after a close tombstone", () => {
    const closed = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CLOSE", "alice", {
        id: "w1",
        updatedAt: 11
      })
    );

    expect(closed.whispers.w1).toBeUndefined();
    expect(closed.closedWhisperUpdatedAts.w1).toBe(11);

    const recreated = reduceWhisperState(
      closed,
      createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 12))
    );

    expect(recreated.whispers.w1).toBeDefined();
    expect(recreated.closedWhisperUpdatedAts.w1).toBeUndefined();
  });

  it("caps closed whisper tombstones to avoid unbounded growth", () => {
    let nextState = baseState;

    for (let index = 0; index < MAX_CLOSED_WHISPERS + 5; index += 1) {
      nextState = reduceWhisperState(
        nextState,
        createEnvelope("WHISPER_CLOSE", "alice", {
          id: `w${index}`,
          updatedAt: index + 1
        })
      );
    }

    expect(Object.keys(nextState.closedWhisperUpdatedAts)).toHaveLength(MAX_CLOSED_WHISPERS);
    expect(nextState.closedWhisperUpdatedAts.w0).toBeUndefined();
    expect(nextState.closedWhisperUpdatedAts[`w${MAX_CLOSED_WHISPERS + 4}`]).toBe(MAX_CLOSED_WHISPERS + 5);
  });

  it("clears selected whisper and restores main volume when selected whisper closes", () => {
    const created = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 10))
    );

    const selected: WhisperCoreState = {
      ...created,
      selectedWhisperId: "w1",
      mainVolume: 0.3
    };

    const closed = reduceWhisperState(
      selected,
      createEnvelope("WHISPER_CLOSE", "alice", {
        id: "w1",
        updatedAt: 10
      })
    );

    expect(closed.selectedWhisperId).toBeUndefined();
    expect(closed.mainVolume).toBe(1);
  });

  it("clears selected whisper when local identity is no longer a member after enforcement", () => {
    const selectedState: WhisperCoreState = {
      ...baseState,
      whispers: {
        w1: whisperWithMembers("w1", ["alice", "bob", "dave"], 10)
      },
      selectedWhisperId: "w1",
      mainVolume: 0.3
    };

    const updated = reduceWhisperState(
      selectedState,
      createEnvelope("WHISPER_CREATE", "carol", whisperWithMembers("w2", ["alice", "carol"], 20))
    );

    expect(updated.whispers.w1.members).toEqual(["bob", "dave"]);
    expect(updated.selectedWhisperId).toBeUndefined();
    expect(updated.mainVolume).toBe(1);
  });

  it("keeps spotlight unchanged when SPOTLIGHT_UPDATE contains null identity", () => {
    const current: WhisperCoreState = {
      ...baseState,
      spotlightIdentity: "gm"
    };

    const next = reduceWhisperState(
      current,
      createEnvelope("SPOTLIGHT_UPDATE", "gm", {
        identity: null,
        updatedAt: 123
      })
    );

    expect(next.spotlightIdentity).toBe("gm");
  });

  it("normalizes members by removing duplicates on whisper create", () => {
    const created = reduceWhisperState(
      baseState,
      createEnvelope("WHISPER_CREATE", "alice", {
        id: "w1",
        members: ["alice", "bob", "alice", "bob"],
        createdBy: "alice",
        createdAt: 10,
        updatedAt: 10
      })
    );

    expect(created.whispers.w1.members).toEqual(["alice", "bob"]);
  });
});
