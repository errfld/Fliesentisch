import { TrackElement } from "@/components/TrackElement";
import type { AudioTrackModel } from "@/features/room-session/types";

type RemoteAudioLayerProps = {
  audioTracks: AudioTrackModel[];
  mainVolume: number;
};

export function RemoteAudioLayer({ audioTracks, mainVolume }: RemoteAudioLayerProps) {
  return (
    <>
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
