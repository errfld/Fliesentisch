import { describe, expect, it } from "vitest";
import { createEnvelope } from "@/lib/protocol";
import {
  canManageHandoutSpotlight,
  normalizeHandoutImageUrl,
  normalizeHandoutTitle,
  resolveHandoutPresenterRole,
  resolveParticipantAuthorityRoles,
  shouldAcceptHandoutEnvelopeFromSender
} from "@/features/room-session/lib/handout-spotlight-rules";

describe("handout spotlight authority", () => {
  it("allows gamemasters and admins but not ordinary players", () => {
    expect(canManageHandoutSpotlight({ gameRole: "gamemaster", platformRole: "user" })).toBe(true);
    expect(canManageHandoutSpotlight({ gameRole: "player", platformRole: "admin" })).toBe(true);
    expect(canManageHandoutSpotlight({ gameRole: "player", platformRole: "user" })).toBe(false);
    expect(resolveHandoutPresenterRole({ gameRole: "gamemaster", platformRole: "admin" })).toBe("admin");
  });

  it("resolves only trusted role attributes", () => {
    expect(resolveParticipantAuthorityRoles({ game_role: "gamemaster", platform_role: "user" })).toEqual({
      gameRole: "gamemaster",
      platformRole: "user"
    });
    expect(resolveParticipantAuthorityRoles({ game_role: "owner", platform_role: "superuser" })).toEqual({
      gameRole: undefined,
      platformRole: undefined
    });
  });

  it("rejects player updates and presenter claims that do not match the sender", () => {
    const update = createEnvelope("HANDOUT_SPOTLIGHT_UPDATE", "gm", {
      handout: {
        imageUrl: "https://example.com/scene.jpg",
        presenterIdentity: "gm",
        presenterRole: "gamemaster",
        updatedAt: 10
      },
      updatedAt: 10
    });

    expect(
      shouldAcceptHandoutEnvelopeFromSender({
        envelope: update,
        senderIdentity: "gm",
        gameRole: "player",
        platformRole: "user"
      })
    ).toBe(false);
    expect(
      shouldAcceptHandoutEnvelopeFromSender({
        envelope: update,
        senderIdentity: "someone-else",
        gameRole: "gamemaster",
        platformRole: "user"
      })
    ).toBe(false);
    expect(
      shouldAcceptHandoutEnvelopeFromSender({
        envelope: update,
        senderIdentity: "gm",
        gameRole: "gamemaster",
        platformRole: "user"
      })
    ).toBe(true);
  });

  it("accepts snapshots from any authorized participant", () => {
    const snapshot = createEnvelope("HANDOUT_STATE_SNAPSHOT", "admin", {
      handout: {
        imageUrl: "https://example.com/scene.jpg",
        presenterIdentity: "gm",
        presenterRole: "gamemaster",
        updatedAt: 10
      },
      updatedAt: 10
    });

    expect(
      shouldAcceptHandoutEnvelopeFromSender({
        envelope: snapshot,
        senderIdentity: "admin",
        gameRole: "player",
        platformRole: "admin"
      })
    ).toBe(true);
  });
});

describe("handout spotlight input normalization", () => {
  it("accepts web image URLs and rejects unsafe or relative URLs", () => {
    expect(normalizeHandoutImageUrl(" https://example.com/map one.jpg ")).toBe(
      "https://example.com/map%20one.jpg"
    );
    expect(normalizeHandoutImageUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeHandoutImageUrl("/local-map.jpg")).toBeNull();
  });

  it("trims and caps optional titles", () => {
    expect(normalizeHandoutTitle("  The Library  ")).toBe("The Library");
    expect(normalizeHandoutTitle("   ")).toBeUndefined();
    expect(normalizeHandoutTitle("x".repeat(100))).toHaveLength(80);
  });
});
