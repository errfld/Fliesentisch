import type { Whisper } from "@/lib/protocol";

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;

export const MEDIA_ACCESS_ERROR =
  "Microphone/camera access requires HTTPS (or localhost) and browser permission to use media devices.";

export function canAccessMediaDevices(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

export function resolveLivekitUrl(): string {
  if (typeof window === "undefined") {
    return LIVEKIT_URL ?? "ws://localhost:7880";
  }

  if (LIVEKIT_URL) {
    try {
      const parsed = new URL(LIVEKIT_URL);
      const browserHost = window.location.hostname;
      if (window.location.protocol === "https:" && parsed.protocol === "ws:") {
        parsed.protocol = "wss:";
      }
      if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost)) {
        parsed.hostname = browserHost;
      }
      return parsed.toString();
    } catch {
      return LIVEKIT_URL;
    }
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.hostname}:7880`;
}

export function formatConnectionError(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback;
  const normalized = message.toLowerCase();
  if (normalized.includes("getusermedia") || normalized.includes("mediadevices")) {
    return MEDIA_ACCESS_ERROR;
  }
  return message;
}

export function areSetsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

export function formatIdentityLabel(identity: string): string {
  return identity
    .replace(/-[a-z0-9]{12}$/i, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getWhisperLabel(whisper: Whisper): string {
  return whisper.title || `Whisper ${whisper.id.slice(0, 6)}`;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";
}
