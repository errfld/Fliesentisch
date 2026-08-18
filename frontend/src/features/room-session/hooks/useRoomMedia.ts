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
import { useMediaDevicePreferences } from "@/features/room-session/hooks/useMediaDevicePreferences";

type UseRoomMediaInput = {
  room: Room | null;
};

export function useRoomMedia({ room }: UseRoomMediaInput) {
  const [isInitializing, setIsInitializing] = useState(Boolean(room));
  const [error, setError] = useState<string | null>(null);
  const [isPttActive, setIsPttActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [isCameraInitializing, setIsCameraInitializing] = useState(false);
  const [isMicToggling, setIsMicToggling] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);

  const mainTrackRef = useRef<LocalAudioTrack | null>(null);
  const mainPubRef = useRef<LocalTrackPublication | null>(null);
  const whisperTrackRef = useRef<LocalAudioTrack | null>(null);
  const whisperPubRef = useRef<LocalTrackPublication | null>(null);
  const whisperTrackIdRef = useRef<string | null>(null);
  const mainMutedBeforePttRef = useRef(false);
  const cameraTrackRef = useRef<LocalVideoTrack | null>(null);
  const cameraPubRef = useRef<LocalTrackPublication | null>(null);
  const pendingMediaOperationsRef = useRef(new Set<Promise<unknown>>());
  const isReleasingRef = useRef(false);
  const isReleasing = useCallback(() => isReleasingRef.current, []);
  const mediaPreferences = useMediaDevicePreferences({ room, isReleasing });
  const selectedAudioDeviceRef = useRef(mediaPreferences.selectedAudioDevice);

  useEffect(() => {
    selectedAudioDeviceRef.current = mediaPreferences.selectedAudioDevice;
  }, [mediaPreferences.selectedAudioDevice]);

  const trackMediaOperation = useCallback(<T,>(operation: Promise<T>) => {
    pendingMediaOperationsRef.current.add(operation);
    const removeOperation = () => pendingMediaOperationsRef.current.delete(operation);
    void operation.then(removeOperation, removeOperation);
    return operation;
  }, []);

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
    setIsCameraInitializing(false);
    setIsMicToggling(false);
    setIsPttActive(false);
    setMicEnabled(false);
    setMicReady(false);
  }, []);

  useEffect(() => {
    if (!room) {
      setIsInitializing(false);
      return;
    }
    if (!mediaPreferences.isDeviceDiscoveryComplete) {
      return;
    }

    isReleasingRef.current = false;
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
        setMicReady(false);
        setMicEnabled(false);
        setError(null);

        const initialAudioDevice = selectedAudioDeviceRef.current || undefined;
        mainTrack = await createLocalAudioTrack(
          initialAudioDevice ? { deviceId: { exact: initialAudioDevice } } : undefined
        );
        publication = await room.localParticipant.publishTrack(mainTrack, { name: "main" });

        if (cancelled) {
          await room.localParticipant.unpublishTrack(mainTrack).catch(() => {});
          mainTrack.stop();
          return;
        }

        mainTrackRef.current = mainTrack;
        mainPubRef.current = publication;
        setMicReady(true);
        setMicEnabled(!mainTrack.isMuted);
        setIsInitializing(false);
      } catch (mediaError) {
        if (publication && mainTrack) {
          await room.localParticipant.unpublishTrack(mainTrack).catch(() => {});
        }
        mainTrack?.stop();
        mainTrackRef.current = null;
        mainPubRef.current = null;
        setMicReady(false);
        setMicEnabled(false);
        setError(formatConnectionError(mediaError, "Failed to initialize microphone"));
        setIsInitializing(false);
      }
    };

    void trackMediaOperation(initializeMainTrack());

    return () => {
      cancelled = true;
      void cleanupLocalTracks(room);
    };
  }, [
    cleanupLocalTracks,
    mediaPreferences.isDeviceDiscoveryComplete,
    room,
    trackMediaOperation
  ]);

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
    if (!track || isMicToggling || isReleasingRef.current) {
      return;
    }

    setIsMicToggling(true);
    await trackMediaOperation(
      (async () => {
        try {
          if (track.isMuted) {
            await track.unmute();
            setMicEnabled(true);
          } else {
            await track.mute();
            setMicEnabled(false);
          }
        } finally {
          setIsMicToggling(false);
        }
      })()
    );
  }, [isMicToggling, trackMediaOperation]);

  const toggleCamera = useCallback(async () => {
    if (!room || isCameraInitializing || isReleasingRef.current) {
      return;
    }

    setIsCameraInitializing(true);
    await trackMediaOperation(
      (async () => {
        if (cameraTrackRef.current && cameraPubRef.current) {
          try {
            await room.localParticipant.unpublishTrack(cameraTrackRef.current);
            cameraTrackRef.current.stop();
            cameraTrackRef.current = null;
            cameraPubRef.current = null;
            setCameraEnabled(false);
          } finally {
            setIsCameraInitializing(false);
          }
          return;
        }

        let track: LocalVideoTrack | null = null;

        try {
          track = await createLocalVideoTrack(
            mediaPreferences.selectedVideoDevice
              ? { deviceId: { exact: mediaPreferences.selectedVideoDevice } }
              : undefined
          );
          const publication = await room.localParticipant.publishTrack(track);

          if (isReleasingRef.current) {
            await room.localParticipant.unpublishTrack(track).catch(() => {});
            track.stop();
            return;
          }

          cameraTrackRef.current = track;
          cameraPubRef.current = publication;
          setCameraEnabled(true);
        } catch (cameraError) {
          track?.stop();
          cameraTrackRef.current = null;
          cameraPubRef.current = null;
          setCameraEnabled(false);
          setError(formatConnectionError(cameraError, "Failed to enable camera"));
        } finally {
          setIsCameraInitializing(false);
        }
      })()
    );
  }, [isCameraInitializing, mediaPreferences.selectedVideoDevice, room, trackMediaOperation]);

  const releaseLocalTracks = useCallback(async () => {
    isReleasingRef.current = true;
    while (pendingMediaOperationsRef.current.size > 0) {
      await Promise.allSettled(Array.from(pendingMediaOperationsRef.current));
    }
    await cleanupLocalTracks(room);
  }, [cleanupLocalTracks, room]);

  return {
    audioDevices: mediaPreferences.audioDevices,
    cameraEnabled,
    clearWhisperTrack,
    error: mediaPreferences.error ?? error,
    isCameraInitializing,
    isInitializing,
    isMicToggling,
    isPttActive,
    isSwitchingDevice: mediaPreferences.isSwitchingDevice,
    mirrorSelfView: mediaPreferences.mirrorSelfView,
    micEnabled,
    micReady,
    onMirrorSelfViewChange: mediaPreferences.onMirrorSelfViewChange,
    onSelectAudioDevice: mediaPreferences.onSelectAudioDevice,
    onSelectVideoDevice: mediaPreferences.onSelectVideoDevice,
    releaseLocalTracks,
    selectedAudioDevice: mediaPreferences.selectedAudioDevice,
    selectedVideoDevice: mediaPreferences.selectedVideoDevice,
    startWhisperPtt,
    stopWhisperPtt,
    toggleCamera,
    toggleMic,
    videoDevices: mediaPreferences.videoDevices
  };
}
