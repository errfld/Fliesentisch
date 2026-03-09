"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  Room
} from "livekit-client";
import type { LocalAudioTrack, LocalTrackPublication, LocalVideoTrack } from "livekit-client";
import {
  canAccessMediaDevices,
  formatConnectionError,
  MEDIA_ACCESS_ERROR
} from "@/features/room-session/lib/session-helpers";

type UseRoomMediaInput = {
  room: Room | null;
};

export function useRoomMedia({ room }: UseRoomMediaInput) {
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPttActive, setIsPttActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState("");
  const [selectedVideoDevice, setSelectedVideoDevice] = useState("");

  const mainTrackRef = useRef<LocalAudioTrack | null>(null);
  const mainPubRef = useRef<LocalTrackPublication | null>(null);
  const whisperTrackRef = useRef<LocalAudioTrack | null>(null);
  const whisperPubRef = useRef<LocalTrackPublication | null>(null);
  const whisperTrackIdRef = useRef<string | null>(null);
  const mainMutedBeforePttRef = useRef(false);
  const cameraTrackRef = useRef<LocalVideoTrack | null>(null);
  const cameraPubRef = useRef<LocalTrackPublication | null>(null);

  const cleanupLocalTracks = useCallback(async (targetRoom: Room | null) => {
    if (targetRoom && cameraPubRef.current && cameraTrackRef.current) {
      await targetRoom.localParticipant.unpublishTrack(cameraTrackRef.current).catch(() => {});
    }
    if (targetRoom && whisperPubRef.current && whisperTrackRef.current) {
      await targetRoom.localParticipant.unpublishTrack(whisperTrackRef.current).catch(() => {});
    }
    if (targetRoom && mainPubRef.current && mainTrackRef.current) {
      await targetRoom.localParticipant.unpublishTrack(mainTrackRef.current).catch(() => {});
    }

    cameraTrackRef.current?.stop();
    whisperTrackRef.current?.stop();
    mainTrackRef.current?.stop();

    cameraTrackRef.current = null;
    cameraPubRef.current = null;
    whisperTrackRef.current = null;
    whisperPubRef.current = null;
    whisperTrackIdRef.current = null;
    mainTrackRef.current = null;
    mainPubRef.current = null;
    mainMutedBeforePttRef.current = false;

    setCameraEnabled(false);
    setIsPttActive(false);
    setMicEnabled(true);
  }, []);

  useEffect(() => {
    const loadDevices = async () => {
      if (!canAccessMediaDevices()) {
        setError(MEDIA_ACCESS_ERROR);
        return;
      }

      try {
        const [audios, videos] = await Promise.all([
          Room.getLocalDevices("audioinput"),
          Room.getLocalDevices("videoinput")
        ]);

        setAudioDevices(audios);
        setVideoDevices(videos);
        if (audios[0]) {
          setSelectedAudioDevice((current) => current || audios[0].deviceId);
        }
        if (videos[0]) {
          setSelectedVideoDevice((current) => current || videos[0].deviceId);
        }
      } catch (deviceError) {
        setError(formatConnectionError(deviceError, "Failed to query media devices"));
      }
    };

    void loadDevices();
  }, []);

  useEffect(() => {
    if (!room) {
      setIsInitializing(false);
      return;
    }

    let cancelled = false;
    let mainTrack: LocalAudioTrack | null = null;
    let publication: LocalTrackPublication | null = null;

    const initializeMainTrack = async () => {
      if (!canAccessMediaDevices()) {
        setError(MEDIA_ACCESS_ERROR);
        setIsInitializing(false);
        return;
      }

      try {
        setIsInitializing(true);
        setError(null);

        mainTrack = await createLocalAudioTrack();
        publication = await room.localParticipant.publishTrack(mainTrack, { name: "main" });

        if (cancelled) {
          await room.localParticipant.unpublishTrack(mainTrack).catch(() => {});
          mainTrack.stop();
          return;
        }

        mainTrackRef.current = mainTrack;
        mainPubRef.current = publication;
        setMicEnabled(!mainTrack.isMuted);
        setIsInitializing(false);
      } catch (mediaError) {
        if (publication && mainTrack) {
          await room.localParticipant.unpublishTrack(mainTrack).catch(() => {});
        }
        mainTrack?.stop();
        mainTrackRef.current = null;
        mainPubRef.current = null;
        setError(formatConnectionError(mediaError, "Failed to initialize microphone"));
        setIsInitializing(false);
      }
    };

    void initializeMainTrack();

    return () => {
      cancelled = true;
      void cleanupLocalTracks(room);
    };
  }, [cleanupLocalTracks, room]);

  const clearWhisperTrack = useCallback(async () => {
    if (room && whisperPubRef.current && whisperTrackRef.current) {
      await room.localParticipant.unpublishTrack(whisperTrackRef.current).catch(() => {});
      whisperTrackRef.current.stop();
    } else {
      whisperTrackRef.current?.stop();
    }

    whisperTrackRef.current = null;
    whisperPubRef.current = null;
    whisperTrackIdRef.current = null;
    setIsPttActive(false);
  }, [room]);

  const ensureWhisperTrack = useCallback(
    async (whisperId: string) => {
      if (!room) {
        return null;
      }

      if (whisperTrackRef.current && whisperTrackIdRef.current === whisperId) {
        return whisperTrackRef.current;
      }

      await clearWhisperTrack();

      const whisperTrack = await createLocalAudioTrack();
      await whisperTrack.mute();
      const whisperPublication = await room.localParticipant.publishTrack(whisperTrack, {
        name: `whisper:${whisperId}`
      });

      whisperTrackRef.current = whisperTrack;
      whisperPubRef.current = whisperPublication;
      whisperTrackIdRef.current = whisperId;

      return whisperTrack;
    },
    [clearWhisperTrack, room]
  );

  const startWhisperPtt = useCallback(
    async (whisperId: string) => {
      const whisperTrack = await ensureWhisperTrack(whisperId);
      if (!whisperTrack) {
        return;
      }

      const mainTrack = mainTrackRef.current;
      if (mainTrack) {
        mainMutedBeforePttRef.current = mainTrack.isMuted;
        if (!mainTrack.isMuted) {
          await mainTrack.mute();
        }
        setMicEnabled(false);
      }

      await whisperTrack.unmute();
      setIsPttActive(true);
    },
    [ensureWhisperTrack]
  );

  const stopWhisperPtt = useCallback(async () => {
    if (whisperTrackRef.current && !whisperTrackRef.current.isMuted) {
      await whisperTrackRef.current.mute();
    }

    const mainTrack = mainTrackRef.current;
    if (mainTrack && !mainMutedBeforePttRef.current) {
      await mainTrack.unmute();
      setMicEnabled(true);
    }

    setIsPttActive(false);
  }, []);

  const toggleMic = useCallback(async () => {
    const track = mainTrackRef.current;
    if (!track) {
      return;
    }

    if (track.isMuted) {
      await track.unmute();
      setMicEnabled(true);
    } else {
      await track.mute();
      setMicEnabled(false);
    }
  }, []);

  const toggleCamera = useCallback(async () => {
    if (!room) {
      return;
    }

    if (cameraTrackRef.current && cameraPubRef.current) {
      await room.localParticipant.unpublishTrack(cameraTrackRef.current);
      cameraTrackRef.current.stop();
      cameraTrackRef.current = null;
      cameraPubRef.current = null;
      setCameraEnabled(false);
      return;
    }

    let track: LocalVideoTrack | null = null;

    try {
      track = await createLocalVideoTrack(
        selectedVideoDevice ? { deviceId: { exact: selectedVideoDevice } } : undefined
      );
      const publication = await room.localParticipant.publishTrack(track);

      cameraTrackRef.current = track;
      cameraPubRef.current = publication;
      setCameraEnabled(true);
    } catch (cameraError) {
      track?.stop();
      cameraTrackRef.current = null;
      cameraPubRef.current = null;
      setCameraEnabled(false);
      setError(formatConnectionError(cameraError, "Failed to enable camera"));
    }
  }, [room, selectedVideoDevice]);

  const onSelectAudioDevice = useCallback(
    async (deviceId: string) => {
      if (!room) {
        return;
      }

      const didSwitch = await room.switchActiveDevice("audioinput", deviceId);
      if (!didSwitch) {
        const switchError = new Error("Failed to switch microphone");
        setError(switchError.message);
        throw switchError;
      }

      setError(null);
      setSelectedAudioDevice(deviceId);
    },
    [room]
  );

  const onSelectVideoDevice = useCallback(
    async (deviceId: string) => {
      if (!room) {
        return;
      }

      const didSwitch = await room.switchActiveDevice("videoinput", deviceId);
      if (!didSwitch) {
        const switchError = new Error("Failed to switch camera");
        setError(switchError.message);
        throw switchError;
      }

      setError(null);
      setSelectedVideoDevice(deviceId);
    },
    [room]
  );

  return {
    audioDevices,
    cameraEnabled,
    clearWhisperTrack,
    error,
    isInitializing,
    isPttActive,
    micEnabled,
    onSelectAudioDevice,
    onSelectVideoDevice,
    selectedAudioDevice,
    selectedVideoDevice,
    startWhisperPtt,
    stopWhisperPtt,
    toggleCamera,
    toggleMic,
    videoDevices
  };
}
