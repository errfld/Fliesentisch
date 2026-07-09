import { useCallback, useMemo, useState } from "react";
import { useRoomConnection } from "@/features/room-session/hooks/useRoomConnection";
import { useRoomDiagnostics } from "@/features/room-session/hooks/useRoomDiagnostics";
import { useHandoutSpotlightSession } from "@/features/room-session/hooks/useHandoutSpotlightSession";
import { useRoomMedia } from "@/features/room-session/hooks/useRoomMedia";
import { useRoomParticipants } from "@/features/room-session/hooks/useRoomParticipants";
import { useRoomProtocol } from "@/features/room-session/hooks/useRoomProtocol";
import { useSplitRoomSession } from "@/features/room-session/hooks/useSplitRoomSession";
import { useWhisperSession } from "@/features/room-session/hooks/useWhisperSession";
import {
  buildAudioTracks,
  buildRoomSessionCollections,
  buildVideoTiles,
  resolveParticipantLabel
} from "@/features/room-session/lib/session-selectors";
import type {
  CommandResult,
  DevicePanelActions,
  DevicePanelViewModel,
  HandoutControlPanelActions,
  HandoutControlPanelViewModel,
  HandoutSpotlightActions,
  HandoutSpotlightViewModel,
  RoomTopBarActions,
  RoomTopBarViewModel,
  SplitControlPanelActions,
  SplitControlPanelViewModel,
  VideoGridActions,
  VideoGridViewModel,
  WhisperPanelActions,
  WhisperPanelViewModel
} from "@/features/room-session/types";

type UseRoomSessionViewModelInput = {
  roomName: string;
  displayName: string;
};

function commandResult(ok: boolean): CommandResult {
  return ok ? { ok: true } : { ok: false };
}

