import { useMemo, useState } from "react";
import { Track } from "livekit-client";
import { TrackElement } from "@/components/TrackElement";
import { DevicePanel } from "@/features/room-session/components/DevicePanel";
import type { RoomConnectionState } from "@/features/room-session/hooks/useRoomConnection";
import { useRoomMedia } from "@/features/room-session/hooks/useRoomMedia";
import { useRoomProtocol } from "@/features/room-session/hooks/useRoomProtocol";
import { useLobbySession } from "@/features/session-lobby/hooks/useLobbySession";

type SessionLobbyProps = {
  connection: RoomConnectionState;
  displayName: string;
  roomName: string;
  onEnter: () => void;
};

export function SessionLobby({ connection, displayName, roomName, onEnter }: SessionLobbyProps) {
  const [showNotReadyWarning, setShowNotReadyWarning] = useState(false);
  const media = useRoomMedia({ room: connection.room });
  const protocol = useRoomProtocol(connection.room);
  const connectedParticipants = useMemo(() => {
    const version = connection.renderVersion;
    void version;
    const remote = connection.room
      ? Array.from(connection.room.remoteParticipants.values()).map((participant) => ({
          identity: participant.identity,
          displayName: participant.name || participant.identity
        }))
      : [];
    return connection.identity
      ? [{ identity: connection.identity, displayName }, ...remote]
      : remote;
  }, [connection.identity, connection.renderVersion, connection.room, displayName]);
  const lobby = useLobbySession({
    protocol,
    identity: connection.identity,
    displayName,
    connectedParticipants
  });
  const cameraTrack = media.cameraEnabled
    ? connection.room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track
    : undefined;
  const waitingParticipants = lobby.participants.filter((participant) => !participant.ready);
  const isGamemaster = connection.gameRole === "gamemaster";
  const mediaBusy =
    media.isInitializing || media.isCameraInitializing || media.isMicToggling || media.isSwitchingDevice;

  const enter = async () => {
    if (mediaBusy) return;
    if (isGamemaster && waitingParticipants.length > 0 && !showNotReadyWarning) {
      setShowNotReadyWarning(true);
      return;
    }
    await media.releaseLocalTracks();
    onEnter();
  };

  return (
    <div className="min-h-screen overflow-y-auto bg-[var(--c-void)] px-6 py-8 md:px-10 md:py-12">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-[var(--c-rule)] pb-7">
          <div>
            <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--c-gold)]">Preflight · {roomName}</p>
            <h1 className="display-face mt-3 text-4xl text-[var(--c-text-warm)] md:text-5xl">Set the table before play</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--c-text-dim)]">
              Check the devices you actually want, make a quick camera pass, and signal when you are ready.
            </p>
          </div>
          <div className="text-right text-xs text-[var(--c-text-faint)]">
            <p>{displayName}</p>
            <p className="mt-1 font-mono">{connection.identity}</p>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
          <section className="border border-[var(--c-rule)] bg-[linear-gradient(145deg,rgba(20,26,31,0.97),rgba(8,9,11,0.96))]">
            <div className="relative aspect-video overflow-hidden bg-black">
              {cameraTrack ? (
                <TrackElement track={cameraTrack} kind="video" muted mirrored={media.mirrorSelfView} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(198,157,86,0.08),transparent_58%)]">
                  <div className="text-center">
                    <p className="display-face text-lg text-[var(--c-text-warm)]">Camera preview is off</p>
                    <p className="mt-2 text-xs text-[var(--c-text-faint)]">Turn it on for a framing check.</p>
                  </div>
                </div>
              )}
              <div className="absolute bottom-4 left-4 flex gap-2">
                <span className={`px-3 py-1 text-[10px] uppercase tracking-[0.08em] ${media.micReady && media.micEnabled ? "bg-[var(--c-emerald)] text-black" : "bg-[var(--c-ember)] text-white"}`}>
                  Mic {media.isInitializing ? "checking" : media.micReady ? (media.micEnabled ? "live" : "muted") : "unavailable"}
                </span>
                <span className="bg-black/70 px-3 py-1 text-[10px] uppercase tracking-[0.08em] text-white/80">
                  Camera {media.cameraEnabled ? "live" : "off"}
                </span>
              </div>
            </div>
            <div className="grid gap-3 border-t border-[var(--c-rule)] p-5 sm:grid-cols-2">
              <button className="chip justify-center py-3 text-xs" disabled={!media.micReady || media.isInitializing || media.isMicToggling} onClick={() => void media.toggleMic()} type="button">
                {media.micEnabled ? "Mute test mic" : "Unmute test mic"}
              </button>
              <button className="chip justify-center py-3 text-xs" disabled={media.isCameraInitializing} onClick={() => void media.toggleCamera()} type="button">
                {media.isCameraInitializing ? "Checking camera..." : media.cameraEnabled ? "Stop camera preview" : "Start camera preview"}
              </button>
            </div>
            <DevicePanel
              model={{
                audioDevices: media.audioDevices,
                videoDevices: media.videoDevices,
                selectedAudioDevice: media.selectedAudioDevice,
                selectedVideoDevice: media.selectedVideoDevice,
                mirrorSelfView: media.mirrorSelfView
              }}
              actions={{
                onMirrorSelfViewChange: media.onMirrorSelfViewChange,
                onSelectAudioDevice: media.onSelectAudioDevice,
                onSelectVideoDevice: media.onSelectVideoDevice
              }}
            />
            {media.error ? <p className="border-t border-[var(--c-rule)] p-5 text-sm text-[var(--c-ember)]" role="alert">{media.error}</p> : null}
          </section>

          <aside className="border border-[var(--c-rule)] bg-[var(--c-ink)] p-6">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">Readiness board</p>
            <h2 aria-live="polite" className="display-face mt-3 text-2xl text-[var(--c-text-warm)]">
              {lobby.participants.filter((participant) => participant.ready).length} of {lobby.participants.length} ready
            </h2>
            <ul className="mt-6 space-y-2" data-testid="lobby-readiness-list">
              {lobby.participants.map((participant) => (
                <li className="flex items-center justify-between border-b border-[var(--c-rule)] py-3" data-testid={`lobby-participant-${participant.identity}`} key={participant.identity}>
                  <span className="truncate text-sm text-[var(--c-text-dim)]">{participant.displayName}</span>
                  <span className={`text-[10px] uppercase tracking-[0.1em] ${participant.ready ? "text-[var(--c-emerald)]" : "text-[var(--c-text-faint)]"}`}>
                    {participant.ready ? "Ready" : "Setting up"}
                  </span>
                </li>
              ))}
            </ul>
            <button
              aria-pressed={lobby.isReady}
              className={`chip mt-6 w-full justify-center py-3 text-xs ${lobby.isReady ? "chip--active" : ""}`}
              data-testid="lobby-ready-toggle"
              onClick={() => void lobby.setReady(!lobby.isReady)}
              type="button"
            >
              {lobby.isReady ? "Ready · click to undo" : "I am ready"}
            </button>
            {lobby.error ? <p className="mt-3 text-xs text-[var(--c-ember)]" role="alert">{lobby.error}</p> : null}
            {showNotReadyWarning ? (
              <p className="mt-5 border-l-2 border-[var(--c-gold)] pl-4 text-xs leading-5 text-[var(--c-text-dim)]">
                {waitingParticipants.length} participant{waitingParticipants.length === 1 ? " is" : "s are"} still setting up. Enter again to start anyway.
              </p>
            ) : null}
            <button className="act act--gold mt-6 w-full justify-center py-3" data-testid="lobby-enter-room" disabled={mediaBusy} onClick={() => void enter()} type="button">
              {showNotReadyWarning ? "Enter anyway" : "Enter live table"}
            </button>
          </aside>
        </div>
      </div>
    </div>
  );
}
