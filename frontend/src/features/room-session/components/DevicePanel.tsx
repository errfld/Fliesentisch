import { useState } from "react";

type DevicePanelProps = {
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  selectedAudioDevice: string;
  selectedVideoDevice: string;
  mirrorSelfView: boolean;
  onMirrorSelfViewChange: (mirrored: boolean) => void;
  onSelectAudioDevice: (deviceId: string) => Promise<void>;
  onSelectVideoDevice: (deviceId: string) => Promise<void>;
};

export function DevicePanel({
  audioDevices,
  videoDevices,
  selectedAudioDevice,
  selectedVideoDevice,
  mirrorSelfView,
  onMirrorSelfViewChange,
  onSelectAudioDevice,
  onSelectVideoDevice
}: DevicePanelProps) {
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const handleAudioChange = async (deviceId: string) => {
    try {
      setDeviceError(null);
      await onSelectAudioDevice(deviceId);
    } catch (error) {
      console.error(error);
      setDeviceError(error instanceof Error ? error.message : "Failed to switch microphone");
    }
  };

  const handleVideoChange = async (deviceId: string) => {
    try {
      setDeviceError(null);
      await onSelectVideoDevice(deviceId);
    } catch (error) {
      console.error(error);
      setDeviceError(error instanceof Error ? error.message : "Failed to switch camera");
    }
  };

  return (
    <div className="px-5 pt-4 pb-5">
      <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">DEVICES</h3>
      <div className="mt-3 space-y-4">
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Microphone
          <select className="field" value={selectedAudioDevice} onChange={(event) => void handleAudioChange(event.target.value)}>
            {audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Mic ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Camera
          <select className="field" value={selectedVideoDevice} onChange={(event) => void handleVideoChange(event.target.value)}>
            {videoDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </label>
        <label
          className="flex items-center justify-between gap-4 border border-[var(--c-rule)] bg-[var(--c-slab)]/70 px-3 py-2"
          data-testid="mirror-self-view-toggle"
        >
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.08em] text-[var(--c-text-dim)]">Mirror self-view</p>
            <p className="mt-1 text-[11px] text-[var(--c-text-faint)]">Applies only to your local camera tile.</p>
          </div>
          <input
            type="checkbox"
            checked={mirrorSelfView}
            onChange={(event) => onMirrorSelfViewChange(event.target.checked)}
            className="h-4 w-4 accent-[var(--c-gold)]"
          />
        </label>
        {deviceError && <p className="text-[11px] text-[var(--c-gold)]">{deviceError}</p>}
      </div>
    </div>
  );
}
