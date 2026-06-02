"use client";

import { useMemo, useState } from "react";
import { DevicePanel } from "@/features/room-session/components/DevicePanel";
import { ParticipantRoster } from "@/features/room-session/components/ParticipantRoster";
import { RemoteAudioLayer } from "@/features/room-session/components/RemoteAudioLayer";
import { RoomSessionLayout } from "@/features/room-session/components/RoomSessionLayout";
import { RoomSessionState } from "@/features/room-session/components/RoomSessionState";
import { RoomTopBar } from "@/features/room-session/components/RoomTopBar";
import { SessionSidebar } from "@/features/room-session/components/SessionSidebar";
import { SplitControlPanel } from "@/features/room-session/components/SplitControlPanel";
import { SplitStatusPanel } from "@/features/room-session/components/SplitStatusPanel";
import { VideoGrid } from "@/features/room-session/components/VideoGrid";
import { WhisperPanel } from "@/features/room-session/components/WhisperPanel";
import { useRoomConnection } from "@/features/room-session/hooks/useRoomConnection";
import { useRoomMedia } from "@/features/room-session/hooks/useRoomMedia";
import { useRoomParticipants } from "@/features/room-session/hooks/useRoomParticipants";
import { useSplitRoomSession } from "@/features/room-session/hooks/useSplitRoomSession";
import { useWhisperSession } from "@/features/room-session/hooks/useWhisperSession";
import {
  buildAudioTracks,
  buildParticipantRoster,
  buildVideoTiles,
  filterAudioTracksForSplitView,
  filterParticipantIdentitiesForSplitView,
  filterVideoTilesForSplitView,
  orderGridTiles,
  resolveParticipantLabel,
  resolveParticipantRoomId
} from "@/features/room-session/lib/session-selectors";

type RoomSessionControllerProps = {
  roomName: string;
  displayName: string;
};

