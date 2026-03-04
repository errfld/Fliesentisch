import { describe, expect, it } from "vitest";
import { createEnvelope } from "@/lib/protocol";
import { reduceWhisperState } from "@/store/whisperStore";
import type { Whisper } from "@/lib/protocol";
import type { WhisperCoreState } from "@/store/whisperStore";

const baseState: WhisperCoreState = {
  localIdentity: "alice",
  whispers: {},
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
    const s1 = reduceWhisperState(baseState, createEnvelope("WHISPER_CREATE", "alice", whisper("w1", 1, 1)));
    const s2 = reduceWhisperState(s1, createEnvelope("WHISPER_CREATE", "alice", whisper("w2", 2, 2)));
    const s3 = reduceWhisperState(s2, createEnvelope("WHISPER_CREATE", "alice", whisper("w3", 3, 3)));
    const s4 = reduceWhisperState(s3, createEnvelope("WHISPER_CREATE", "alice", whisper("w4", 4, 4)));

    expect(Object.keys(s4.whispers).sort()).toEqual(["w1", "w2", "w3"]);
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
});
