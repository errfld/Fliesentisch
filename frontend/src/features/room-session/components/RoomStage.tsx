import { HandoutSpotlightSurface } from "@/features/room-session/components/HandoutSpotlightSurface";
import { VideoGrid } from "@/features/room-session/components/VideoGrid";
import type {
  HandoutSpotlightActions,
  HandoutSpotlightViewModel,
  VideoGridActions,
  VideoGridViewModel
} from "@/features/room-session/types";

type RoomStageProps = {
  videoGrid: { model: VideoGridViewModel; actions: VideoGridActions };
  handoutSpotlight: { model: HandoutSpotlightViewModel; actions: HandoutSpotlightActions };
};

export function RoomStage({ videoGrid, handoutSpotlight }: RoomStageProps) {
  return (
    <div className="relative flex min-w-0 flex-1 overflow-hidden">
      <VideoGrid {...videoGrid} />
      <HandoutSpotlightSurface {...handoutSpotlight} />
    </div>
  );
}
