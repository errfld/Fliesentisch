"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
import { getOrCreateClientId, toIdentity } from "@/lib/client-id";
import {
  AnyProtocolEnvelope,
  createEnvelope,
  parseProtocolEnvelope,
  SpotlightPayload,
  Whisper,
  WhisperClosePayload
} from "@/lib/protocol";
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
  track: Track;
  isLocal: boolean;
};

type AudioTrackItem = {
  key: string;
  track: Track;
  isMain: boolean;
};

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8787";
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? "ws://localhost:7880";

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

  const identity = useMemo(() => {
    if (!clientId) {
      return "";
    }
    return toIdentity(displayName, clientId);
  }, [displayName, clientId]);

  const selectedWhisper = selectedWhisperId ? whispers[selectedWhisperId] : undefined;
  const isSelectedMember = Boolean(selectedWhisper && selectedWhisper.members.includes(identity));

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
        const response = await fetch(`${AUTH_URL}/api/v1/token`, {
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
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to fetch access token");
      } finally {
        if (!controller.signal.aborted) {
          setIsConnecting(false);
        }
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
      try {
        await lkRoom.connect(LIVEKIT_URL, token);
        const mainTrack = await createLocalAudioTrack();
        const publication = await lkRoom.localParticipant.publishTrack(mainTrack, { name: "main" });

        if (cancelled) {
          mainTrack.stop();
          lkRoom.disconnect();
          return;
        }

        mainTrackRef.current = mainTrack;
        mainPubRef.current = publication;
        setMicEnabled(!mainTrack.isMuted);
        setRoom(lkRoom);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to connect to LiveKit");
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (cameraPubRef.current) {
        void lkRoom.localParticipant.unpublishTrack(cameraPubRef.current.track);
      }
      if (whisperPubRef.current) {
        void lkRoom.localParticipant.unpublishTrack(whisperPubRef.current.track);
      }
      if (mainPubRef.current) {
        void lkRoom.localParticipant.unpublishTrack(mainPubRef.current.track);
      }

      cameraTrackRef.current?.stop();
      whisperTrackRef.current?.stop();
      mainTrackRef.current?.stop();
      lkRoom.disconnect();
      setRoom(null);
    };
  }, [token]);

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
    const onDisconnected = () => {
      setRoom(null);
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
        setError(deviceError instanceof Error ? deviceError.message : "Failed to query devices");
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
        await room.localParticipant.unpublishTrack(whisperPubRef.current.track);
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
        await room.localParticipant.unpublishTrack(whisperPubRef.current.track);
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
      await room.localParticipant.unpublishTrack(cameraPubRef.current.track);
      cameraTrackRef.current.stop();
      cameraTrackRef.current = null;
      cameraPubRef.current = null;
      setCameraEnabled(false);
      setRenderTick((tick) => tick + 1);
      return;
    }

    const track = await createLocalVideoTrack(
      selectedVideoDevice ? { deviceId: { exact: selectedVideoDevice } } : undefined
    );
    const publication = await room.localParticipant.publishTrack(track);

    cameraTrackRef.current = track;
    cameraPubRef.current = publication;
    setCameraEnabled(true);
    setRenderTick((tick) => tick + 1);
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

  const createWhisper = useCallback(async () => {
    if (!identity) {
      return;
    }

    if (Object.keys(whispers).length >= 3) {
      setError("Only three active whispers are allowed.");
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const whisper: Whisper = {
      id,
      members: [identity],
      createdBy: identity,
      createdAt: now,
      updatedAt: now
    };

    await publishEnvelope(createEnvelope("WHISPER_CREATE", identity, whisper));
    setSelectedWhisperId(id);
  }, [identity, publishEnvelope, setSelectedWhisperId, whispers]);

  const joinWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity) {
        return;
      }

      const updated: Whisper = {
        ...whisper,
        members: Array.from(new Set([...whisper.members, identity])),
        updatedAt: Date.now()
      };

      await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, updated));
      setSelectedWhisperId(whisper.id);
    },
    [identity, publishEnvelope, setSelectedWhisperId]
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
    if (!room) {
      return [] as VideoTile[];
    }

    const tiles: VideoTile[] = [];

    room.localParticipant.trackPublications.forEach((publication) => {
      if (publication.kind === Track.Kind.Video && publication.track) {
        tiles.push({
          key: `local-${publication.trackSid}`,
          identity,
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
            return (
              <article
                className={`relative rounded-lg border bg-slate-900/80 p-2 ${
                  isSpotlight ? "border-amber-300" : "border-slate-700"
                } ${isActiveSpeaker ? "ring-2 ring-emerald-400/70" : ""} ${
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
                  <button
                    className="btn px-2 py-1 text-[11px]"
                    onClick={() => void setSpotlight(spotlightIdentity === tile.identity ? null : tile.identity)}
                    type="button"
                  >
                    {isSpotlight ? "Unspotlight" : "Spotlight"}
                  </button>
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

        <div className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-300">
          Hold <strong>V</strong> to talk in selected whisper. Main audio ducking: {(mainVolume * 100).toFixed(0)}%.
          <br />
          PTT: {isPttActive ? "active" : "idle"}
        </div>

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
              <li key={whisper.id} className="rounded-md border border-slate-700 bg-slate-900/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{whisper.title || `Whisper ${whisper.id.slice(0, 6)}`}</p>
                    <p className="mt-1 text-xs text-slate-300">Members: {whisper.members.join(", ")}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button className="btn px-2 py-1 text-[11px]" onClick={() => setSelectedWhisperId(whisper.id)}>
                      {isSelected ? "Selected" : "Select"}
                    </button>
                    {isMember ? (
                      <button className="btn px-2 py-1 text-[11px]" onClick={() => void leaveWhisper(whisper)}>
                        Leave
                      </button>
                    ) : (
                      <button className="btn px-2 py-1 text-[11px]" onClick={() => void joinWhisper(whisper)}>
                        Join
                      </button>
                    )}
                    <button className="btn px-2 py-1 text-[11px]" onClick={() => void closeWhisper(whisper)}>
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
