"use client";

import { useEffect, useRef } from "react";
import type { Track } from "livekit-client";

type TrackElementProps = {
  track: Track;
  kind: "video" | "audio";
  volume?: number;
  muted?: boolean;
  className?: string;
};

export function TrackElement({ track, kind, volume = 1, muted = false, className }: TrackElementProps) {
  const ref = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    track.attach(element);

    return () => {
      track.detach(element);
    };
  }, [track]);

  useEffect(() => {
    if (ref.current) {
      ref.current.volume = volume;
    }
  }, [volume]);

  if (kind === "video") {
    return (
      <video
        ref={(element) => {
          ref.current = element;
        }}
        className={className}
        autoPlay
        playsInline
        muted={muted}
      />
    );
  }

  return (
    <audio
      ref={(element) => {
        ref.current = element;
      }}
      autoPlay
      playsInline
      hidden
    />
  );
}
