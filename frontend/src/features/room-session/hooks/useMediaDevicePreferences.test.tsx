import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MediaDevicePreferencesDependencies,
  type MediaDevicePreferencesResult,
  useMediaDevicePreferences
} from "@/features/room-session/hooks/useMediaDevicePreferences";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AUDIO_KEY = "virtual-table-audio-device";
const VIDEO_KEY = "virtual-table-video-device";
const MIRROR_KEY = "virtual-table-mirror-self-view";

const audioDevices = [device("audio-1", "audioinput"), device("audio-2", "audioinput")];
const videoDevices = [device("video-1", "videoinput"), device("video-2", "videoinput")];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let preferences: MediaDevicePreferencesResult | null = null;

function device(deviceId: string, kind: MediaDeviceKind): MediaDeviceInfo {
  return {
    deviceId,
    groupId: `${deviceId}-group`,
    kind,
    label: deviceId,
    toJSON: () => ({ deviceId, kind })
  };
}

function createDependencies(
  switchActiveDevice = vi.fn(async () => true)
): MediaDevicePreferencesDependencies {
  return {
    canAccessMediaDevices: () => true,
    getLocalDevices: vi.fn(async (kind) => kind === "audioinput" ? audioDevices : videoDevices),
    getStorage: () => window.localStorage,
    switchActiveDevice
  };
}

type HarnessProps = {
  dependencies: MediaDevicePreferencesDependencies;
};

function Harness({ dependencies }: HarnessProps) {
  preferences = useMediaDevicePreferences({
    room: {} as never,
    isReleasing: () => false,
    dependencies
  });
  return null;
}

async function renderPreferences(dependencies = createDependencies()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness dependencies={dependencies} />);
    await Promise.resolve();
  });
  return dependencies;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  preferences = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("useMediaDevicePreferences", () => {
  it("uses first-device and unmirrored defaults when storage is empty", async () => {
    await renderPreferences();

    expect(preferences?.audioDevices).toEqual(audioDevices);
    expect(preferences?.videoDevices).toEqual(videoDevices);
    expect(preferences?.selectedAudioDevice).toBe("audio-1");
    expect(preferences?.selectedVideoDevice).toBe("video-1");
    expect(preferences?.mirrorSelfView).toBe(false);
    expect(window.localStorage.getItem(MIRROR_KEY)).toBe("false");
  });

  it("keeps persisted device IDs when they still exist", async () => {
    window.localStorage.setItem(AUDIO_KEY, "audio-2");
    window.localStorage.setItem(VIDEO_KEY, "video-2");

    await renderPreferences();

    expect(preferences?.selectedAudioDevice).toBe("audio-2");
    expect(preferences?.selectedVideoDevice).toBe("video-2");
  });

  it("falls back to first devices when persisted IDs are stale", async () => {
    window.localStorage.setItem(AUDIO_KEY, "missing-audio");
    window.localStorage.setItem(VIDEO_KEY, "missing-video");

    await renderPreferences();

    expect(preferences?.selectedAudioDevice).toBe("audio-1");
    expect(preferences?.selectedVideoDevice).toBe("video-1");
  });

  it("persists a device only after a successful switch", async () => {
    const switchActiveDevice = vi.fn(async () => true);
    await renderPreferences(createDependencies(switchActiveDevice));

    await act(async () => {
      await preferences?.onSelectAudioDevice("audio-2");
    });

    expect(switchActiveDevice).toHaveBeenCalledWith(expect.anything(), "audioinput", "audio-2");
    expect(preferences?.selectedAudioDevice).toBe("audio-2");
    expect(window.localStorage.getItem(AUDIO_KEY)).toBe("audio-2");
    expect(preferences?.error).toBeNull();
  });

  it("does not persist or select a device after a failed switch", async () => {
    const switchActiveDevice = vi.fn(async () => false);
    await renderPreferences(createDependencies(switchActiveDevice));

    let switchError: unknown;
    await act(async () => {
      try {
        await preferences?.onSelectVideoDevice("video-2");
      } catch (error) {
        switchError = error;
      }
    });

    expect(switchError).toEqual(new Error("Failed to switch camera"));
    expect(preferences?.selectedVideoDevice).toBe("video-1");
    expect(window.localStorage.getItem(VIDEO_KEY)).toBeNull();
    expect(preferences?.error).toBe("Failed to switch camera");
  });

  it("initializes and persists mirror preference updates independently", async () => {
    window.localStorage.setItem(MIRROR_KEY, "true");
    await renderPreferences();

    expect(preferences?.mirrorSelfView).toBe(true);

    act(() => preferences?.onMirrorSelfViewChange(false));

    expect(preferences?.mirrorSelfView).toBe(false);
    expect(window.localStorage.getItem(MIRROR_KEY)).toBe("false");
  });
});