export function useRoomSessionViewModel({ roomName, displayName }: UseRoomSessionViewModelInput) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const connection = useRoomConnection({ roomName, displayName });
  const media = useRoomMedia({ room: connection.room });
  const protocol = useRoomProtocol(connection.room);
  const { participantDisplayNames, participantIdentities } = useRoomParticipants({
    room: connection.room,
    identity: connection.identity,
    renderVersion: connection.renderVersion,
    displayName
  });
  const diagnostics = useRoomDiagnostics({
    room: connection.room,
    roomName,
    clientIdentity: connection.identity,
    open: diagnosticsOpen,
    renderVersion: connection.renderVersion,
    microphoneEnabled: media.micEnabled,
    audioDevices: media.audioDevices,
    selectedAudioDevice: media.selectedAudioDevice,
    videoDevices: media.videoDevices,
    selectedVideoDevice: media.selectedVideoDevice
  });
  const splitSession = useSplitRoomSession({
    room: connection.room,
    protocol,
    identity: connection.identity,
    gameRole: connection.gameRole,
    participantIdentities
  });
  const handoutSession = useHandoutSpotlightSession({
    room: connection.room,
    protocol,
    identity: connection.identity,
    gameRole: connection.gameRole,
    platformRole: connection.platformRole
  });
  const whisperSession = useWhisperSession({
    room: connection.room,
    protocol,
    identity: connection.identity,
    renderVersion: connection.renderVersion,
    splitState: splitSession.splitState,
    viewerIsGamemaster: splitSession.viewerIsGamemaster,
    startWhisperPtt: media.startWhisperPtt,
    stopWhisperPtt: media.stopWhisperPtt,
    clearWhisperTrack: media.clearWhisperTrack
  });

  const videoTiles = useMemo(() => {
    const version = connection.renderVersion;
    void version;

    return buildVideoTiles(
      connection.room,
      connection.identity,
      whisperSession.followSpotlight,
      whisperSession.spotlightIdentity
    );
  }, [
    connection.identity,
    connection.renderVersion,
    connection.room,
    whisperSession.followSpotlight,
    whisperSession.spotlightIdentity
  ]);

  const audioTracks = useMemo(() => {
    const version = connection.renderVersion;
    void version;

    return buildAudioTracks(connection.room);
  }, [connection.renderVersion, connection.room]);

  const collections = useMemo(
    () =>
      buildRoomSessionCollections({
        participantIdentities,
        participantDisplayNames,
        viewerIdentity: connection.identity,
        viewerIsGamemaster: splitSession.viewerIsGamemaster,
        activeSpeakers: connection.activeSpeakers,
        videoTiles,
        audioTracks,
        activeWhispers: whisperSession.activeWhispers,
        spotlightIdentity: whisperSession.spotlightIdentity,
        splitState: splitSession.splitState
      }),
    [
      audioTracks,
      connection.activeSpeakers,
      connection.identity,
      participantDisplayNames,
      participantIdentities,
      splitSession.splitState,
      splitSession.viewerIsGamemaster,
      videoTiles,
      whisperSession.activeWhispers,
      whisperSession.spotlightIdentity
    ]
  );

  const toggleSidebar = useCallback(() => setSidebarOpen((current) => !current), []);
  const openDiagnostics = useCallback(() => setDiagnosticsOpen(true), []);
  const closeDiagnostics = useCallback(() => setDiagnosticsOpen(false), []);
  const {
    addRoom,
    assignParticipantToRoom,
    endSplit,
    removeRoom,
    renameRoom,
    setGmBroadcastActive,
    setGmFocusRoom,
    startSplit
  } = splitSession;

  const splitControlActions = useMemo<SplitControlPanelActions>(
    () => ({
      onStartSplit: async () => commandResult(await startSplit()),
      onAddRoom: async () => commandResult(await addRoom()),
      onRemoveRoom: async (roomId) => commandResult(await removeRoom(roomId)),
      onRenameRoom: async (roomId, roomName) => commandResult(await renameRoom(roomId, roomName)),
      onAssignParticipantToRoom: async (participantIdentity, roomId) =>
        commandResult(await assignParticipantToRoom(participantIdentity, roomId)),
      onSetGmFocusRoom: async (roomId) => commandResult(await setGmFocusRoom(roomId)),
      onSetGmBroadcastActive: async (active) => commandResult(await setGmBroadcastActive(active)),
      onEndSplit: async () => commandResult(await endSplit())
    }),
    [
      addRoom,
      assignParticipantToRoom,
      endSplit,
      removeRoom,
      renameRoom,
      setGmBroadcastActive,
      setGmFocusRoom,
      startSplit
    ]
  );

  const topBar = {
    model: {
      roomName,
      displayName,
      identity: connection.identity,
      participantCount: collections.participantRoster.length,
      activeWhisperCount: whisperSession.activeWhispers.length,
      currentRoomName: splitSession.currentRoomName,
      splitActive: splitSession.isActive,
      spotlightIdentity: whisperSession.spotlightIdentity,
      micEnabled: media.micEnabled,
      cameraEnabled: media.cameraEnabled,
      followSpotlight: whisperSession.followSpotlight,
      sidebarOpen
    } satisfies RoomTopBarViewModel,
    actions: {
      onToggleMic: media.toggleMic,
      onToggleCamera: media.toggleCamera,
      onFollowSpotlightChange: whisperSession.setFollowSpotlight,
      onToggleSidebar: toggleSidebar,
      onOpenDiagnostics: openDiagnostics,
      onLeave: connection.disconnect
    } satisfies RoomTopBarActions
  };

  const videoGrid = {
    model: {
      gridTiles: collections.gridTiles,
      gridCount: Math.min(collections.gridTiles.length, 12),
      spotlightIdentity: whisperSession.spotlightIdentity,
      activeSpeakers: connection.activeSpeakers,
      participantDisplayNames,
      selectedParticipantIds: whisperSession.selectedParticipantIds,
      mirrorSelfView: media.mirrorSelfView
    } satisfies VideoGridViewModel,
    actions: {
      onToggleParticipantSelection: whisperSession.toggleParticipantSelection,
      onToggleSpotlight: whisperSession.setSpotlight
    } satisfies VideoGridActions
  };

  const whisperPanel = {
    model: {
      activeWhispers: whisperSession.activeWhispers,
      selectedWhisperId: whisperSession.selectedWhisperId,
      selectedWhisper: whisperSession.selectedWhisper,
      selectedParticipants: whisperSession.selectedParticipants,
      whisperNotice: whisperSession.whisperNotice,
      isPttActive: media.isPttActive,
      identity: connection.identity
    } satisfies WhisperPanelViewModel,
    actions: {
      onCreateWhisper: whisperSession.createWhisper,
      onSelectWhisper: whisperSession.setSelectedWhisperId,
      onJoinWhisper: whisperSession.joinWhisper,
      onAddSelectedParticipants: whisperSession.addSelectedParticipantsToWhisper,
      onLeaveWhisper: whisperSession.leaveWhisper,
      onCloseWhisper: whisperSession.closeWhisper
    } satisfies WhisperPanelActions
  };

  const splitControl = splitSession.canManageSplitRooms
    ? {
        model: {
          splitState: splitSession.splitState,
          participants: collections.splitParticipants,
          isPublishingCommand: splitSession.isPublishingCommand,
          commandError: splitSession.commandError
        } satisfies SplitControlPanelViewModel,
        actions: splitControlActions
      }
    : undefined;

  const devicePanel = {
    model: {
      audioDevices: media.audioDevices,
      videoDevices: media.videoDevices,
      selectedAudioDevice: media.selectedAudioDevice,
      selectedVideoDevice: media.selectedVideoDevice,
      mirrorSelfView: media.mirrorSelfView
    } satisfies DevicePanelViewModel,
    actions: {
      onMirrorSelfViewChange: media.onMirrorSelfViewChange,
      onSelectAudioDevice: media.onSelectAudioDevice,
      onSelectVideoDevice: media.onSelectVideoDevice
    } satisfies DevicePanelActions
  };

  const handoutControl = handoutSession.canManage
    ? {
        model: {
          handout: handoutSession.handout,
          isPublishing: handoutSession.isPublishing,
          commandError: handoutSession.commandError
        } satisfies HandoutControlPanelViewModel,
        actions: {
          onBroadcast: handoutSession.broadcastHandout,
          onStop: handoutSession.stopHandout
        } satisfies HandoutControlPanelActions
      }
    : undefined;

  const handoutSpotlight = {
    model: {
      handout: handoutSession.handout,
      presenterLabel: handoutSession.handout
        ? resolveParticipantLabel(handoutSession.handout.presenterIdentity, participantDisplayNames)
        : "",
      isMinimized: handoutSession.isMinimized
    } satisfies HandoutSpotlightViewModel,
    actions: {
      onMinimize: handoutSession.minimize,
      onRestore: handoutSession.restore
    } satisfies HandoutSpotlightActions
  };

  return {
    status: {
      isConnecting: connection.isConnecting || media.isInitializing,
      error: connection.error ?? media.error,
      isConnected: Boolean(connection.room)
    },
    topBar,
    videoGrid,
    handoutSpotlight,
    sidebar: {
      open: sidebarOpen,
      handoutControl,
      splitPanelVisible: splitSession.canManageSplitRooms || splitSession.isActive || Boolean(splitSession.notice),
      splitControl,
      splitStatus: {
        isActive: splitSession.isActive,
        currentRoomName: splitSession.currentRoomName,
        participantCount: collections.participantRoster.length,
        notice: splitSession.notice
      },
      whisperPanel,
      participantRoster: {
        items: collections.participantRoster,
        title: splitSession.isActive ? "IN ROOM" : "AT TABLE"
      },
      devicePanel
    },
    audioLayer: {
      tracks: collections.visibleAudioTracks,
      mainVolume: whisperSession.mainVolume
    },
    diagnostics: {
      open: diagnosticsOpen,
      panel: {
        model: diagnostics,
        actions: {
          onClose: closeDiagnostics
        }
      }
    }
  };
}
