"use client";

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
import { useRoomSessionViewModel } from "@/features/room-session/hooks/useRoomSessionViewModel";

type RoomSessionControllerProps = {
  roomName: string;
  displayName: string;
};

export function RoomSessionController({ roomName, displayName }: RoomSessionControllerProps) {
  const viewModel = useRoomSessionViewModel({ roomName, displayName });

  if (viewModel.status.isConnecting) {
    return <RoomSessionState title="Entering the table" message="Connecting to room..." />;
  }

  if (viewModel.status.error) {
    return <RoomSessionState title="Connection Failed" message={viewModel.status.error} tone="error" />;
  }

  if (!viewModel.status.isConnected) {
    return <RoomSessionState message="Room is not connected." />;
  }

  const splitPanel = viewModel.sidebar.splitPanelVisible ? (
    <>
      {viewModel.sidebar.splitControl ? <SplitControlPanel {...viewModel.sidebar.splitControl} /> : null}
      <SplitStatusPanel {...viewModel.sidebar.splitStatus} />
    </>
  ) : undefined;

  return (
    <RoomSessionLayout
      header={<RoomTopBar {...viewModel.topBar} />}
      main={<VideoGrid {...viewModel.videoGrid} />}
      sidebar={
        <SessionSidebar
          open={viewModel.sidebar.open}
          splitPanel={splitPanel}
          whisperPanel={<WhisperPanel {...viewModel.sidebar.whisperPanel} />}
          rosterPanel={
            <ParticipantRoster
              participantRoster={viewModel.sidebar.participantRoster.items}
              title={viewModel.sidebar.participantRoster.title}
            />
          }
          devicePanel={<DevicePanel {...viewModel.sidebar.devicePanel} />}
        />
      }
      audioLayer={
        <RemoteAudioLayer
          audioTracks={viewModel.audioLayer.tracks}
          mainVolume={viewModel.audioLayer.mainVolume}
        />
      }
    />
  );
}
