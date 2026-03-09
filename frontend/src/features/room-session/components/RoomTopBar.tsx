import { formatIdentityLabel } from "@/features/room-session/lib/session-helpers";
import type { RoomSessionControls } from "@/features/room-session/types";

type RoomTopBarProps = RoomSessionControls & {
  roomName: string;
  displayName: string;
  identity: string;
  participantCount: number;
  activeWhisperCount: number;
  spotlightIdentity?: string;
};

export function RoomTopBar({
  roomName,
  displayName,
  identity,
  participantCount,
  activeWhisperCount,
  spotlightIdentity,
  micEnabled,
  cameraEnabled,
  followSpotlight,
  sidebarOpen,
  onToggleMic,
  onToggleCamera,
  onFollowSpotlightChange,
  onToggleSidebar,
  onLeave
}: RoomTopBarProps) {
  return (
    <header className="z-20 flex shrink-0 items-center justify-between gap-6 bg-[var(--c-ink)] px-5 py-2">
      <div className="flex items-baseline gap-4">
        <h1 className="display-face text-sm text-[var(--c-text-warm)]">{roomName}</h1>
        <h2 className="sr-only">Room: {roomName}</h2>
        <p className="sr-only">
          You are <span className="font-mono">{identity}</span>
        </p>
        <nav className="hidden items-center gap-4 text-[11px] text-[var(--c-text-dim)] sm:flex">
          <span>{participantCount} at table</span>
          <span className="text-[var(--c-text-faint)]">/</span>
          <span>
            {activeWhisperCount} whisper{activeWhisperCount === 1 ? "" : "s"}
          </span>
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
        <button
          className={`act ${micEnabled ? "act--on" : "act--hot"}`}
          onClick={() => void onToggleMic()}
          type="button"
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${micEnabled ? "bg-[var(--c-emerald)]" : "bg-[var(--c-ember)]"}`} />
          {micEnabled ? "Mute" : "Unmute"}
        </button>
        <button
          className={`act ${cameraEnabled ? "act--gold" : ""}`}
          onClick={() => void onToggleCamera()}
          type="button"
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${cameraEnabled ? "bg-[var(--c-gold)]" : "bg-[var(--c-text-faint)]"}`} />
          {cameraEnabled ? "Camera Off" : "Camera On"}
        </button>
        <label className="act hidden cursor-pointer lg:inline-flex">
          <input
            type="checkbox"
            checked={followSpotlight}
            onChange={(event) => onFollowSpotlightChange(event.target.checked)}
            className="sr-only"
          />
          <span className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${followSpotlight ? "bg-[var(--c-gold)]" : "bg-[var(--c-text-faint)]"}`} />
          <span className={followSpotlight ? "text-[var(--c-text)]" : ""}>Follow</span>
        </label>
        <button className="act" onClick={onToggleSidebar} type="button">
          {sidebarOpen ? "Close" : "Panel"}
        </button>

        <span className="h-3 w-px bg-[var(--c-rule)]" />

        <button className="act act--hot" onClick={onLeave} type="button">
          Leave
        </button>
      </div>
    </header>
  );
}
