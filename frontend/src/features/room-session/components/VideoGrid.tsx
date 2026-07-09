import type { VideoGridActions, VideoGridViewModel } from "@/features/room-session/types";
import { VideoTile } from "@/features/room-session/components/VideoTile";
import { resolveParticipantLabel } from "@/features/room-session/lib/session-selectors";

type VideoGridProps = {
  model: VideoGridViewModel;
  actions: VideoGridActions;
};

export function VideoGrid({
  model: {
    gridTiles,
    gridCount,
    spotlightIdentity,
    activeSpeakers,
    participantDisplayNames,
    selectedParticipantIds,
    mirrorSelfView
  },
  actions: { onToggleParticipantSelection, onToggleSpotlight }
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
              mirrorSelfView={mirrorSelfView}
              participantLabel={resolveParticipantLabel(tile.identity, participantDisplayNames)}
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
