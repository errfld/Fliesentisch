import { describe, expect, it } from "vitest";
import { createEnvelope, type SplitState, type Whisper } from "@/lib/protocol";
import {
  canAddSideRoom,
  canManageSplitAuthority,
  canViewSplitAsGamemaster,
  canUseWhisperMembersInSplit,
  filterWhispersForSplitView,
  normalizeSplitRoomName,
  resolveParticipantGameRole,
  resolveWhisperRoomId,
  shouldAcceptSplitEnvelopeFromSender
} from "@/features/room-session/lib/split-room-rules";

function activeSplitState(): SplitState {
  return {
    isActive: true,
    rooms: [
      { id: "main", name: "Main Table", kind: "main", updatedAt: 10 },
      { id: "side-1", name: "Library", kind: "side", updatedAt: 10 },
      { id: "side-2", name: "Kitchen", kind: "side", updatedAt: 10 }
    ],
    assignments: {
      alice: "main",
      bob: "side-1",
      carol: "side-1",
      dave: "side-2"
    },
    gmIdentity: "gm",
    gmFocusRoomId: "side-1",
    gmBroadcastActive: false,
    updatedAt: 10
  };
}

function whisper(id: string, members: string[]): Whisper {
  return {
    id,
    members,
    createdBy: members[0] ?? "gm",
    createdAt: 1,
    updatedAt: 1
  };
}

describe("split-room-rules", () => {
  it("caps split mode at three side rooms", () => {
    expect(canAddSideRoom(activeSplitState().rooms)).toBe(true);
    expect(
      canAddSideRoom([
        ...activeSplitState().rooms,
        { id: "side-3", name: "Tower", kind: "side", updatedAt: 10 }
      ])
    ).toBe(false);
  });

  it("only lets the active GM identity manage an active split", () => {
    const splitState = activeSplitState();

    expect(
      canManageSplitAuthority({
        splitState,
        identity: "gm",
        gameRole: "gamemaster"
      })
    ).toBe(true);
    expect(
      canManageSplitAuthority({
        splitState,
        identity: "other-gm",
        gameRole: "gamemaster"
      })
    ).toBe(false);
    expect(
      canManageSplitAuthority({
        splitState,
        identity: "alice",
        gameRole: "player"
      })
    ).toBe(false);
  });

  it("only lets the active split GM keep the global GM view", () => {
    const splitState = activeSplitState();

    expect(
      canViewSplitAsGamemaster({
        splitState,
        identity: "gm",
        gameRole: "gamemaster"
      })
    ).toBe(true);
    expect(
      canViewSplitAsGamemaster({
        splitState,
        identity: "other-gm",
        gameRole: "gamemaster"
      })
    ).toBe(false);
    expect(
      canViewSplitAsGamemaster({
        splitState: {
          ...splitState,
          isActive: false,
          gmIdentity: undefined
        },
        identity: "other-gm",
        gameRole: "gamemaster"
      })
    ).toBe(true);
  });

  it("normalizes split room names with trimming and fallback", () => {
    expect(normalizeSplitRoomName("  Library Annex  ", "Side Room 1")).toBe("Library Annex");
    expect(normalizeSplitRoomName("   ", "Side Room 1")).toBe("Side Room 1");
  });

  it("resolves trusted participant game roles from LiveKit attributes", () => {
    expect(resolveParticipantGameRole({ game_role: "gamemaster" })).toBe("gamemaster");
    expect(resolveParticipantGameRole({ game_role: "player" })).toBe("player");
    expect(resolveParticipantGameRole({})).toBeUndefined();
  });

  it("rejects cross-room whisper membership while split mode is active", () => {
    const splitState = activeSplitState();

    expect(canUseWhisperMembersInSplit(splitState, ["bob", "carol"], "bob")).toBe(true);
    expect(canUseWhisperMembersInSplit(splitState, ["gm", "bob", "carol"], "gm")).toBe(true);
    expect(canUseWhisperMembersInSplit(splitState, ["bob", "dave"], "bob")).toBe(false);
  });

  it("resolves whisper room ids and hides cross-room whispers from players", () => {
    const splitState = activeSplitState();
    const whispers = [
      whisper("side-whisper", ["bob", "carol"]),
      whisper("gm-side-whisper", ["gm", "bob"]),
      whisper("cross-room-whisper", ["bob", "dave"])
    ];

    expect(resolveWhisperRoomId(splitState, whispers[0])).toBe("side-1");
    expect(resolveWhisperRoomId(splitState, whispers[2])).toBeNull();
    expect(
      filterWhispersForSplitView(whispers, {
        splitState,
        viewerIdentity: "bob",
        viewerIsGamemaster: false
      }).map((entry) => entry.id)
    ).toEqual(["side-whisper", "gm-side-whisper"]);
    expect(
      filterWhispersForSplitView(whispers, {
        splitState,
        viewerIdentity: "gm",
        viewerIsGamemaster: true
      }).map((entry) => entry.id)
    ).toEqual(["side-whisper", "gm-side-whisper"]);
  });

  it("only accepts split snapshots and starts from a trusted GM sender", () => {
    const splitState = activeSplitState();
    const startEnvelope = createEnvelope("SPLIT_START", "gm", { splitState });

    expect(
      shouldAcceptSplitEnvelopeFromSender({
        currentState: {
          ...splitState,
          isActive: false,
          gmIdentity: undefined
        },
        envelope: startEnvelope,
        senderIdentity: "gm",
        senderGameRole: "gamemaster"
      })
    ).toBe(true);
    expect(
      shouldAcceptSplitEnvelopeFromSender({
        currentState: {
          ...splitState,
          isActive: false,
          gmIdentity: undefined
        },
        envelope: startEnvelope,
        senderIdentity: "gm",
        senderGameRole: "player"
      })
    ).toBe(false);
    expect(
      shouldAcceptSplitEnvelopeFromSender({
        currentState: splitState,
        envelope: startEnvelope,
        senderIdentity: "other-gm",
        senderGameRole: "gamemaster"
      })
    ).toBe(false);
  });
});
