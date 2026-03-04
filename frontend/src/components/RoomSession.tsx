"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DisconnectReason,
  createLocalAudioTrack,
  createLocalVideoTrack,
  LocalAudioTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  RemoteTrack,
  Room,
  RoomEvent,
  Track
} from "livekit-client";
import { createUuid, getOrCreateClientId, toIdentity } from "@/lib/client-id";
import {
  AnyProtocolEnvelope,
  createEnvelope,
  parseProtocolEnvelope,
  SpotlightPayload,
  Whisper,
  WhisperClosePayload
} from "@/lib/protocol";
import { collectReassignmentMutations } from "@/lib/whisper-membership";
import { useWhisperPtt } from "@/hooks/useWhisperPtt";
import { useWhisperStore } from "@/store/whisperStore";
import { TrackElement } from "@/components/TrackElement";

type RoomSessionProps = {
  roomName: string;
  displayName: string;
  joinKey?: string;
};

type VideoTile = {
  key: string;
  identity: string;
  trackSid: string;
  track: Track;
  isLocal: boolean;
};

type AudioTrackItem = {
  key: string;
  track: Track;
  isMain: boolean;
};

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL;
const MEDIA_ACCESS_ERROR =
  "Microphone/camera access requires HTTPS (or localhost) and browser permission to use media devices.";

function canAccessMediaDevices(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

function formatConnectionError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback;
  const normalized = message.toLowerCase();
  if (normalized.includes("getusermedia") || normalized.includes("mediadevices")) {
    return MEDIA_ACCESS_ERROR;
  }
  return message;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";
}

