import type {
  DiagnosticsConnectionEvent,
  DiagnosticsConnectionEventKind,
  DiagnosticsNetworkHealth,
  DiagnosticsPanelViewModel,
  DiagnosticsSubscriptionState
} from "@/features/room-session/types";

type DeriveNetworkHealthInput = {
  connectionState: string;
  livekitQuality: string;
  packetLossPercent: number | null;
};

type DiagnosticSummaryInput = Omit<DiagnosticsPanelViewModel, "summary">;

const CONNECTION_EVENT_LABELS: Record<DiagnosticsConnectionEventKind, string> = {
  connected: "Connected",
  "signal-reconnecting": "Signal reconnecting",
  reconnecting: "Media reconnecting",
  reconnected: "Reconnected"
};

export function deriveNetworkHealth({
  connectionState,
  livekitQuality,
  packetLossPercent
}: DeriveNetworkHealthInput): DiagnosticsNetworkHealth {
  const normalizedQuality = livekitQuality.toLowerCase();
  const normalizedState = connectionState.toLowerCase();

  if (normalizedState.includes("reconnecting") || normalizedState === "disconnected") {
    return {
      tone: "poor",
      label: normalizedState === "disconnected" ? "Offline" : "Recovering",
      detail: "The room connection is not currently stable.",
      livekitQuality: normalizedQuality || "unknown",
      packetLossPercent
    };
  }

  if (normalizedQuality === "lost" || normalizedQuality === "poor" || (packetLossPercent ?? 0) >= 5) {
    return {
      tone: "poor",
      label: "Poor",
      detail: "Audio or video may break up. Check the network path.",
      livekitQuality: normalizedQuality || "unknown",
      packetLossPercent
    };
  }

  if (normalizedQuality === "good" || (packetLossPercent ?? 0) >= 2) {
    return {
      tone: "watch",
      label: "Watch",
      detail: "Usable, with signs of network pressure.",
      livekitQuality: normalizedQuality || "unknown",
      packetLossPercent
    };
  }

  if (normalizedQuality === "excellent" || packetLossPercent !== null) {
    return {
      tone: "good",
      label: "Stable",
      detail: "The current media path looks healthy.",
      livekitQuality: normalizedQuality || "unknown",
      packetLossPercent
    };
  }

  return {
    tone: "unknown",
    label: "Measuring",
    detail: "Waiting for enough receiver data.",
    livekitQuality: normalizedQuality || "unknown",
    packetLossPercent
  };
}

export function formatDiagnosticSummary(snapshot: DiagnosticSummaryInput): string {
  const lines = [
    "Fliesentisch room diagnostics",
    `Captured: ${new Date(snapshot.capturedAt).toISOString()}`,
    `Room: ${safeDiagnosticIdentifier(snapshot.roomName)}`,
    `Client: ${safeDiagnosticIdentifier(snapshot.clientIdentity)}`,
    `Connection: ${snapshot.connectionState}`,
    `Network: ${snapshot.network.label} (LiveKit ${snapshot.network.livekitQuality}; packet loss ${formatPacketLoss(snapshot.network.packetLossPercent)})`,
    `Microphone: ${snapshot.microphoneEnabled ? "enabled" : "muted"}; activity ${formatPercentage(snapshot.microphoneLevel * 100)}`,
    `Input device: ${snapshot.inputDeviceLabel}`,
    `Output device: ${snapshot.outputDeviceLabel}`,
    `Camera device: ${snapshot.cameraDeviceLabel}`,
    `Main audio subscriptions: ${formatSubscriptionState(snapshot.mainAudio)}`,
    `Whisper audio subscriptions: ${formatSubscriptionState(snapshot.whisperAudio)}`,
    `Video subscriptions: ${formatSubscriptionState(snapshot.video)}`,
    `Reconnect history: ${formatConnectionHistory(snapshot.reconnectHistory)}`
  ];

  return redactDiagnosticText(lines.join("\n"));
}

export function formatConnectionEvent(event: DiagnosticsConnectionEvent): string {
  return `${CONNECTION_EVENT_LABELS[event.kind]} at ${new Date(event.at).toISOString()}`;
}

export function formatPacketLoss(value: number | null): string {
  return value === null ? "unavailable" : formatPercentage(value);
}

export function safeDiagnosticIdentifier(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 80);
  return normalized || "unknown";
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/([?&](?:access_token|auth|token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/((?:authorization|password|secret|token)\s*[:=]\s*)(?:bearer\s+)?[^\s;]+/gi, "$1[REDACTED]");
}

function formatPercentage(value: number): string {
  return `${Math.max(0, value).toFixed(1)}%`;
}

function formatSubscriptionState(state: DiagnosticsSubscriptionState): string {
  return `${state.subscribed}/${state.published} subscribed; ${state.muted} muted`;
}

function formatConnectionHistory(history: ReadonlyArray<DiagnosticsConnectionEvent>): string {
  if (history.length === 0) {
    return "none recorded";
  }
  return history.map(formatConnectionEvent).join(" | ");
}
