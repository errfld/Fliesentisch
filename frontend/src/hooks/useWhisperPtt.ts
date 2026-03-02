"use client";

import { useEffect, useRef } from "react";

type UseWhisperPttInput = {
  enabled: boolean;
  keyCode?: string;
  onPress: () => void | Promise<void>;
  onRelease: () => void | Promise<void>;
};

export function useWhisperPtt({
  enabled,
  keyCode = "KeyV",
  onPress,
  onRelease
}: UseWhisperPttInput) {
  const activeRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      activeRef.current = false;
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        return;
      }
      if (event.code !== keyCode || event.repeat || activeRef.current) {
        return;
      }

      activeRef.current = true;
      void onPress();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== keyCode || !activeRef.current) {
        return;
      }

      activeRef.current = false;
      void onRelease();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enabled, keyCode, onPress, onRelease]);
}
