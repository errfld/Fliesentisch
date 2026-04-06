import { Track } from "livekit-client";
import type { RemoteTrack, Room } from "livekit-client";
import type { SplitState, Whisper } from "@/lib/protocol";
import type { AudioTrackModel, ParticipantRosterItem, VideoTileModel } from "@/features/room-session/types";
import { formatIdentityLabel, getWhisperLabel } from "@/features/room-session/lib/session-helpers";

export const MAIN_SPLIT_ROOM_ID = "main";
export const MAIN_SPLIT_ROOM_NAME = "Main Table";

export function buildVideoTiles(
  room: Room | null,
  identity: string,
  followSpotlight: boolean,
  spotlightIdentity?: string
): VideoTileModel[] {
  if (!room) {
    return [];
  }

  const tiles: VideoTileModel[] = [];

  room.localParticipant.trackPublications.forEach((publication) => {
    if (publication.kind === Track.Kind.Video && publication.track) {
      tiles.push({
        key: `local-${publication.trackSid}`,
        identity,
        trackSid: publication.trackSid,
        track: publication.track,
        isLocal: true
      });
    }
  });

  room.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      if (publication.kind !== Track.Kind.Video || !publication.track) {
        return;
      }

      tiles.push({
        key: `${participant.identity}-${publication.trackSid}`,
        identity: participant.identity,
        trackSid: publication.trackSid,
        track: publication.track as RemoteTrack,
        isLocal: false
      });
    });
  });

  if (followSpotlight && spotlightIdentity) {
    tiles.sort((a, b) => {
      if (a.identity === spotlightIdentity && b.identity !== spotlightIdentity) {
        return -1;
      }
      if (b.identity === spotlightIdentity && a.identity !== spotlightIdentity) {
        return 1;
      }
      return a.identity.localeCompare(b.identity);
    });
  }

  return tiles;
}

export function buildAudioTracks(room: Room | null): AudioTrackModel[] {
  if (!room) {
    return [];
  }

  const tracks: AudioTrackModel[] = [];
  room.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      if (publication.kind !== Track.Kind.Audio || !publication.track) {
        return;
      }

      tracks.push({
        key: `${participant.identity}-${publication.trackSid}`,
        identity: participant.identity,
        track: publication.track,
        isMain: publication.trackName === "main"
      });
    });
  });

  return tracks;
}

type BuildParticipantRosterInput = {
  participantIdentities: string[];
  identity: string;
  activeSpeakers: Set<string>;
  videoTiles: VideoTileModel[];
  activeWhispers: Whisper[];
  spotlightIdentity?: string;
};

export function buildParticipantRoster({
  participantIdentities,
  identity,
  activeSpeakers,
  videoTiles,
  activeWhispers,
  spotlightIdentity
}: BuildParticipantRosterInput): ParticipantRosterItem[] {
  return participantIdentities
    .map((participantIdentity) => {
      const whisper = activeWhispers.find((entry) => entry.members.includes(participantIdentity));
      return {
        identity: participantIdentity,
        label: formatIdentityLabel(participantIdentity),
        isLocal: participantIdentity === identity,
        isSpotlight: participantIdentity === spotlightIdentity,
        isSpeaking: activeSpeakers.has(participantIdentity),
        hasVideo: videoTiles.some((tile) => tile.identity === participantIdentity),
        whisperLabel: whisper ? getWhisperLabel(whisper) : undefined
      };
    })
    .sort((a, b) => {
      if (a.isSpotlight && !b.isSpotlight) {
        return -1;
      }
      if (b.isSpotlight && !a.isSpotlight) {
        return 1;
      }
      if (a.isLocal && !b.isLocal) {
        return -1;
      }
      if (b.isLocal && !a.isLocal) {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });
}

export function orderGridTiles(videoTiles: VideoTileModel[], spotlightIdentity?: string): VideoTileModel[] {
  const ordered = [...videoTiles];
  if (!spotlightIdentity) {
    return ordered;
  }

  const spotlightIndex = ordered.findIndex((tile) => tile.identity === spotlightIdentity);
  if (spotlightIndex > 0) {
    const [tile] = ordered.splice(spotlightIndex, 1);
    ordered.unshift(tile);
  }

  return ordered;
}

export function resolveParticipantRoomId(splitState: SplitState, participantIdentity: string): string {
  if (!splitState.isActive || !participantIdentity) {
    return MAIN_SPLIT_ROOM_ID;
  }

  const assignedRoomId = splitState.assignments[participantIdentity];
  if (!assignedRoomId) {
    return MAIN_SPLIT_ROOM_ID;
  }

  const roomExists = splitState.rooms.some((room) => room.id === assignedRoomId);
  return roomExists ? assignedRoomId : MAIN_SPLIT_ROOM_ID;
}

type SplitViewInput = {
  splitState: SplitState;
  viewerIdentity: string;
  viewerIsGamemaster: boolean;
};

export function filterParticipantIdentitiesForSplitView(
  participantIdentities: string[],
  splitView: SplitViewInput
): string[] {
  if (!splitView.splitState.isActive || splitView.viewerIsGamemaster || !splitView.viewerIdentity) {
    return participantIdentities;
  }

  const viewerRoomId = resolveParticipantRoomId(splitView.splitState, splitView.viewerIdentity);
  return participantIdentities.filter((participantIdentity) => {
    if (participantIdentity === splitView.viewerIdentity) {
      return true;
    }

    if (splitView.splitState.gmIdentity && participantIdentity === splitView.splitState.gmIdentity) {
      return true;
    }

    return resolveParticipantRoomId(splitView.splitState, participantIdentity) === viewerRoomId;
  });
}

export function filterVideoTilesForSplitView(
  videoTiles: VideoTileModel[],
  splitView: SplitViewInput
): VideoTileModel[] {
  const visibleParticipants = new Set(filterParticipantIdentitiesForSplitView(videoTiles.map((tile) => tile.identity), splitView));
  return videoTiles.filter((tile) => visibleParticipants.has(tile.identity));
}

export function filterAudioTracksForSplitView(
  audioTracks: AudioTrackModel[],
  splitView: SplitViewInput
): AudioTrackModel[] {
  if (!splitView.splitState.isActive || splitView.viewerIsGamemaster || !splitView.viewerIdentity) {
    return audioTracks;
  }

  const viewerRoomId = resolveParticipantRoomId(splitView.splitState, splitView.viewerIdentity);
  return audioTracks.filter((track) => {
    if (splitView.splitState.gmIdentity && track.identity === splitView.splitState.gmIdentity) {
      if (!track.isMain) {
        return true;
      }

      return (
        splitView.splitState.gmBroadcastActive ||
        splitView.splitState.gmFocusRoomId === viewerRoomId
      );
    }

    return resolveParticipantRoomId(splitView.splitState, track.identity) === viewerRoomId;
  });
}
