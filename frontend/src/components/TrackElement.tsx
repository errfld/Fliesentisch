"use client";

import { memo, useEffect, useRef } from "react";
import type { Track } from "livekit-client";

type TrackElementProps = {
  track: Track;
  kind: "video" | "audio";
  volume?: number;
  muted?: boolean;
  className?: string;
};

export const TrackElement = memo(function TrackElement({
  track,
  kind,
  volume = 1,
  muted = false,
  className
}: TrackElementProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = kind === "video" ? videoRef.current : audioRef.current;
    if (!element) {
      return;
    }

    track.attach(element);

    return () => {
      track.detach(element);
    };
  }, [kind, track]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  if (kind === "video") {
    return (
      <video
        ref={videoRef}
        className={className}
        autoPlay
        playsInline
        muted={muted}
      />
    );
  }

  return (
    <audio
      ref={audioRef}
      autoPlay
      playsInline
      hidden
    />
  );
});
