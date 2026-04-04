import type { Track } from "livekit-client";
import type { Whisper } from "@/lib/protocol";

export type GameRole = "gamemaster" | "player";

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

export type RoomSessionControls = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  followSpotlight: boolean;
  sidebarOpen: boolean;
  onToggleMic: () => Promise<void>;
  onToggleCamera: () => Promise<void>;
  onFollowSpotlightChange: (follow: boolean) => void;
  onToggleSidebar: () => void;
  onLeave: () => void;
};

export type WhisperPanelState = {
  activeWhispers: Whisper[];
  selectedWhisperId?: string;
  selectedWhisper?: Whisper;
  selectedParticipants: string[];
  whisperNotice: string | null;
  isPttActive: boolean;
  identity: string;
};
