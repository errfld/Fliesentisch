"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectionQuality, Room, RoomEvent, Track } from "livekit-client";
import type { Participant, RemoteAudioTrack, RemoteVideoTrack } from "livekit-client";
import {
  deriveNetworkHealth,
  formatDiagnosticSummary
} from "@/features/room-session/lib/diagnostics";
import type {
  DiagnosticsConnectionEvent,
  DiagnosticsConnectionEventKind,
  DiagnosticsPanelViewModel,
  DiagnosticsSubscriptionState
} from "@/features/room-session/types";

type UseRoomDiagnosticsInput = {
  room: Room | null;
  roomName: string;
  clientIdentity: string;
  open: boolean;
  renderVersion: number;
  microphoneEnabled: boolean;
  audioDevices: ReadonlyArray<MediaDeviceInfo>;
  selectedAudioDevice: string;
  videoDevices: ReadonlyArray<MediaDeviceInfo>;
  selectedVideoDevice: string;
};

const EMPTY_SUBSCRIPTIONS: DiagnosticsSubscriptionState = {
  published: 0,
  subscribed: 0,
  muted: 0
};

export function useRoomDiagnostics({
  room,
  roomName,
  clientIdentity,
  open,
  renderVersion,
  microphoneEnabled,
  audioDevices,
  selectedAudioDevice,
  videoDevices,
  selectedVideoDevice
}: UseRoomDiagnosticsInput): DiagnosticsPanelViewModel {
  const [capturedAt, setCapturedAt] = useState(() => Date.now());
  const [reconnectHistory, setReconnectHistory] = useState<DiagnosticsConnectionEvent[]>([]);
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [packetLossPercent, setPacketLossPercent] = useState<number | null>(null);
  const [livekitQuality, setLivekitQuality] = useState<string>(ConnectionQuality.Unknown);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [snapshotVersion, setSnapshotVersion] = useState(0);

  useEffect(() => {
    if (!room) {
      setReconnectHistory([]);
      setLivekitQuality(ConnectionQuality.Unknown);
      setPacketLossPercent(null);
      setOutputDevices([]);
      return;
    }

    setCapturedAt(Date.now());
    setPacketLossPercent(null);
    setReconnectHistory([{ kind: "connected", at: Date.now() }]);
    setLivekitQuality(room.localParticipant.connectionQuality);

    const record = (kind: DiagnosticsConnectionEventKind) => {
      setReconnectHistory((current) => [
        ...current.slice(-9),
        { kind, at: Date.now() }
      ]);
      setCapturedAt(Date.now());
    };
    const onConnectionQualityChanged = (quality: ConnectionQuality, participant: Participant) => {
      if (participant.identity === room.localParticipant.identity) {
        setLivekitQuality(quality);
        setCapturedAt(Date.now());
      }
    };
    const onSignalReconnecting = () => record("signal-reconnecting");
    const onReconnecting = () => record("reconnecting");
    const onReconnected = () => record("reconnected");

    room.on(RoomEvent.SignalReconnecting, onSignalReconnecting);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.ConnectionQualityChanged, onConnectionQualityChanged);

    return () => {
      room.off(RoomEvent.SignalReconnecting, onSignalReconnecting);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.ConnectionQualityChanged, onConnectionQualityChanged);
    };
  }, [room]);

  useEffect(() => {
    if (!room || !open) {
      setMicrophoneLevel(0);
      return;
    }

    const refreshMicrophoneLevel = () => {
      setMicrophoneLevel(clamp(room.localParticipant.audioLevel, 0, 1));
    };
    refreshMicrophoneLevel();
    const timer = window.setInterval(refreshMicrophoneLevel, 150);
    return () => window.clearInterval(timer);
  }, [open, room]);

  useEffect(() => {
    if (!room || !open) {
      return;
    }

    let cancelled = false;
    const refresh = async () => {
      const nextPacketLoss = await collectReceiverPacketLoss(room);
      if (cancelled) {
        return;
      }
      setPacketLossPercent(nextPacketLoss);
      setCapturedAt(Date.now());
      setSnapshotVersion((current) => current + 1);
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, room]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const loadOutputDevices = async () => {
      try {
        const devices = await Room.getLocalDevices("audiooutput");
        if (!cancelled) {
          setOutputDevices(devices);
        }
      } catch {
        if (!cancelled) {
          setOutputDevices([]);
        }
      }
    };

    void loadOutputDevices();
    return () => {
      cancelled = true;
    };
  }, [open, room]);

  const subscriptions = useMemo(() => {
    const version = renderVersion + snapshotVersion;
    void version;
    return collectSubscriptionStates(room);
  }, [renderVersion, room, snapshotVersion]);
  const connectionState = room?.state ?? "disconnected";
  const network = deriveNetworkHealth({
    connectionState,
    livekitQuality,
    packetLossPercent
  });
  const outputDeviceId = room?.getActiveDevice("audiooutput") ?? "default";
  const snapshot: Omit<DiagnosticsPanelViewModel, "summary"> = {
    capturedAt,
    roomName,
    clientIdentity,
    connectionState,
    reconnectHistory,
    network,
    microphoneLevel,
    microphoneEnabled,
    inputDeviceLabel: resolveDeviceLabel(audioDevices, selectedAudioDevice, "Microphone unavailable"),
    outputDeviceLabel: resolveDeviceLabel(outputDevices, outputDeviceId, "Browser default / unavailable"),
    cameraDeviceLabel: resolveDeviceLabel(videoDevices, selectedVideoDevice, "Camera unavailable"),
    mainAudio: subscriptions.mainAudio,
    whisperAudio: subscriptions.whisperAudio,
    video: subscriptions.video
  };

  return {
    ...snapshot,
    summary: formatDiagnosticSummary(snapshot)
  };
}

