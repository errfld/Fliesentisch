import { describe, expect, it } from "vitest";
import type { SplitState } from "@/lib/protocol";
import { formatIdentityLabel, getWhisperLabel } from "@/features/room-session/lib/session-helpers";
import {
  buildParticipantRoster,
  filterAudioTracksForSplitView,
  filterParticipantIdentitiesForSplitView,
  orderGridTiles,
  resolveParticipantRoomId
} from "@/features/room-session/lib/session-selectors";
import type { AudioTrackModel, VideoTileModel } from "@/features/room-session/types";

describe("room session selectors", () => {
  it("formats participant identities for display", () => {
    expect(formatIdentityLabel("alice-the-brave-abc123def456")).toBe("Alice The Brave");
  });

  it("prefers whisper titles and falls back to ids", () => {
    expect(
      getWhisperLabel({
        id: "abcdef123456",
        title: "Secret Plan",
        members: [],
        createdBy: "alice",
        createdAt: 1,
        updatedAt: 1
      })
    ).toBe("Secret Plan");

    expect(
      getWhisperLabel({
        id: "abcdef123456",
        members: [],
        createdBy: "alice",
        createdAt: 1,
        updatedAt: 1
      })
    ).toBe("Whisper abcdef");
  });

  it("sorts the participant roster by spotlight then local identity", () => {
    const videoTiles: VideoTileModel[] = [
      {
        key: "alice-track",
        identity: "alice-abc123def456",
        trackSid: "track-a",
        track: {} as VideoTileModel["track"],
        isLocal: false
      },
      {
        key: "bob-track",
        identity: "bob-abc123def456",
        trackSid: "track-b",
        track: {} as VideoTileModel["track"],
        isLocal: true
      }
    ];

    const roster = buildParticipantRoster({
      participantIdentities: ["bob-abc123def456", "carol-abc123def456", "alice-abc123def456"],
      identity: "bob-abc123def456",
      activeSpeakers: new Set(["carol-abc123def456"]),
      videoTiles,
      activeWhispers: [
        {
          id: "whisper-1",
          members: ["alice-abc123def456", "carol-abc123def456"],
          createdBy: "alice-abc123def456",
          createdAt: 1,
          updatedAt: 2
        }
      ],
      spotlightIdentity: "alice-abc123def456"
    });

    expect(roster.map((participant) => participant.identity)).toEqual([
      "alice-abc123def456",
      "bob-abc123def456",
      "carol-abc123def456"
    ]);
    expect(roster[2]?.whisperLabel).toBe("Whisper whispe");
  });

  it("moves the spotlight tile to the front", () => {
    const tiles: VideoTileModel[] = [
      {
        key: "bob-track",
        identity: "bob",
        trackSid: "track-b",
        track: {} as VideoTileModel["track"],
        isLocal: true
      },
      {
        key: "alice-track",
        identity: "alice",
        trackSid: "track-a",
        track: {} as VideoTileModel["track"],
        isLocal: false
      }
    ];

    expect(orderGridTiles(tiles, "alice").map((tile) => tile.identity)).toEqual(["alice", "bob"]);
  });

  it("resolves participants without assignments back to the main room", () => {
    const splitState: SplitState = {
      isActive: true,
      rooms: [
        { id: "main", name: "Main Table", kind: "main", updatedAt: 10 },
        { id: "side-1", name: "Library", kind: "side", updatedAt: 10 }
      ],
      assignments: {
        bob: "side-1",
        carol: "missing-room"
      },
      gmIdentity: "gm",
      gmBroadcastActive: false,
      updatedAt: 10
    };

    expect(resolveParticipantRoomId(splitState, "alice")).toBe("main");
    expect(resolveParticipantRoomId(splitState, "bob")).toBe("side-1");
    expect(resolveParticipantRoomId(splitState, "carol")).toBe("main");
  });

  it("filters participants to the viewer room plus the GM during split mode", () => {
    const splitState: SplitState = {
      isActive: true,
      rooms: [
        { id: "main", name: "Main Table", kind: "main", updatedAt: 10 },
        { id: "side-1", name: "Library", kind: "side", updatedAt: 10 }
      ],
      assignments: {
        alice: "main",
        bob: "side-1",
        carol: "side-1"
      },
      gmIdentity: "gm",
      gmFocusRoomId: "side-1",
      gmBroadcastActive: false,
      updatedAt: 10
    };

    expect(
      filterParticipantIdentitiesForSplitView(["gm", "alice", "bob", "carol"], {
        splitState,
        viewerIdentity: "alice",
        viewerIsGamemaster: false
      })
    ).toEqual(["gm", "alice"]);
  });

  it("only lets players hear the GM main track when focused or broadcasting to their room", () => {
    const splitState: SplitState = {
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
    };

    const audioTracks: AudioTrackModel[] = [
      {
        key: "gm-main",
        identity: "gm",
        track: {} as AudioTrackModel["track"],
        isMain: true
      },
      {
        key: "bob-main",
        identity: "bob",
        track: {} as AudioTrackModel["track"],
        isMain: true
      }
    ];

    expect(
      filterAudioTracksForSplitView(audioTracks, {
        splitState,
        viewerIdentity: "alice",
        viewerIsGamemaster: false
      }).map((track) => track.identity)
    ).toEqual([]);

    expect(
      filterAudioTracksForSplitView(audioTracks, {
        splitState,
        viewerIdentity: "bob",
        viewerIsGamemaster: false
      }).map((track) => track.identity)
    ).toEqual(["gm", "bob"]);
  });
});
