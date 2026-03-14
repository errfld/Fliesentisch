import { describe, expect, it } from "vitest";
import { formatIdentityLabel, getWhisperLabel } from "@/features/room-session/lib/session-helpers";
import { buildParticipantRoster, orderGridTiles } from "@/features/room-session/lib/session-selectors";
import type { VideoTileModel } from "@/features/room-session/types";

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
});
