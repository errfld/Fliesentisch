import { describe, expect, it } from "vitest";
import { Whisper } from "@/lib/protocol";
import { collectReassignmentMutations, enforceSingleWhisperMembership } from "@/lib/whisper-membership";

function whisper(id: string, members: string[], updatedAt: number): Whisper {
  return {
    id,
    members,
    createdBy: members[0] ?? "system",
    createdAt: updatedAt,
    updatedAt
  };
}

describe("enforceSingleWhisperMembership", () => {
  it("keeps each participant only in the most recently updated whisper", () => {
    const result = enforceSingleWhisperMembership({
      old: whisper("old", ["alice", "bob"], 10),
      newer: whisper("newer", ["alice", "carol"], 20)
    });

    expect(result.newer.members).toEqual(["alice", "carol"]);
    expect(result.old).toBeUndefined();
  });

  it("keeps older whispers when they still have at least two members after reassignment", () => {
    const result = enforceSingleWhisperMembership({
      w1: whisper("w1", ["alice", "bob", "carol"], 10),
      w2: whisper("w2", ["carol", "dave"], 11)
    });

    expect(result.w2.members).toEqual(["carol", "dave"]);
    expect(result.w1.members).toEqual(["alice", "bob"]);
  });

  it("does not claim members from whispers that are discarded", () => {
    const result = enforceSingleWhisperMembership({
      w1: whisper("w1", ["bob", "carol"], 10),
      w2: whisper("w2", ["alice", "bob"], 20),
      w3: whisper("w3", ["alice", "dave"], 30)
    });

    expect(result.w3.members).toEqual(["alice", "dave"]);
    expect(result.w2).toBeUndefined();
    expect(result.w1.members).toEqual(["bob", "carol"]);
  });
});

describe("collectReassignmentMutations", () => {
  it("emits updates and closes when moving members out of other whispers", () => {
    const mutations = collectReassignmentMutations(
      {
        w1: whisper("w1", ["alice", "bob", "carol"], 10),
        w2: whisper("w2", ["dave", "erin"], 10),
        w3: whisper("w3", ["carol", "frank"], 10)
      },
      "target",
      ["carol"],
      50
    );

    expect(mutations).toEqual([
      {
        type: "update",
        whisper: {
          ...whisper("w1", ["alice", "bob"], 50),
          createdAt: 10
        }
      },
      {
        type: "close",
        payload: {
          id: "w3",
          updatedAt: 50
        }
      }
    ]);
  });

  it("ignores the target whisper while reconciling", () => {
    const mutations = collectReassignmentMutations(
      {
        target: whisper("target", ["alice", "bob"], 10)
      },
      "target",
      ["alice", "bob"],
      99
    );

    expect(mutations).toEqual([]);
  });
});
