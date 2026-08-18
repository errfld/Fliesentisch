"use client";

import { useCallback, useEffect, useState } from "react";
import { Room } from "livekit-client";
import {
  canAccessMediaDevices,
  formatConnectionError,
  MEDIA_ACCESS_ERROR
} from "@/features/room-session/lib/session-helpers";

const MIRROR_SELF_VIEW_STORAGE_KEY = "virtual-table-mirror-self-view";
const AUDIO_DEVICE_STORAGE_KEY = "virtual-table-audio-device";
const VIDEO_DEVICE_STORAGE_KEY = "virtual-table-video-device";

type MediaDeviceSwitchRoom = Pick<Room, "switchActiveDevice">;
type InputDeviceKind = "audioinput" | "videoinput";
type MediaPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export type MediaDevicePreferencesDependencies = {
  canAccessMediaDevices: () => boolean;
  getLocalDevices: (kind: InputDeviceKind) => Promise<MediaDeviceInfo[]>;
  getStorage: () => MediaPreferenceStorage | null;
  switchActiveDevice: (
    room: MediaDeviceSwitchRoom,
    kind: InputDeviceKind,
    deviceId: string
  ) => Promise<boolean>;
};

type UseMediaDevicePreferencesInput = {
  room: MediaDeviceSwitchRoom | null;
  isReleasing: () => boolean;
  dependencies?: MediaDevicePreferencesDependencies;
};

export type MediaDevicePreferencesResult = Readonly<{
  audioDevices: MediaDeviceInfo[];
  error: string | null;
  isDeviceDiscoveryComplete: boolean;
  isSwitchingDevice: boolean;
  mirrorSelfView: boolean;
  onMirrorSelfViewChange: (mirrored: boolean) => void;
  onSelectAudioDevice: (deviceId: string) => Promise<void>;
  onSelectVideoDevice: (deviceId: string) => Promise<void>;
  selectedAudioDevice: string;
  selectedVideoDevice: string;
  videoDevices: MediaDeviceInfo[];
}>;

const browserDependencies: MediaDevicePreferencesDependencies = {
  canAccessMediaDevices,
  getLocalDevices: (kind) => Room.getLocalDevices(kind),
  getStorage: () => typeof window === "undefined" ? null : window.localStorage,
  switchActiveDevice: (room, kind, deviceId) => room.switchActiveDevice(kind, deviceId)
};

function storedValue(
  dependencies: MediaDevicePreferencesDependencies,
  key: string
): string {
  return dependencies.getStorage()?.getItem(key) ?? "";
}

function selectAvailableDevice(
  devices: MediaDeviceInfo[],
  currentDeviceId: string,
  storedDeviceId: string
): string {
  if (devices.some((device) => device.deviceId === currentDeviceId)) {
    return currentDeviceId;
  }
  if (devices.some((device) => device.deviceId === storedDeviceId)) {
    return storedDeviceId;
  }
  return devices[0]?.deviceId ?? "";
}

export function useMediaDevicePreferences({
  room,
  isReleasing,
  dependencies = browserDependencies
}: UseMediaDevicePreferencesInput): MediaDevicePreferencesResult {
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState(() =>
    storedValue(dependencies, AUDIO_DEVICE_STORAGE_KEY)
  );
  const [selectedVideoDevice, setSelectedVideoDevice] = useState(() =>
    storedValue(dependencies, VIDEO_DEVICE_STORAGE_KEY)
  );
  const [mirrorSelfView, setMirrorSelfView] = useState(() =>
    storedValue(dependencies, MIRROR_SELF_VIEW_STORAGE_KEY) === "true"
  );
  const [isDeviceDiscoveryComplete, setIsDeviceDiscoveryComplete] = useState(false);
  const [isSwitchingDevice, setIsSwitchingDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadDevices = async () => {
      if (!dependencies.canAccessMediaDevices()) {
        setError(MEDIA_ACCESS_ERROR);
        setIsDeviceDiscoveryComplete(true);
        return;
      }

      try {
        const [audios, videos] = await Promise.all([
          dependencies.getLocalDevices("audioinput"),
          dependencies.getLocalDevices("videoinput")
        ]);
        if (cancelled) {
          return;
        }

        setAudioDevices(audios);
        setVideoDevices(videos);
        const storedAudio = storedValue(dependencies, AUDIO_DEVICE_STORAGE_KEY);
        const storedVideo = storedValue(dependencies, VIDEO_DEVICE_STORAGE_KEY);
        setSelectedAudioDevice((current) =>
          selectAvailableDevice(audios, current, storedAudio)
        );
        setSelectedVideoDevice((current) =>
          selectAvailableDevice(videos, current, storedVideo)
        );
      } catch (deviceError) {
        if (!cancelled) {
          setError(formatConnectionError(deviceError, "Failed to query media devices"));
        }
      } finally {
        if (!cancelled) {
          setIsDeviceDiscoveryComplete(true);
        }
      }
    };

    void loadDevices();
    return () => {
      cancelled = true;
    };
  }, [dependencies]);

  useEffect(() => {
    const storage = dependencies.getStorage();
    if (storage?.getItem(MIRROR_SELF_VIEW_STORAGE_KEY) === null) {
      storage.setItem(MIRROR_SELF_VIEW_STORAGE_KEY, "false");
    }
  }, [dependencies]);

  const selectDevice = useCallback(
    async (kind: InputDeviceKind, deviceId: string) => {
      if (!room || isReleasing()) {
        return;
      }

      setIsSwitchingDevice(true);
      try {
        const didSwitch = await dependencies.switchActiveDevice(room, kind, deviceId);
        if (!didSwitch) {
          const message = kind === "audioinput"
            ? "Failed to switch microphone"
            : "Failed to switch camera";
          setError(message);
          throw new Error(message);
        }

        setError(null);
        if (kind === "audioinput") {
          setSelectedAudioDevice(deviceId);
          dependencies.getStorage()?.setItem(AUDIO_DEVICE_STORAGE_KEY, deviceId);
        } else {
          setSelectedVideoDevice(deviceId);
          dependencies.getStorage()?.setItem(VIDEO_DEVICE_STORAGE_KEY, deviceId);
        }
      } finally {
        setIsSwitchingDevice(false);
      }
    },
    [dependencies, isReleasing, room]
  );

  const onSelectAudioDevice = useCallback(
    (deviceId: string) => selectDevice("audioinput", deviceId),
    [selectDevice]
  );
  const onSelectVideoDevice = useCallback(
    (deviceId: string) => selectDevice("videoinput", deviceId),
    [selectDevice]
  );
  const onMirrorSelfViewChange = useCallback(
    (mirrored: boolean) => {
      dependencies
        .getStorage()
        ?.setItem(MIRROR_SELF_VIEW_STORAGE_KEY, mirrored ? "true" : "false");
      setMirrorSelfView(mirrored);
    },
    [dependencies]
  );

  return {
    audioDevices,
    error,
    isDeviceDiscoveryComplete,
    isSwitchingDevice,
    mirrorSelfView,
    onMirrorSelfViewChange,
    onSelectAudioDevice,
    onSelectVideoDevice,
    selectedAudioDevice,
    selectedVideoDevice,
    videoDevices
  };
}