export function RoomSessionController({ roomName, displayName }: RoomSessionControllerProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const connection = useRoomConnection({ roomName, displayName });
  const media = useRoomMedia({ room: connection.room });
  const { participantDisplayNames, participantIdentities } = useRoomParticipants({
    room: connection.room,
    identity: connection.identity,
    renderVersion: connection.renderVersion,
    displayName
  });
  const splitSession = useSplitRoomSession({
    room: connection.room,
    identity: connection.identity,
    gameRole: connection.gameRole,
    participantIdentities
  });
  const whisperSession = useWhisperSession({
    room: connection.room,
    identity: connection.identity,
    renderVersion: connection.renderVersion,
    splitState: splitSession.splitState,
    viewerIsGamemaster: splitSession.viewerIsGamemaster,
    startWhisperPtt: media.startWhisperPtt,
    stopWhisperPtt: media.stopWhisperPtt,
    clearWhisperTrack: media.clearWhisperTrack
  });

  const isConnecting = connection.isConnecting || media.isInitializing;
  const error = connection.error ?? media.error;

  const visibleParticipantIdentities = useMemo(
    () =>
      filterParticipantIdentitiesForSplitView(participantIdentities, {
        splitState: splitSession.splitState,
        viewerIdentity: connection.identity,
        viewerIsGamemaster: splitSession.viewerIsGamemaster
      }),
    [connection.identity, participantIdentities, splitSession.splitState, splitSession.viewerIsGamemaster]
  );

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

  const visibleVideoTiles = useMemo(
    () =>
      filterVideoTilesForSplitView(videoTiles, {
        splitState: splitSession.splitState,
        viewerIdentity: connection.identity,
        viewerIsGamemaster: splitSession.viewerIsGamemaster
      }),
    [connection.identity, splitSession.splitState, splitSession.viewerIsGamemaster, videoTiles]
  );

  const audioTracks = useMemo(
    () => {
      const version = connection.renderVersion;
      void version;

      return buildAudioTracks(connection.room);
    },
    [connection.renderVersion, connection.room]
  );

  const visibleAudioTracks = useMemo(
    () =>
      filterAudioTracksForSplitView(audioTracks, {
        splitState: splitSession.splitState,
        viewerIdentity: connection.identity,
        viewerIsGamemaster: splitSession.viewerIsGamemaster
      }),
    [audioTracks, connection.identity, splitSession.splitState, splitSession.viewerIsGamemaster]
  );

  const participantRoster = useMemo(
    () =>
      buildParticipantRoster({
        participantIdentities: visibleParticipantIdentities,
        participantDisplayNames,
        identity: connection.identity,
        activeSpeakers: connection.activeSpeakers,
        videoTiles: visibleVideoTiles,
        activeWhispers: whisperSession.activeWhispers,
        spotlightIdentity: whisperSession.spotlightIdentity
      }),
    [
      connection.activeSpeakers,
      connection.identity,
      participantDisplayNames,
      visibleParticipantIdentities,
      visibleVideoTiles,
      whisperSession.activeWhispers,
      whisperSession.spotlightIdentity
    ]
  );

  const gridTiles = useMemo(
    () => orderGridTiles(visibleVideoTiles, whisperSession.spotlightIdentity),
    [visibleVideoTiles, whisperSession.spotlightIdentity]
  );
  const splitParticipants = useMemo(
    () =>
      participantIdentities
        .map((participantIdentity) => ({
          identity: participantIdentity,
          label: resolveParticipantLabel(participantIdentity, participantDisplayNames),
          isLocal: participantIdentity === connection.identity,
          roomId: resolveParticipantRoomId(splitSession.splitState, participantIdentity)
        }))
        .sort((left, right) => {
          if (left.identity === splitSession.splitState.gmIdentity && right.identity !== splitSession.splitState.gmIdentity) {
            return -1;
          }
          if (right.identity === splitSession.splitState.gmIdentity && left.identity !== splitSession.splitState.gmIdentity) {
            return 1;
          }
          if (left.isLocal && !right.isLocal) {
            return -1;
          }
          if (right.isLocal && !left.isLocal) {
            return 1;
          }
          if (left.roomId !== right.roomId) {
            return left.roomId.localeCompare(right.roomId);
          }
          return left.label.localeCompare(right.label);
        }),
    [connection.identity, participantDisplayNames, participantIdentities, splitSession.splitState]
  );
  const splitPanel =
    splitSession.canManageSplitRooms || splitSession.isActive || splitSession.notice ? (
      <>
        {splitSession.canManageSplitRooms ? (
          <SplitControlPanel
            splitState={splitSession.splitState}
            participants={splitParticipants}
            isPublishingCommand={splitSession.isPublishingCommand}
            commandError={splitSession.commandError}
            onStartSplit={splitSession.startSplit}
            onAddRoom={splitSession.addRoom}
            onRemoveRoom={splitSession.removeRoom}
            onRenameRoom={splitSession.renameRoom}
            onAssignParticipantToRoom={splitSession.assignParticipantToRoom}
            onSetGmFocusRoom={splitSession.setGmFocusRoom}
            onSetGmBroadcastActive={splitSession.setGmBroadcastActive}
            onEndSplit={splitSession.endSplit}
          />
        ) : null}
        <SplitStatusPanel
          isActive={splitSession.isActive}
          currentRoomName={splitSession.currentRoomName}
          participantCount={participantRoster.length}
          notice={splitSession.notice}
        />
      </>
    ) : undefined;

  if (isConnecting) {
    return <RoomSessionState title="Entering the table" message="Connecting to room..." />;
  }

  if (error) {
    return <RoomSessionState title="Connection Failed" message={error} tone="error" />;
  }

  if (!connection.room) {
    return <RoomSessionState message="Room is not connected." />;
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
          currentRoomName={splitSession.currentRoomName}
          splitActive={splitSession.isActive}
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
          participantDisplayNames={participantDisplayNames}
          selectedParticipantIds={whisperSession.selectedParticipantIds}
          mirrorSelfView={media.mirrorSelfView}
          onToggleParticipantSelection={whisperSession.toggleParticipantSelection}
          onToggleSpotlight={whisperSession.setSpotlight}
        />
      }
      sidebar={
        <SessionSidebar
          open={sidebarOpen}
          splitPanel={splitPanel}
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
          rosterPanel={
            <ParticipantRoster
              participantRoster={participantRoster}
              title={splitSession.isActive ? "IN ROOM" : "AT TABLE"}
            />
          }
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
      audioLayer={<RemoteAudioLayer audioTracks={visibleAudioTracks} mainVolume={whisperSession.mainVolume} />}
    />
  );
}
