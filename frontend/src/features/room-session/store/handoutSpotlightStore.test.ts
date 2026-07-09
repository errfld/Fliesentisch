import { describe, expect, it } from "vitest";
import { createEnvelope } from "@/lib/protocol";
import {
  reduceHandoutSpotlightState,
  type HandoutSpotlightCoreState
} from "@/features/room-session/store/handoutSpotlightStore";

const baseState: HandoutSpotlightCoreState = {
  handout: undefined,
  updatedAt: 0,
  seenEventIds: {}
};

function handout(updatedAt: number, imageUrl = "https://example.com/scene.jpg") {
  return {
    imageUrl,
    title: "The Observatory",
    presenterIdentity: "gm",
    presenterRole: "gamemaster" as const,
    updatedAt
  };
}

describe("handout spotlight store", () => {
  it("applies start, update, and stop events", () => {
    const started = reduceHandoutSpotlightState(
      baseState,
      createEnvelope("HANDOUT_SPOTLIGHT_UPDATE", "gm", {
        handout: handout(10),
        updatedAt: 10
      })
    );
    const updated = reduceHandoutSpotlightState(
      started,
      createEnvelope("HANDOUT_SPOTLIGHT_UPDATE", "gm", {
        handout: handout(20, "https://example.com/clue.jpg"),
        updatedAt: 20
      })
    );
    const stopped = reduceHandoutSpotlightState(
      updated,
      createEnvelope("HANDOUT_SPOTLIGHT_UPDATE", "gm", {
        handout: null,
        updatedAt: 30
      })
    );

    expect(started.handout?.imageUrl).toContain("scene.jpg");
    expect(updated.handout?.imageUrl).toContain("clue.jpg");
    expect(stopped.handout).toBeUndefined();
    expect(stopped.updatedAt).toBe(30);
  });

  it("hydrates late joiners from snapshots and ignores stale updates", () => {
    const hydrated = reduceHandoutSpotlightState(
      baseState,
      createEnvelope("HANDOUT_STATE_SNAPSHOT", "gm", {
        handout: handout(20),
        updatedAt: 20
      })
    );
    const stale = reduceHandoutSpotlightState(
      hydrated,
      createEnvelope("HANDOUT_SPOTLIGHT_UPDATE", "gm", {
        handout: handout(10, "https://example.com/stale.jpg"),
        updatedAt: 10
      })
    );

    expect(hydrated.handout?.title).toBe("The Observatory");
    expect(stale.handout?.imageUrl).toContain("scene.jpg");
    expect(Object.keys(stale.seenEventIds)).toHaveLength(2);
  });

  it("deduplicates event ids", () => {
    const envelope = createEnvelope("HANDOUT_SPOTLIGHT_UPDATE", "gm", {
      handout: handout(10),
      updatedAt: 10
    });
    const started = reduceHandoutSpotlightState(baseState, envelope);

    expect(reduceHandoutSpotlightState(started, envelope)).toBe(started);
  });
});
