import type { Track } from "livekit-client";
import type { HandoutSpotlight, SplitState, Whisper } from "@/lib/protocol";

export type GameRole = "gamemaster" | "player";
export type PlatformRole = "admin" | "user";

export type VideoTileModel = {
  key: string;
  identity: string;
  trackSid: string;
  track: Track;
  isLocal: boolean;
};

export type AudioTrackModel = {
  key: string;
  identity: string;
  track: Track;
  isMain: boolean;
};

export type ParticipantRosterItem = {
  identity: string;
  label: string;
  isLocal: boolean;
  isSpotlight: boolean;
  isSpeaking: boolean;
  hasVideo: boolean;
  whisperLabel?: string;
};

export type RoomTopBarViewModel = {
  roomName: string;
  displayName: string;
  identity: string;
  participantCount: number;
  activeWhisperCount: number;
  currentRoomName?: string;
  splitActive: boolean;
  spotlightIdentity?: string;
  micEnabled: boolean;
  cameraEnabled: boolean;
  followSpotlight: boolean;
  sidebarOpen: boolean;
};

export type RoomTopBarActions = {
  onToggleMic: () => Promise<void>;
  onToggleCamera: () => Promise<void>;
  onFollowSpotlightChange: (follow: boolean) => void;
  onToggleSidebar: () => void;
  onOpenDiagnostics: () => void;
  onLeave: () => void;
};

export type WhisperPanelViewModel = {
  activeWhispers: ReadonlyArray<Whisper>;
  selectedWhisperId?: string;
  selectedWhisper?: Whisper;
  selectedParticipants: ReadonlyArray<string>;
  whisperNotice: string | null;
  isPttActive: boolean;
  identity: string;
};

export type WhisperPanelActions = {
  onCreateWhisper: () => Promise<void>;
  onSelectWhisper: (whisperId?: string) => void;
  onJoinWhisper: (whisper: Whisper) => Promise<void>;
  onAddSelectedParticipants: (whisper: Whisper) => Promise<void>;
  onLeaveWhisper: (whisper: Whisper) => Promise<void>;
  onCloseWhisper: (whisper: Whisper) => Promise<void>;
};

export type SplitParticipantOption = {
  identity: string;
  label: string;
  isLocal: boolean;
  roomId: string;
};

export type SplitControlPanelViewModel = {
  splitState: SplitState;
  participants: ReadonlyArray<SplitParticipantOption>;
  isPublishingCommand: boolean;
  commandError: string | null;
};

export type CommandResult = { ok: true } | { ok: false };

export type SplitControlPanelActions = {
  onStartSplit: () => Promise<CommandResult>;
  onAddRoom: () => Promise<CommandResult>;
  onRemoveRoom: (roomId: string) => Promise<CommandResult>;
  onRenameRoom: (roomId: string, roomName: string) => Promise<CommandResult>;
  onAssignParticipantToRoom: (participantIdentity: string, roomId: string) => Promise<CommandResult>;
  onSetGmFocusRoom: (roomId: string | null) => Promise<CommandResult>;
  onSetGmBroadcastActive: (active: boolean) => Promise<CommandResult>;
  onEndSplit: () => Promise<CommandResult>;
};

export type VideoGridViewModel = {
  gridTiles: ReadonlyArray<VideoTileModel>;
  gridCount: number;
  spotlightIdentity?: string;
  activeSpeakers: ReadonlySet<string>;
  participantDisplayNames: ReadonlyMap<string, string>;
  selectedParticipantIds: ReadonlySet<string>;
  mirrorSelfView: boolean;
};

export type VideoGridActions = {
  onToggleParticipantSelection: (participantIdentity: string) => void;
  onToggleSpotlight: (participantIdentity: string | null) => Promise<void>;
};

export type HandoutControlPanelViewModel = {
  handout?: HandoutSpotlight;
  isPublishing: boolean;
  commandError: string | null;
};

export type HandoutControlPanelActions = {
  onBroadcast: (imageUrl: string, title: string) => Promise<CommandResult>;
  onStop: () => Promise<CommandResult>;
};

export type HandoutSpotlightViewModel = {
  handout?: HandoutSpotlight;
  presenterLabel: string;
  isMinimized: boolean;
};

export type HandoutSpotlightActions = {
  onMinimize: () => void;
  onRestore: () => void;
};

export type DevicePanelViewModel = {
  audioDevices: ReadonlyArray<MediaDeviceInfo>;
  videoDevices: ReadonlyArray<MediaDeviceInfo>;
  selectedAudioDevice: string;
  selectedVideoDevice: string;
  mirrorSelfView: boolean;
};

export type DevicePanelActions = {
  onMirrorSelfViewChange: (mirrored: boolean) => void;
  onSelectAudioDevice: (deviceId: string) => Promise<void>;
  onSelectVideoDevice: (deviceId: string) => Promise<void>;
};

export type DiagnosticsHealthTone = "good" | "watch" | "poor" | "unknown";

export type DiagnosticsConnectionEventKind =
  | "connected"
  | "signal-reconnecting"
  | "reconnecting"
  | "reconnected";

export type DiagnosticsConnectionEvent = {
  kind: DiagnosticsConnectionEventKind;
  at: number;
};

export type DiagnosticsNetworkHealth = {
  tone: DiagnosticsHealthTone;
  label: string;
  detail: string;
  livekitQuality: string;
  packetLossPercent: number | null;
};

export type DiagnosticsSubscriptionState = {
  published: number;
  subscribed: number;
  muted: number;
};

export type DiagnosticsPanelViewModel = {
  capturedAt: number;
  roomName: string;
  clientIdentity: string;
  connectionState: string;
  reconnectHistory: ReadonlyArray<DiagnosticsConnectionEvent>;
  network: DiagnosticsNetworkHealth;
  microphoneLevel: number;
  microphoneEnabled: boolean;
  inputDeviceLabel: string;
  outputDeviceLabel: string;
  cameraDeviceLabel: string;
  mainAudio: DiagnosticsSubscriptionState;
  whisperAudio: DiagnosticsSubscriptionState;
  video: DiagnosticsSubscriptionState;
  summary: string;
};

export type DiagnosticsPanelActions = {
  onClose: () => void;
};