export function RoomSession({ roomName, displayName, joinKey }: RoomSessionProps) {
  const [clientId, setClientId] = useState("");
  const [token, setToken] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [isPttActive, setIsPttActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState("");
  const [selectedVideoDevice, setSelectedVideoDevice] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [whisperNotice, setWhisperNotice] = useState<string | null>(null);

  const mainTrackRef = useRef<LocalAudioTrack | null>(null);
  const mainPubRef = useRef<LocalTrackPublication | null>(null);
  const whisperTrackRef = useRef<LocalAudioTrack | null>(null);
  const whisperPubRef = useRef<LocalTrackPublication | null>(null);
  const whisperTrackIdRef = useRef<string | null>(null);
  const mainMutedBeforePttRef = useRef(false);
  const cameraTrackRef = useRef<LocalVideoTrack | null>(null);
  const cameraPubRef = useRef<LocalTrackPublication | null>(null);

  const whispers = useWhisperStore((state) => state.whispers);
  const selectedWhisperId = useWhisperStore((state) => state.selectedWhisperId);
  const mainVolume = useWhisperStore((state) => state.mainVolume);
  const spotlightIdentity = useWhisperStore((state) => state.spotlightIdentity);
  const followSpotlight = useWhisperStore((state) => state.followSpotlight);
  const setLocalIdentity = useWhisperStore((state) => state.setLocalIdentity);
  const setSelectedWhisperId = useWhisperStore((state) => state.setSelectedWhisperId);
  const setFollowSpotlight = useWhisperStore((state) => state.setFollowSpotlight);
  const applyEnvelope = useWhisperStore((state) => state.applyEnvelope);

  const livekitUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return LIVEKIT_URL ?? "ws://localhost:7880";
    }

    if (LIVEKIT_URL) {
      try {
        const parsed = new URL(LIVEKIT_URL);
        const browserHost = window.location.hostname;
        if (window.location.protocol === "https:" && parsed.protocol === "ws:") {
          parsed.protocol = "wss:";
        }
        if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost)) {
          parsed.hostname = browserHost;
        }
        return parsed.toString();
      } catch {
        return LIVEKIT_URL;
      }
    }
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.hostname}:7880`;
  }, []);

  const identity = useMemo(() => {
    if (!clientId) {
      return "";
    }
    return toIdentity(displayName, clientId);
  }, [displayName, clientId]);

  const selectedWhisper = selectedWhisperId ? whispers[selectedWhisperId] : undefined;
  const isSelectedMember = Boolean(selectedWhisper && selectedWhisper.members.includes(identity));
  const selectedParticipants = useMemo(
    () => Array.from(selectedParticipantIds).sort((a, b) => a.localeCompare(b)),
    [selectedParticipantIds]
  );

  useEffect(() => {
    setClientId(getOrCreateClientId());
  }, []);

  useEffect(() => {
    if (identity) {
      setLocalIdentity(identity);
    }
  }, [identity, setLocalIdentity]);

  const publishEnvelope = useCallback(
    async (envelope: AnyProtocolEnvelope, applyLocally = true) => {
      if (applyLocally) {
        applyEnvelope(envelope);
      }
      if (!room) {
        return;
      }

      const payload = new TextEncoder().encode(JSON.stringify(envelope));
      await room.localParticipant.publishData(payload, { reliable: true });
    },
    [applyEnvelope, room]
  );

  useEffect(() => {
    if (!identity) {
      return;
    }

    const controller = new AbortController();
    setIsConnecting(true);
    setError(null);

    const fetchToken = async () => {
      try {
        const response = await fetch("/api/v1/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            room: roomName,
            identity,
            name: displayName,
            join_key: joinKey
          }),
          signal: controller.signal
        });

        const body = await response.json();
        if (!response.ok) {
          const code = body?.error?.code ?? "TOKEN_REQUEST_FAILED";
          const message = body?.error?.message ?? "Failed to fetch access token";
          throw new Error(`${code}: ${message}`);
        }

        setToken(body.token);
        return;
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to fetch access token");
        setIsConnecting(false);
      }
    };

    void fetchToken();

    return () => controller.abort();
  }, [displayName, identity, joinKey, roomName]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    const lkRoom = new Room({ adaptiveStream: true, dynacast: true });

    const connect = async () => {
      if (!canAccessMediaDevices()) {
        setError(MEDIA_ACCESS_ERROR);
        setIsConnecting(false);
        return;
      }

      let mainTrack: LocalAudioTrack | null = null;
      let publication: LocalTrackPublication | null = null;

      try {
        setIsConnecting(true);
        setError(null);
        await lkRoom.connect(livekitUrl, token);
        mainTrack = await createLocalAudioTrack();
        publication = await lkRoom.localParticipant.publishTrack(mainTrack, { name: "main" });

        if (cancelled) {
          mainTrack.stop();
          lkRoom.disconnect();
          return;
        }

        mainTrackRef.current = mainTrack;
        mainPubRef.current = publication;
        setMicEnabled(!mainTrack.isMuted);
        setRoom(lkRoom);
        setIsConnecting(false);
      } catch (err) {
        if (mainTrack && publication) {
          try {
            await lkRoom.localParticipant.unpublishTrack(mainTrack);
          } catch {
            // Best-effort cleanup for partially initialized local tracks.
          }
        }
        mainTrack?.stop();
        mainTrackRef.current = null;
        mainPubRef.current = null;
        lkRoom.disconnect();
        setRoom(null);
        setError(formatConnectionError(err, "Failed to connect to LiveKit"));
        setIsConnecting(false);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (cameraPubRef.current && cameraTrackRef.current) {
        void lkRoom.localParticipant.unpublishTrack(cameraTrackRef.current);
      }
      if (whisperPubRef.current && whisperTrackRef.current) {
        void lkRoom.localParticipant.unpublishTrack(whisperTrackRef.current);
      }
      if (mainPubRef.current && mainTrackRef.current) {
        void lkRoom.localParticipant.unpublishTrack(mainTrackRef.current);
      }

      cameraTrackRef.current?.stop();
      whisperTrackRef.current?.stop();
      mainTrackRef.current?.stop();
      lkRoom.disconnect();
      setRoom(null);
    };
  }, [livekitUrl, token]);

  useEffect(() => {
    if (!room || !identity) {
      return;
    }

    const onData = (payload: Uint8Array) => {
      const raw = new TextDecoder().decode(payload);
      const envelope = parseProtocolEnvelope(raw);
      if (!envelope) {
        return;
      }

      if (envelope.type === "STATE_REQUEST") {
        const snapshot = createEnvelope("STATE_SNAPSHOT", identity, {
          whispers: Object.values(useWhisperStore.getState().whispers),
          spotlightIdentity: useWhisperStore.getState().spotlightIdentity ?? null
        });
        void publishEnvelope(snapshot, false);
        return;
      }

      applyEnvelope(envelope);
    };

    room.on(RoomEvent.DataReceived, onData);

    const stateRequest = createEnvelope("STATE_REQUEST", identity, {});
    void publishEnvelope(stateRequest, false);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [applyEnvelope, identity, publishEnvelope, room]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const refresh = () => setRenderTick((tick) => tick + 1);
    const onDisconnected = (reason?: DisconnectReason) => {
      setRoom(null);
      setIsConnecting(false);
      if (reason && reason !== DisconnectReason.CLIENT_INITIATED) {
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          setError("Disconnected: duplicate identity. Refresh to generate a new client ID.");
        } else {
          setError(`Disconnected (${String(reason)}).`);
        }
      }
      setRenderTick((tick) => tick + 1);
    };
    const onActiveSpeakers = () => {
      setActiveSpeakers(new Set(room.activeSpeakers.map((participant) => participant.identity)));
      refresh();
    };

    room.on(RoomEvent.ParticipantConnected, refresh);
    room.on(RoomEvent.ParticipantDisconnected, refresh);
    room.on(RoomEvent.TrackPublished, refresh);
    room.on(RoomEvent.TrackUnpublished, refresh);
    room.on(RoomEvent.TrackSubscribed, refresh);
    room.on(RoomEvent.TrackUnsubscribed, refresh);
    room.on(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
    room.on(RoomEvent.Disconnected, onDisconnected);

    return () => {
      room.off(RoomEvent.ParticipantConnected, refresh);
      room.off(RoomEvent.ParticipantDisconnected, refresh);
      room.off(RoomEvent.TrackPublished, refresh);
      room.off(RoomEvent.TrackUnpublished, refresh);
      room.off(RoomEvent.TrackSubscribed, refresh);
      room.off(RoomEvent.TrackUnsubscribed, refresh);
      room.off(RoomEvent.ActiveSpeakersChanged, onActiveSpeakers);
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [room]);

  useEffect(() => {
    if (!room) {
      setSelectedParticipantIds(new Set());
      return;
    }

    const connectedIdentities = new Set(Array.from(room.remoteParticipants.keys()));
    setSelectedParticipantIds((current) => {
      const filtered = Array.from(current).filter((participantId) => connectedIdentities.has(participantId));
      if (filtered.length === current.size) {
        return current;
      }
      return new Set(filtered);
    });
  }, [renderTick, room]);

  const applySelectiveSubscriptions = useCallback(() => {
    if (!room) {
      return;
    }

    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.kind !== Track.Kind.Audio) {
          return;
        }

        const trackName = publication.trackName ?? "";
        if (trackName === "main") {
          publication.setSubscribed(true);
          return;
        }

        if (trackName.startsWith("whisper:")) {
          const whisperId = trackName.slice("whisper:".length);
          const isMember = whispers[whisperId]?.members.includes(identity) ?? false;
          publication.setSubscribed(isMember);
          return;
        }

        publication.setSubscribed(true);
      });
    });
  }, [identity, room, whispers]);

  useEffect(() => {
    applySelectiveSubscriptions();
  }, [applySelectiveSubscriptions]);

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

  const ensureWhisperTrack = useCallback(
    async (whisperId: string) => {
      if (!room) {
        return null;
      }

      if (whisperTrackRef.current && whisperTrackIdRef.current === whisperId) {
        return whisperTrackRef.current;
      }

      if (whisperPubRef.current && whisperTrackRef.current) {
        await room.localParticipant.unpublishTrack(whisperTrackRef.current);
        whisperTrackRef.current.stop();
      }

      const whisperTrack = await createLocalAudioTrack();
      const whisperPublication = await room.localParticipant.publishTrack(whisperTrack, {
        name: `whisper:${whisperId}`
      });
      await whisperTrack.mute();

      whisperTrackRef.current = whisperTrack;
      whisperPubRef.current = whisperPublication;
      whisperTrackIdRef.current = whisperId;
      return whisperTrack;
    },
    [room]
  );

  useEffect(() => {
    if (!room || selectedWhisperId) {
      return;
    }

    const cleanup = async () => {
      if (whisperPubRef.current && whisperTrackRef.current) {
        await room.localParticipant.unpublishTrack(whisperTrackRef.current);
        whisperTrackRef.current.stop();
      }
      whisperTrackRef.current = null;
      whisperPubRef.current = null;
      whisperTrackIdRef.current = null;
    };

    void cleanup();
  }, [room, selectedWhisperId]);

  const onPttPress = useCallback(async () => {
    if (!selectedWhisperId || !isSelectedMember) {
      return;
    }

    const whisperTrack = await ensureWhisperTrack(selectedWhisperId);
    if (!whisperTrack) {
      return;
    }

    await whisperTrack.unmute();

    const mainTrack = mainTrackRef.current;
    if (mainTrack) {
      mainMutedBeforePttRef.current = mainTrack.isMuted;
      if (!mainTrack.isMuted) {
        await mainTrack.mute();
      }
      setMicEnabled(false);
    }

    setIsPttActive(true);
  }, [ensureWhisperTrack, isSelectedMember, selectedWhisperId]);

  const onPttRelease = useCallback(async () => {
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

  useWhisperPtt({
    enabled: Boolean(room && selectedWhisperId),
    onPress: onPttPress,
    onRelease: onPttRelease
  });

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
      setRenderTick((tick) => tick + 1);
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
      setRenderTick((tick) => tick + 1);
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

      await room.switchActiveDevice("audioinput", deviceId);
      setSelectedAudioDevice(deviceId);
    },
    [room]
  );

  const onSelectVideoDevice = useCallback(
    async (deviceId: string) => {
      if (!room) {
        return;
      }

      await room.switchActiveDevice("videoinput", deviceId);
      setSelectedVideoDevice(deviceId);
    },
    [room]
  );

  const toggleParticipantSelection = useCallback(
    (participantIdentity: string) => {
      if (!participantIdentity || participantIdentity === identity) {
        return;
      }
      setSelectedParticipantIds((current) => {
        const next = new Set(current);
        if (next.has(participantIdentity)) {
          next.delete(participantIdentity);
        } else {
          next.add(participantIdentity);
        }
        return next;
      });
    },
    [identity]
  );

  const publishReassignmentMutations = useCallback(
    async (targetWhisperId: string, movedMembers: string[], updatedAt: number) => {
      if (!identity) {
        return;
      }

      const mutations = collectReassignmentMutations(whispers, targetWhisperId, movedMembers, updatedAt);
      for (const mutation of mutations) {
        if (mutation.type === "close") {
          await publishEnvelope(createEnvelope("WHISPER_CLOSE", identity, mutation.payload));
          continue;
        }
        await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, mutation.whisper));
      }
    },
    [identity, publishEnvelope, whispers]
  );

  const createWhisper = useCallback(async () => {
    if (!identity) {
      return;
    }

    if (selectedParticipants.length === 0) {
      setWhisperNotice("Select one or more participants from the video tiles first.");
      return;
    }

    const id = createUuid();
    const now = Date.now();
    const members = Array.from(new Set([identity, ...selectedParticipants]));
    const reassignmentMutations = collectReassignmentMutations(whispers, id, members, now);
    const projectedWhisperCount =
      Object.keys(whispers).length -
      reassignmentMutations.filter((mutation) => mutation.type === "close").length +
      1;
    if (projectedWhisperCount > 3) {
      setWhisperNotice("Only three active whispers are allowed.");
      return;
    }

    await publishReassignmentMutations(id, members, now);

    const whisper: Whisper = {
      id,
      members,
      createdBy: identity,
      createdAt: now,
      updatedAt: now
    };

    await publishEnvelope(createEnvelope("WHISPER_CREATE", identity, whisper));
    setSelectedWhisperId(id);
    setSelectedParticipantIds(new Set());
    setWhisperNotice(null);
  }, [identity, publishEnvelope, publishReassignmentMutations, selectedParticipants, setSelectedWhisperId, whispers]);

  const joinWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity) {
        return;
      }

      const now = Date.now();
      await publishReassignmentMutations(whisper.id, [identity], now);

      const updated: Whisper = {
        ...whisper,
        members: Array.from(new Set([...whisper.members, identity])),
        updatedAt: now
      };

      await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, updated));
      setSelectedWhisperId(whisper.id);
      setWhisperNotice(null);
    },
    [identity, publishEnvelope, publishReassignmentMutations, setSelectedWhisperId]
  );

  const addSelectedParticipantsToWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity || !whisper.members.includes(identity)) {
        return;
      }

      const participantsToAdd = selectedParticipants.filter((participantId) => !whisper.members.includes(participantId));
      if (participantsToAdd.length === 0) {
        setWhisperNotice("No additional selected participants to add.");
        return;
      }

      const now = Date.now();
      await publishReassignmentMutations(whisper.id, participantsToAdd, now);

      const updated: Whisper = {
        ...whisper,
        members: Array.from(new Set([...whisper.members, ...participantsToAdd])),
        updatedAt: now
      };

      await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, updated));
      setSelectedParticipantIds(new Set());
      setWhisperNotice(null);
    },
    [identity, publishEnvelope, publishReassignmentMutations, selectedParticipants]
  );

  const leaveWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity) {
        return;
      }

      const remaining = whisper.members.filter((member) => member !== identity);
      if (remaining.length < 2) {
        const closePayload: WhisperClosePayload = {
          id: whisper.id,
          updatedAt: Date.now()
        };
        await publishEnvelope(createEnvelope("WHISPER_CLOSE", identity, closePayload));
      } else {
        const updated: Whisper = {
          ...whisper,
          members: remaining,
          updatedAt: Date.now()
        };
        await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, updated));
      }

      if (selectedWhisperId === whisper.id) {
        setSelectedWhisperId(undefined);
      }
    },
    [identity, publishEnvelope, selectedWhisperId, setSelectedWhisperId]
  );

  const leaveCurrentWhisper = useCallback(async () => {
    if (!identity) {
      return;
    }

    const activeWhisper =
      (selectedWhisperId ? whispers[selectedWhisperId] : undefined) ??
      Object.values(whispers).find((whisper) => whisper.members.includes(identity));
    if (!activeWhisper || !activeWhisper.members.includes(identity)) {
      return;
    }

    await leaveWhisper(activeWhisper);
  }, [identity, leaveWhisper, selectedWhisperId, whispers]);

  useWhisperPtt({
    enabled: Boolean(room && identity),
    keyCode: "KeyG",
    onPress: leaveCurrentWhisper,
    onRelease: () => {}
  });

  const closeWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity) {
        return;
      }

      const closePayload: WhisperClosePayload = {
        id: whisper.id,
        updatedAt: Date.now()
      };
      await publishEnvelope(createEnvelope("WHISPER_CLOSE", identity, closePayload));
      if (selectedWhisperId === whisper.id) {
        setSelectedWhisperId(undefined);
      }
    },
    [identity, publishEnvelope, selectedWhisperId, setSelectedWhisperId]
  );

  const setSpotlight = useCallback(
    async (targetIdentity: string | null) => {
      if (!identity) {
        return;
      }

      const payload: SpotlightPayload = {
        identity: targetIdentity,
        updatedAt: Date.now()
      };
      await publishEnvelope(createEnvelope("SPOTLIGHT_UPDATE", identity, payload));
    },
    [identity, publishEnvelope]
  );

  const videoTiles = (() => {
    if (!room) {
      return [] as VideoTile[];
    }

    const tiles: VideoTile[] = [];

    room.localParticipant.trackPublications.forEach((publication) => {
      if (publication.kind === Track.Kind.Video && publication.track) {
        tiles.push({
          key: `local-${publication.trackSid}`,
          identity,
          trackSid: publication.trackSid,
          track: publication.track,
          isLocal: true
        });
      }
    });

    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.kind !== Track.Kind.Video || !publication.track) {
          return;
        }

        tiles.push({
          key: `${participant.identity}-${publication.trackSid}`,
          identity: participant.identity,
          trackSid: publication.trackSid,
          track: publication.track as RemoteTrack,
          isLocal: false
        });
      });
    });

    if (followSpotlight && spotlightIdentity) {
      tiles.sort((a, b) => {
        if (a.identity === spotlightIdentity && b.identity !== spotlightIdentity) {
          return -1;
        }
        if (b.identity === spotlightIdentity && a.identity !== spotlightIdentity) {
          return 1;
        }
        return a.identity.localeCompare(b.identity);
      });
    }

    return tiles;
  })();

  const audioTracks = (() => {
    if (!room) {
      return [] as AudioTrackItem[];
    }

    const tracks: AudioTrackItem[] = [];
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.kind !== Track.Kind.Audio || !publication.track) {
          return;
        }

        tracks.push({
          key: `${participant.identity}-${publication.trackSid}`,
          track: publication.track,
          isMain: publication.trackName === "main"
        });
      });
    });

    return tracks;
  })();

  if (isConnecting) {
    return <div className="panel">Connecting to room...</div>;
  }

  if (error) {
    return <div className="panel border-red-400 text-red-200">{error}</div>;
  }

  if (!room) {
    return <div className="panel">Room is not connected.</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="panel space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Room: {roomName}</h2>
            <p className="text-xs text-slate-300">
              You are <span className="font-mono">{identity}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={toggleMic} type="button">
              {micEnabled ? "Mute" : "Unmute"}
            </button>
            <button className="btn" onClick={toggleCamera} type="button">
              {cameraEnabled ? "Camera Off" : "Camera On"}
            </button>
            <button className="btn" onClick={() => room.disconnect()} type="button">
              Leave
            </button>
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {videoTiles.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-600 p-6 text-sm text-slate-300">
              No video tracks yet. Enable camera to appear in the table grid.
            </div>
          )}
          {videoTiles.map((tile, index) => {
            const isSpotlight = spotlightIdentity && tile.identity === spotlightIdentity;
            const isActiveSpeaker = activeSpeakers.has(tile.identity);
            const isInviteSelected = !tile.isLocal && selectedParticipantIds.has(tile.identity);
            return (
              <article
                data-testid={`video-tile-${tile.identity}-${tile.trackSid}`}
                className={`relative rounded-lg border bg-slate-900/80 p-2 ${
                  isSpotlight ? "border-amber-300" : "border-slate-700"
                } ${isActiveSpeaker ? "ring-2 ring-emerald-400/70" : ""} ${
                  isInviteSelected ? "ring-2 ring-sky-400/70" : ""
                } ${
                  index === 0 && isSpotlight && followSpotlight ? "md:col-span-2 xl:col-span-3" : ""
                }`}
                key={tile.key}
              >
                <TrackElement
                  track={tile.track}
                  kind="video"
                  muted={tile.isLocal}
                  className="aspect-video w-full rounded-md bg-black object-cover"
                />
                <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    {tile.identity}
                    {tile.isLocal ? " (you)" : ""}
                  </span>
                  <div className="flex gap-1">
                    {!tile.isLocal && (
                      <button
                        className="btn px-2 py-1 text-[11px]"
                        onClick={() => toggleParticipantSelection(tile.identity)}
                        type="button"
                        data-testid={`video-select-${tile.identity}-${tile.trackSid}`}
                      >
                        {isInviteSelected ? "Selected" : "Select"}
                      </button>
                    )}
                    <button
                      className="btn px-2 py-1 text-[11px]"
                      onClick={() => void setSpotlight(spotlightIdentity === tile.identity ? null : tile.identity)}
                      type="button"
                    >
                      {isSpotlight ? "Unspotlight" : "Spotlight"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-slate-200">
            Microphone
            <select
              className="field"
              value={selectedAudioDevice}
              onChange={(event) => void onSelectAudioDevice(event.target.value)}
            >
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Mic ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-200">
            Camera
            <select
              className="field"
              value={selectedVideoDevice}
              onChange={(event) => void onSelectVideoDevice(event.target.value)}
            >
              {videoDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <aside className="panel space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold">Whispers</h3>
          <button className="btn btn-accent" onClick={() => void createWhisper()} type="button">
            New Whisper
          </button>
        </div>

        <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300" data-testid="whisper-selected-invitees">
          Selected invitees: {selectedParticipants.length > 0 ? selectedParticipants.join(", ") : "none"}
        </div>

        <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300" data-testid="whisper-ptt-panel">
          Hold <strong>V</strong> to talk in selected whisper. Press <strong>G</strong> to leave your current whisper.
          Main audio ducking: {(mainVolume * 100).toFixed(0)}%.
          <br />
          <span data-testid="whisper-ptt-status">PTT: {isPttActive ? "active" : "idle"}</span>
        </div>

        {whisperNotice && (
          <div
            className="rounded-md border border-amber-400/70 bg-amber-950/40 p-3 text-xs text-amber-200"
            data-testid="whisper-notice"
          >
            {whisperNotice}
          </div>
        )}

        <ul className="space-y-2">
          {Object.values(whispers).length === 0 && (
            <li className="rounded-md border border-dashed border-slate-600 p-3 text-sm text-slate-400">
              No active whispers.
            </li>
          )}
          {Object.values(whispers).map((whisper) => {
            const isMember = whisper.members.includes(identity);
            const isSelected = selectedWhisperId === whisper.id;
            return (
              <li
                key={whisper.id}
                className="rounded-md border border-slate-700 bg-slate-900/50 p-3"
                data-testid={`whisper-card-${whisper.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{whisper.title || `Whisper ${whisper.id.slice(0, 6)}`}</p>
                    <p className="mt-1 text-xs text-slate-300" data-testid={`whisper-members-${whisper.id}`}>
                      Members: {whisper.members.join(", ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      className="btn px-2 py-1 text-[11px]"
                      onClick={() => setSelectedWhisperId(whisper.id)}
                      type="button"
                    >
                      {isSelected ? "Selected" : "Select"}
                    </button>
                    {isMember ? (
                      <>
                        {selectedParticipants.length > 0 && (
                          <button
                            className="btn px-2 py-1 text-[11px]"
                            onClick={() => void addSelectedParticipantsToWhisper(whisper)}
                            type="button"
                          >
                            Add Selected
                          </button>
                        )}
                        <button
                          className="btn px-2 py-1 text-[11px]"
                          onClick={() => void leaveWhisper(whisper)}
                          type="button"
                        >
                          Leave
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn px-2 py-1 text-[11px]"
                        onClick={() => void joinWhisper(whisper)}
                        type="button"
                      >
                        Join
                      </button>
                    )}
                    <button
                      className="btn px-2 py-1 text-[11px]"
                      onClick={() => void closeWhisper(whisper)}
                      type="button"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={followSpotlight}
              onChange={(event) => setFollowSpotlight(event.target.checked)}
            />
            Follow spotlight for layout priority
          </label>
          <p className="mt-2 text-slate-300">Current spotlight: {spotlightIdentity ?? "none"}</p>
        </div>
      </aside>

      {audioTracks.map((item) => (
        <TrackElement
          key={item.key}
          track={item.track}
          kind="audio"
          volume={item.isMain ? mainVolume : 1}
          muted={false}
        />
      ))}
    </div>
  );
}