function collectSubscriptionStates(room: Room | null): {
  mainAudio: DiagnosticsSubscriptionState;
  whisperAudio: DiagnosticsSubscriptionState;
  video: DiagnosticsSubscriptionState;
} {
  if (!room) {
    return {
      mainAudio: { ...EMPTY_SUBSCRIPTIONS },
      whisperAudio: { ...EMPTY_SUBSCRIPTIONS },
      video: { ...EMPTY_SUBSCRIPTIONS }
    };
  }

  const result = {
    mainAudio: { ...EMPTY_SUBSCRIPTIONS },
    whisperAudio: { ...EMPTY_SUBSCRIPTIONS },
    video: { ...EMPTY_SUBSCRIPTIONS }
  };

  room.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      const state = publication.kind === Track.Kind.Video
        ? result.video
        : publication.trackName.startsWith("whisper:")
          ? result.whisperAudio
          : result.mainAudio;
      state.published += 1;
      state.subscribed += publication.isSubscribed ? 1 : 0;
      state.muted += publication.isMuted ? 1 : 0;
    });
  });

  return result;
}

async function collectReceiverPacketLoss(room: Room): Promise<number | null> {
  const statsPromises: Array<Promise<{ packetsLost?: number; packetsReceived?: number } | undefined>> = [];

  room.remoteParticipants.forEach((participant) => {
    participant.trackPublications.forEach((publication) => {
      if (!publication.isSubscribed || !publication.track) {
        return;
      }

      if (publication.kind === Track.Kind.Audio) {
        statsPromises.push((publication.track as RemoteAudioTrack).getReceiverStats());
      } else if (publication.kind === Track.Kind.Video) {
        statsPromises.push((publication.track as RemoteVideoTrack).getReceiverStats());
      }
    });
  });

  if (statsPromises.length === 0) {
    return null;
  }

  const settled = await Promise.allSettled(statsPromises);
  let packetsLost = 0;
  let packetsReceived = 0;
  settled.forEach((result) => {
    if (result.status !== "fulfilled" || !result.value) {
      return;
    }
    packetsLost += Math.max(0, result.value.packetsLost ?? 0);
    packetsReceived += Math.max(0, result.value.packetsReceived ?? 0);
  });

  const total = packetsLost + packetsReceived;
  return total > 0 ? (packetsLost / total) * 100 : null;
}

function resolveDeviceLabel(
  devices: ReadonlyArray<MediaDeviceInfo>,
  selectedDeviceId: string,
  fallback: string
): string {
  const selected = devices.find((device) => device.deviceId === selectedDeviceId)
    ?? (selectedDeviceId === "default" ? devices.find((device) => device.deviceId === "default") : undefined)
    ?? devices[0];
  return selected?.label || fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
