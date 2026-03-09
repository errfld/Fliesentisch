"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DisconnectReason,
  createLocalAudioTrack,
  createLocalVideoTrack,
  Room,
  RoomEvent,
  Track
} from "livekit-client";
import type { LocalAudioTrack, LocalTrackPublication, LocalVideoTrack, RemoteTrack } from "livekit-client";
import { createUuid, getOrCreateClientId, toIdentity } from "@/lib/client-id";
import {
  createEnvelope,
  parseProtocolEnvelope
} from "@/lib/protocol";
import type { AnyProtocolEnvelope, SpotlightPayload, Whisper, WhisperClosePayload } from "@/lib/protocol";
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

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;
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

function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
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
      const nextActiveSpeakers = new Set(room.activeSpeakers.map((participant) => participant.identity));
      setActiveSpeakers((current) => (areSetsEqual(current, nextActiveSpeakers) ? current : nextActiveSpeakers));
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

    const selected = selectedWhisperId ? whispers[selectedWhisperId] : undefined;
    const activeWhisper =
      selected && selected.members.includes(identity)
        ? selected
        :
      Object.values(whispers).find((whisper) => whisper.members.includes(identity));
    if (!activeWhisper) {
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

  const videoTiles = useMemo(() => {
    const trackGraphVersion = renderTick;
    void trackGraphVersion;

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
  }, [followSpotlight, identity, renderTick, room, spotlightIdentity]);

  const audioTracks = useMemo(() => {
    const trackGraphVersion = renderTick;
    void trackGraphVersion;

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
  }, [renderTick, room]);

  const activeWhispers = Object.values(whispers).sort((a, b) => b.updatedAt - a.updatedAt);
  const participantRoster = Array.from(new Set([identity, ...Array.from(room?.remoteParticipants.keys() ?? [])]))
    .map((participantIdentity) => {
      const whisper = activeWhispers.find((entry) => entry.members.includes(participantIdentity));
      return {
        identity: participantIdentity,
        label: formatIdentityLabel(participantIdentity),
        isLocal: participantIdentity === identity,
        isSpotlight: participantIdentity === spotlightIdentity,
        isSpeaking: activeSpeakers.has(participantIdentity),
        hasVideo: videoTiles.some((tile) => tile.identity === participantIdentity),
        whisperLabel: whisper ? getWhisperLabel(whisper) : undefined
      };
    })
    .sort((a, b) => {
      if (a.isSpotlight && !b.isSpotlight) {
        return -1;
      }
      if (b.isSpotlight && !a.isSpotlight) {
        return 1;
      }
      if (a.isLocal && !b.isLocal) {
        return -1;
      }
      if (b.isLocal && !a.isLocal) {
        return 1;
      }
      return a.label.localeCompare(b.label);
    });

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const gridTiles = useMemo(() => {
    const allTiles = [...videoTiles];
    if (spotlightIdentity) {
      const spotIdx = allTiles.findIndex((t) => t.identity === spotlightIdentity);
      if (spotIdx > 0) {
        const [tile] = allTiles.splice(spotIdx, 1);
        allTiles.unshift(tile);
      }
    }
    return allTiles;
  }, [videoTiles, spotlightIdentity]);

  const gridCount = Math.min(gridTiles.length, 12);

  if (isConnecting) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--c-void)]">
        <div className="text-center">
          <p className="display-face text-xl text-[var(--c-text-warm)]">Entering the table</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">Connecting to room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--c-void)]">
        <div className="max-w-md text-center">
          <p className="display-face text-xl text-[var(--c-ember)]">Connection Failed</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--c-void)]">
        <p className="text-sm text-[var(--c-text-dim)]">Room is not connected.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--c-void)]">
        {/* ── Top bar: a single thin strip, no box ── */}
        <header className="z-20 flex shrink-0 items-center justify-between gap-6 bg-[var(--c-ink)] px-5 py-2">
          <div className="flex items-baseline gap-4">
            <h1 className="display-face text-sm text-[var(--c-text-warm)]">{roomName}</h1>
            <h2 className="sr-only">Room: {roomName}</h2>
            <p className="sr-only">You are <span className="font-mono">{identity}</span></p>
            <nav className="hidden items-center gap-4 text-[11px] text-[var(--c-text-dim)] sm:flex">
              <span>{participantRoster.length} at table</span>
              <span className="text-[var(--c-text-faint)]">/</span>
              <span>{activeWhispers.length} whisper{activeWhispers.length === 1 ? "" : "s"}</span>
              {spotlightIdentity && (
                <>
                  <span className="text-[var(--c-text-faint)]">/</span>
                  <span className="text-[var(--c-gold)]">{formatIdentityLabel(spotlightIdentity)}</span>
                </>
              )}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-[11px] text-[var(--c-text-faint)] lg:block">{displayName}</span>

            {/* Toggle-style controls: just text that changes color */}
            <button
              className={`act ${micEnabled ? "act--on" : "act--hot"}`}
              onClick={toggleMic}
              type="button"
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${micEnabled ? "bg-[var(--c-emerald)]" : "bg-[var(--c-ember)]"}`} />
              {micEnabled ? "Mute" : "Unmute"}
            </button>
            <button
              className={`act ${cameraEnabled ? "act--gold" : ""}`}
              onClick={toggleCamera}
              type="button"
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${cameraEnabled ? "bg-[var(--c-gold)]" : "bg-[var(--c-text-faint)]"}`} />
              {cameraEnabled ? "Camera Off" : "Camera On"}
            </button>
            <label className="act hidden cursor-pointer lg:inline-flex">
              <input
                type="checkbox"
                checked={followSpotlight}
                onChange={(event) => setFollowSpotlight(event.target.checked)}
                className="sr-only"
              />
              <span className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${followSpotlight ? "bg-[var(--c-gold)]" : "bg-[var(--c-text-faint)]"}`} />
              <span className={followSpotlight ? "text-[var(--c-text)]" : ""}>Follow</span>
            </label>
            <button
              className="act"
              onClick={() => setSidebarOpen((s) => !s)}
              type="button"
            >
              {sidebarOpen ? "Close" : "Panel"}
            </button>

            <span className="h-3 w-px bg-[var(--c-rule)]" />

            <button
              className="act act--hot"
              onClick={() => room.disconnect()}
              type="button"
            >
              Leave
            </button>
          </div>
        </header>

        {/* ── Content ── */}
        <div className="flex min-h-0 flex-1">
          {/* ── Video grid: edge-to-edge, no padding, no rounded corners ── */}
          <section className="relative min-w-0 flex-1">
            {gridTiles.length > 0 ? (
              <div
                className="video-grid h-full"
                data-count={String(gridCount)}
              >
                {gridTiles.map((tile, idx) => {
                  const isSpotlighted = tile.identity === spotlightIdentity;
                  const isActiveSpeaker = activeSpeakers.has(tile.identity);
                  const isSelectedForInvite = !tile.isLocal && selectedParticipantIds.has(tile.identity);

                  return (
                    <article
                      key={tile.key}
                      data-testid={`video-tile-${tile.identity}-${tile.trackSid}`}
                      className={`tile-enter group relative overflow-hidden bg-black ${
                        isSpotlighted ? "shadow-[inset_0_0_0_2px_var(--c-gold)]" : ""
                      }`}
                      style={{ animationDelay: `${idx * 50}ms` }}
                    >
                      <TrackElement
                        track={tile.track}
                        kind="video"
                        muted={tile.isLocal}
                        className="absolute inset-0 h-full w-full bg-black object-cover"
                      />
                      <div
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-0 border-2 transition-opacity duration-150 ${
                          isActiveSpeaker && !isSpotlighted
                            ? "border-[color:rgba(52,211,153,0.65)] opacity-100"
                            : "border-transparent opacity-0"
                        }`}
                      />

                      {/* Bottom gradient — appears on hover */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

                      {/* Identity + actions — flat text, no boxes */}
                      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                        <div className="min-w-0">
                          <p className="display-face truncate text-sm leading-tight text-white/90">
                            {formatIdentityLabel(tile.identity)}
                            {tile.isLocal ? " (you)" : ""}
                          </p>
                          {isActiveSpeaker && (
                            <p className="mt-0.5 text-[10px] text-[var(--c-emerald)]">Speaking</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          {!tile.isLocal && (
                            <button
                              className={`act ${isSelectedForInvite ? "act--gold" : ""}`}
                              onClick={() => toggleParticipantSelection(tile.identity)}
                              type="button"
                              data-testid={`video-select-${tile.identity}-${tile.trackSid}`}
                            >
                              {isSelectedForInvite ? "Selected" : "Select"}
                            </button>
                          )}
                          <button
                            className={`act ${isSpotlighted ? "act--gold" : ""}`}
                            onClick={() => void setSpotlight(spotlightIdentity === tile.identity ? null : tile.identity)}
                            type="button"
                          >
                            {isSpotlighted ? "Unpin" : "Spotlight"}
                          </button>
                        </div>
                      </div>

                      {/* Spotlight marker — a thin gold line at the top, not a badge-box */}
                      {isSpotlighted && (
                        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-2">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--c-gold)]"
                            style={{ animation: "breathe 2s ease-in-out infinite" }}
                          />
                          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--c-gold)]">
                            Spotlight
                          </span>
                          <span className="h-px flex-1 bg-[var(--c-gold)]/30" />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <p className="display-face text-lg text-[var(--c-text-warm)]/30">No video feeds</p>
                  <p className="mt-2 text-xs text-[var(--c-text-faint)]">Enable a camera to appear at the table</p>
                </div>
              </div>
            )}
          </section>

          {/* ── Sidebar: flat, typographic, no nested boxes ── */}
          <aside
            className={`z-10 flex shrink-0 flex-col bg-[var(--c-ink)] transition-[width] duration-300 ${
              sidebarOpen ? "w-64" : "w-0 overflow-hidden"
            }`}
          >
            <div className="sidebar-scroll flex flex-1 flex-col overflow-y-auto">

              {/* ── Whispers ── */}
              <div className="px-5 pt-5 pb-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">WHISPERS</h3>
                  <button
                    aria-label="New Whisper"
                    className="chip"
                    onClick={() => void createWhisper()}
                    type="button"
                  >
                    + New
                  </button>
                </div>

                <p
                  className="mt-4 text-[11px] text-[var(--c-text-dim)]"
                  data-testid="whisper-selected-invitees"
                >
                  Invitees: {selectedParticipants.length > 0
                    ? selectedParticipants.map(formatIdentityLabel).join(", ")
                    : <span className="text-[var(--c-text-faint)]">none</span>}
                </p>

                <div
                  className="mt-2 text-[11px] text-[var(--c-text-dim)]"
                  data-testid="whisper-ptt-panel"
                >
                  {selectedWhisper
                    ? <span>Active: <span className="text-[var(--c-text)]">{getWhisperLabel(selectedWhisper)}</span></span>
                    : <span className="text-[var(--c-text-faint)]">No whisper selected</span>}
                  <span className="mx-2 text-[var(--c-text-faint)]">/</span>
                  <span className="text-[var(--c-text-faint)]">
                    <strong className="text-[var(--c-text-dim)]">V</strong> talk
                    <span className="mx-1">&middot;</span>
                    <strong className="text-[var(--c-text-dim)]">G</strong> leave
                  </span>
                  <span className="mx-2 text-[var(--c-text-faint)]">/</span>
                  <span data-testid="whisper-ptt-status" className={isPttActive ? "font-medium text-[var(--c-emerald)]" : "text-[var(--c-text-faint)]"}>
                    PTT: {isPttActive ? "active" : "idle"}
                  </span>
                </div>

                {whisperNotice && (
                  <p
                    className="mt-2 text-[11px] text-[var(--c-gold)]"
                    data-testid="whisper-notice"
                  >
                    {whisperNotice}
                  </p>
                )}
              </div>

              {/* Whisper list — no card borders, just left-accent lines */}
              <ul className="px-5 pb-4">
                {activeWhispers.length === 0 && (
                  <li className="py-3 text-[11px] italic text-[var(--c-text-faint)]">
                    No active whispers.
                  </li>
                )}
                {activeWhispers.map((whisper) => {
                  const isMember = whisper.members.includes(identity);
                  const isSelected = selectedWhisperId === whisper.id;

                  return (
                    <li
                      key={whisper.id}
                      className={`border-l-2 py-2.5 pl-3 transition-colors ${
                        isSelected ? "border-[var(--c-gold)]" : "border-[var(--c-rule)]"
                      }`}
                      data-testid={`whisper-card-${whisper.id}`}
                    >
                      <p className="text-xs font-medium text-[var(--c-text)]">{getWhisperLabel(whisper)}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--c-text-dim)]" data-testid={`whisper-members-${whisper.id}`}>
                        {whisper.members.map(formatIdentityLabel).join(", ")}
                        <span className="sr-only"> Raw members: {whisper.members.join(", ")}</span>
                      </p>
                      <div className="mt-1.5 flex items-center gap-3">
                        <button
                          className={`act ${isSelected ? "act--gold" : ""}`}
                          onClick={() => setSelectedWhisperId(whisper.id)}
                          type="button"
                        >
                          {isSelected ? "Active" : "Select"}
                        </button>
                        {isMember ? (
                          <>
                            {selectedParticipants.length > 0 && (
                              <button
                                className="act"
                                onClick={() => void addSelectedParticipantsToWhisper(whisper)}
                                type="button"
                              >
                                + Add
                              </button>
                            )}
                            <button
                              className="act"
                              onClick={() => void leaveWhisper(whisper)}
                              type="button"
                            >
                              Leave
                            </button>
                          </>
                        ) : (
                          <button
                            className="act act--emerald"
                            onClick={() => void joinWhisper(whisper)}
                            type="button"
                          >
                            Join
                          </button>
                        )}
                        <button
                          className="act act--hot"
                          onClick={() => void closeWhisper(whisper)}
                          type="button"
                        >
                          Close
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Divider — a single fine line */}
              <div className="mx-5 h-px bg-[var(--c-rule)]" />

              {/* ── Roster ── */}
              <div className="px-5 pt-4 pb-4">
                <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">AT TABLE</h3>
                <div className="mt-3">
                  {participantRoster.map((participant, i) => (
                    <div
                      key={participant.identity}
                      className={`flex items-center justify-between py-2 ${
                        i < participantRoster.length - 1 ? "border-b border-[var(--c-rule)]" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs text-[var(--c-text)]">
                          {participant.label}
                          {participant.isLocal
                            ? <span className="ml-1 text-[var(--c-text-faint)]">(you)</span>
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[10px]">
                        {participant.isSpotlight && (
                          <span className="text-[var(--c-gold)]">Spotlight</span>
                        )}
                        {participant.whisperLabel && !participant.isSpotlight && (
                          <span className="text-teal-400">Whisper</span>
                        )}
                        {!participant.whisperLabel && !participant.isSpotlight && participant.isSpeaking && (
                          <span className="text-[var(--c-emerald)]">Speaking</span>
                        )}
                        {!participant.whisperLabel && !participant.isSpotlight && !participant.isSpeaking && participant.hasVideo && (
                          <span className="text-[var(--c-text-faint)]">Video</span>
                        )}
                        {!participant.whisperLabel && !participant.isSpotlight && !participant.isSpeaking && !participant.hasVideo && (
                          <span className="text-[var(--c-text-faint)]">Audio</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="mx-5 h-px bg-[var(--c-rule)]" />

              {/* ── Devices ── */}
              <div className="px-5 pt-4 pb-5">
                <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">DEVICES</h3>
                <div className="mt-3 space-y-4">
                  <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
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
                  <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
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
              </div>
            </div>
          </aside>
        </div>
      </div>

      {audioTracks.map((item) => (
        <TrackElement
          key={item.key}
          track={item.track}
          kind="audio"
          volume={item.isMain ? mainVolume : 1}
          muted={false}
        />
      ))}
    </>
  );
}

function formatIdentityLabel(identity: string): string {
  return identity
    .replace(/-[a-z0-9]{12}$/i, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getWhisperLabel(whisper: Whisper): string {
  return whisper.title || `Whisper ${whisper.id.slice(0, 6)}`;
}
