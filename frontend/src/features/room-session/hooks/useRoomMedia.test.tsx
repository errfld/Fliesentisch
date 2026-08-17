import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Room } from "livekit-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomMedia } from "@/features/room-session/hooks/useRoomMedia";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const livekitMocks = vi.hoisted(() => ({
  createLocalAudioTrack: vi.fn(),
  createLocalVideoTrack: vi.fn(),
  getLocalDevices: vi.fn()
}));

vi.mock("livekit-client", () => ({
  createLocalAudioTrack: livekitMocks.createLocalAudioTrack,
  createLocalVideoTrack: livekitMocks.createLocalVideoTrack,
  Room: {
    getLocalDevices: livekitMocks.getLocalDevices
  }
}));

const audioDevices = [device("audio-1", "audioinput"), device("audio-2", "audioinput")];
const videoDevices = [device("video-1", "videoinput")];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let media: ReturnType<typeof useRoomMedia> | null = null;

function device(deviceId: string, kind: MediaDeviceKind): MediaDeviceInfo {
  return {
    deviceId,
    groupId: `${deviceId}-group`,
    kind,
    label: deviceId,
    toJSON: () => ({ deviceId, kind })
  };
}

function Harness({ room }: { room: Room }) {
  media = useRoomMedia({ room });
  return null;
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() }
  });

  livekitMocks.getLocalDevices.mockImplementation(async (kind: MediaDeviceKind) =>
    kind === "audioinput" ? audioDevices : videoDevices
  );
  livekitMocks.createLocalAudioTrack.mockResolvedValue({
    isMuted: false,
    mute: vi.fn(async () => undefined),
    stop: vi.fn(),
    unmute: vi.fn(async () => undefined)
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  media = null;
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("useRoomMedia device preference integration", () => {
  it("does not recreate the main microphone after switching the active device", async () => {
    const room = {
      localParticipant: {
        publishTrack: vi.fn(async () => ({})),
        unpublishTrack: vi.fn(async () => undefined)
      },
      switchActiveDevice: vi.fn(async () => true)
    } as unknown as Room;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness room={room} />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.waitFor(() => expect(livekitMocks.createLocalAudioTrack).toHaveBeenCalledTimes(1));
    });

    await act(async () => {
      await media?.onSelectAudioDevice("audio-2");
    });

    expect(room.switchActiveDevice).toHaveBeenCalledWith("audioinput", "audio-2");
    expect(media?.selectedAudioDevice).toBe("audio-2");
    expect(livekitMocks.createLocalAudioTrack).toHaveBeenCalledTimes(1);
  });
});
