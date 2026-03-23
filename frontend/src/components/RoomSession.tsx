"use client";

import { useMemo, useState } from "react";
import { DevicePanel } from "@/features/room-session/components/DevicePanel";
import { ParticipantRoster } from "@/features/room-session/components/ParticipantRoster";
import { RemoteAudioLayer } from "@/features/room-session/components/RemoteAudioLayer";
import { RoomSessionLayout } from "@/features/room-session/components/RoomSessionLayout";
import { RoomTopBar } from "@/features/room-session/components/RoomTopBar";
import { SessionSidebar } from "@/features/room-session/components/SessionSidebar";
import { VideoGrid } from "@/features/room-session/components/VideoGrid";
import { WhisperPanel } from "@/features/room-session/components/WhisperPanel";
import { useRoomConnection } from "@/features/room-session/hooks/useRoomConnection";
import { useRoomMedia } from "@/features/room-session/hooks/useRoomMedia";
import { useWhisperSession } from "@/features/room-session/hooks/useWhisperSession";
import {
  buildAudioTracks,
  buildParticipantRoster,
  buildVideoTiles,
  orderGridTiles
} from "@/features/room-session/lib/session-selectors";

type RoomSessionProps = {
  roomName: string;
  displayName: string;
  joinKey?: string;
};

export function RoomSession({ roomName, displayName, joinKey }: RoomSessionProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const connection = useRoomConnection({ roomName, displayName, joinKey });
  const media = useRoomMedia({ room: connection.room });
  const whisperSession = useWhisperSession({
    room: connection.room,
    identity: connection.identity,
    renderVersion: connection.renderVersion,
    startWhisperPtt: media.startWhisperPtt,
    stopWhisperPtt: media.stopWhisperPtt,
    clearWhisperTrack: media.clearWhisperTrack
  });

  const isConnecting = connection.isConnecting || media.isInitializing;
  const error = connection.error ?? media.error;

  const participantIdentities = useMemo(() => {
    const version = connection.renderVersion;
    void version;

    if (!connection.identity) {
      return connection.room ? Array.from(connection.room.remoteParticipants.keys()) : [];
    }

    return Array.from(
      new Set([connection.identity, ...Array.from(connection.room?.remoteParticipants.keys() ?? [])])
    );
  }, [connection.identity, connection.renderVersion, connection.room]);

  const videoTiles = useMemo(
    () => {
      const version = connection.renderVersion;
      void version;

      return buildVideoTiles(
        connection.room,
        connection.identity,
        whisperSession.followSpotlight,
        whisperSession.spotlightIdentity
      );
    },
    [
      connection.identity,
      connection.renderVersion,
      connection.room,
      whisperSession.followSpotlight,
      whisperSession.spotlightIdentity
    ]
  );

  const audioTracks = useMemo(
    () => {
      const version = connection.renderVersion;
      void version;

      return buildAudioTracks(connection.room);
    },
    [connection.renderVersion, connection.room]
  );

  const participantRoster = useMemo(
    () =>
      buildParticipantRoster({
        participantIdentities,
        identity: connection.identity,
        activeSpeakers: connection.activeSpeakers,
        videoTiles,
        activeWhispers: whisperSession.activeWhispers,
        spotlightIdentity: whisperSession.spotlightIdentity
      }),
    [
      connection.activeSpeakers,
      connection.identity,
      participantIdentities,
      videoTiles,
      whisperSession.activeWhispers,
      whisperSession.spotlightIdentity
    ]
  );

  const gridTiles = useMemo(
    () => orderGridTiles(videoTiles, whisperSession.spotlightIdentity),
    [videoTiles, whisperSession.spotlightIdentity]
  );

  if (isConnecting) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--c-void)]">
        <div className="text-center">
          <p className="display-face text-xl text-[var(--c-text-warm)]">Entering the table</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">Connecting to room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--c-void)]">
        <div className="max-w-md text-center">
          <p className="display-face text-xl text-[var(--c-ember)]">Connection Failed</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!connection.room) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--c-void)]">
        <p className="text-sm text-[var(--c-text-dim)]">Room is not connected.</p>
      </div>
    );
  }

  return (
    <RoomSessionLayout
      header={
        <RoomTopBar
          roomName={roomName}
          displayName={displayName}
          identity={connection.identity}
          participantCount={participantRoster.length}
          activeWhisperCount={whisperSession.activeWhispers.length}
          spotlightIdentity={whisperSession.spotlightIdentity}
          micEnabled={media.micEnabled}
          cameraEnabled={media.cameraEnabled}
          followSpotlight={whisperSession.followSpotlight}
          sidebarOpen={sidebarOpen}
          onToggleMic={media.toggleMic}
          onToggleCamera={media.toggleCamera}
          onFollowSpotlightChange={whisperSession.setFollowSpotlight}
          onToggleSidebar={() => setSidebarOpen((current) => !current)}
          onLeave={connection.disconnect}
        />
      }
      main={
        <VideoGrid
          gridTiles={gridTiles}
          gridCount={Math.min(gridTiles.length, 12)}
          spotlightIdentity={whisperSession.spotlightIdentity}
          activeSpeakers={connection.activeSpeakers}
          selectedParticipantIds={whisperSession.selectedParticipantIds}
          mirrorSelfView={media.mirrorSelfView}
          onToggleParticipantSelection={whisperSession.toggleParticipantSelection}
          onToggleSpotlight={whisperSession.setSpotlight}
        />
      }
      sidebar={
        <SessionSidebar
          open={sidebarOpen}
          whisperPanel={
            <WhisperPanel
              activeWhispers={whisperSession.activeWhispers}
              selectedWhisperId={whisperSession.selectedWhisperId}
              selectedWhisper={whisperSession.selectedWhisper}
              selectedParticipants={whisperSession.selectedParticipants}
              whisperNotice={whisperSession.whisperNotice}
              isPttActive={media.isPttActive}
              identity={connection.identity}
              onCreateWhisper={whisperSession.createWhisper}
              onSelectWhisper={whisperSession.setSelectedWhisperId}
              onJoinWhisper={whisperSession.joinWhisper}
              onAddSelectedParticipants={whisperSession.addSelectedParticipantsToWhisper}
              onLeaveWhisper={whisperSession.leaveWhisper}
              onCloseWhisper={whisperSession.closeWhisper}
            />
          }
          rosterPanel={<ParticipantRoster participantRoster={participantRoster} />}
          devicePanel={
            <DevicePanel
              audioDevices={media.audioDevices}
              videoDevices={media.videoDevices}
              selectedAudioDevice={media.selectedAudioDevice}
              selectedVideoDevice={media.selectedVideoDevice}
              mirrorSelfView={media.mirrorSelfView}
              onMirrorSelfViewChange={media.onMirrorSelfViewChange}
              onSelectAudioDevice={media.onSelectAudioDevice}
              onSelectVideoDevice={media.onSelectVideoDevice}
            />
          }
        />
      }
      audioLayer={<RemoteAudioLayer audioTracks={audioTracks} mainVolume={whisperSession.mainVolume} />}
    />
  );
}
