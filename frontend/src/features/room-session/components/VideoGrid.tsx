import type { VideoTileModel } from "@/features/room-session/types";
import { VideoTile } from "@/features/room-session/components/VideoTile";

type VideoGridProps = {
  gridTiles: VideoTileModel[];
  gridCount: number;
  spotlightIdentity?: string;
  activeSpeakers: Set<string>;
  selectedParticipantIds: Set<string>;
  onToggleParticipantSelection: (participantIdentity: string) => void;
  onToggleSpotlight: (targetIdentity: string | null) => Promise<void>;
};

export function VideoGrid({
  gridTiles,
  gridCount,
  spotlightIdentity,
  activeSpeakers,
  selectedParticipantIds,
  onToggleParticipantSelection,
  onToggleSpotlight
}: VideoGridProps) {
  return (
    <section className="relative min-w-0 flex-1">
      {gridTiles.length > 0 ? (
        <div className="video-grid h-full" data-count={String(gridCount)}>
          {gridTiles.map((tile, index) => (
            <VideoTile
              key={tile.key}
              tile={tile}
              index={index}
              isSpotlighted={tile.identity === spotlightIdentity}
              isActiveSpeaker={activeSpeakers.has(tile.identity)}
              isSelectedForInvite={!tile.isLocal && selectedParticipantIds.has(tile.identity)}
              onToggleParticipantSelection={onToggleParticipantSelection}
              onToggleSpotlight={onToggleSpotlight}
            />
          ))}
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
  );
}
