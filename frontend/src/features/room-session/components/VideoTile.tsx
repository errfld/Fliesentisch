import { TrackElement } from "@/components/TrackElement";
import { formatIdentityLabel } from "@/features/room-session/lib/session-helpers";
import type { VideoTileModel } from "@/features/room-session/types";

type VideoTileProps = {
  tile: VideoTileModel;
  index: number;
  isSpotlighted: boolean;
  isActiveSpeaker: boolean;
  isSelectedForInvite: boolean;
  onToggleParticipantSelection: (participantIdentity: string) => void;
  onToggleSpotlight: (targetIdentity: string | null) => Promise<void>;
};

export function VideoTile({
  tile,
  index,
  isSpotlighted,
  isActiveSpeaker,
  isSelectedForInvite,
  onToggleParticipantSelection,
  onToggleSpotlight
}: VideoTileProps) {
  return (
    <article
      data-testid={`video-tile-${tile.identity}-${tile.trackSid}`}
      className={`tile-enter group relative overflow-hidden bg-black ${
        isSpotlighted ? "shadow-[inset_0_0_0_2px_var(--c-gold)]" : ""
      }`}
      style={{ animationDelay: `${index * 50}ms` }}
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/80 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div className="min-w-0">
          <p className="display-face truncate text-sm leading-tight text-white/90">
            {formatIdentityLabel(tile.identity)}
            {tile.isLocal ? " (you)" : ""}
          </p>
          {isActiveSpeaker && <p className="mt-0.5 text-[10px] text-[var(--c-emerald)]">Speaking</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {!tile.isLocal && (
            <button
              className={`act ${isSelectedForInvite ? "act--gold" : ""}`}
              onClick={() => onToggleParticipantSelection(tile.identity)}
              type="button"
              data-testid={`video-select-${tile.identity}-${tile.trackSid}`}
            >
              {isSelectedForInvite ? "Selected" : "Select"}
            </button>
          )}
          <button
            className={`act ${isSpotlighted ? "act--gold" : ""}`}
            onClick={() => void onToggleSpotlight(isSpotlighted ? null : tile.identity)}
            type="button"
          >
            {isSpotlighted ? "Unpin" : "Spotlight"}
          </button>
        </div>
      </div>

      {isSpotlighted && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--c-gold)]"
            style={{ animation: "breathe 2s ease-in-out infinite" }}
          />
          <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--c-gold)]">Spotlight</span>
          <span className="h-px flex-1 bg-[var(--c-gold)]/30" />
        </div>
      )}
    </article>
  );
}
