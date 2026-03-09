type DevicePanelProps = {
  audioDevices: MediaDeviceInfo[];
  videoDevices: MediaDeviceInfo[];
  selectedAudioDevice: string;
  selectedVideoDevice: string;
  onSelectAudioDevice: (deviceId: string) => Promise<void>;
  onSelectVideoDevice: (deviceId: string) => Promise<void>;
};

export function DevicePanel({
  audioDevices,
  videoDevices,
  selectedAudioDevice,
  selectedVideoDevice,
  onSelectAudioDevice,
  onSelectVideoDevice
}: DevicePanelProps) {
  return (
    <div className="px-5 pt-4 pb-5">
      <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">DEVICES</h3>
      <div className="mt-3 space-y-4">
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Microphone
          <select className="field" value={selectedAudioDevice} onChange={(event) => void onSelectAudioDevice(event.target.value)}>
            {audioDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Mic ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Camera
          <select className="field" value={selectedVideoDevice} onChange={(event) => void onSelectVideoDevice(event.target.value)}>
            {videoDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
