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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mediaElementRef = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const element = track.attach();
    element.autoplay = true;
    element.setAttribute("playsinline", "true");
    container.replaceChildren(element);
    mediaElementRef.current = element;

    return () => {
      track.detach(element);
      element.pause();
      element.srcObject = null;
      element.remove();

      if (mediaElementRef.current === element) {
        mediaElementRef.current = null;
      }
    };
  }, [track]);

  useEffect(() => {
    const element = mediaElementRef.current;
    if (!element) {
      return;
    }

    element.muted = muted;
    element.className = className ?? "";
    element.hidden = kind === "audio";
  }, [className, kind, muted]);

  useEffect(() => {
    if (kind === "audio" && mediaElementRef.current instanceof HTMLAudioElement) {
      mediaElementRef.current.volume = volume;
    }
  }, [kind, volume]);

  return <div ref={containerRef} className={kind === "audio" ? "hidden" : "h-full w-full"} />;
});
