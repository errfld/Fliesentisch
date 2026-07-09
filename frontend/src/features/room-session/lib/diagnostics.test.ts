import { describe, expect, it } from "vitest";
import {
  deriveNetworkHealth,
  formatDiagnosticSummary,
  redactDiagnosticText,
  safeDiagnosticIdentifier
} from "@/features/room-session/lib/diagnostics";

describe("diagnostic formatting", () => {
  it("formats a safe, actionable summary", () => {
    const summary = formatDiagnosticSummary({
      capturedAt: Date.parse("2026-07-09T20:00:00.000Z"),
      roomName: "Thursday Table",
      clientIdentity: "u_client-42",
      connectionState: "connected",
      reconnectHistory: [
        { kind: "connected", at: Date.parse("2026-07-09T19:58:00.000Z") },
        { kind: "reconnected", at: Date.parse("2026-07-09T19:59:00.000Z") }
      ],
      network: deriveNetworkHealth({
        connectionState: "connected",
        livekitQuality: "excellent",
        packetLossPercent: 0.25
      }),
      microphoneLevel: 0.42,
      microphoneEnabled: true,
      inputDeviceLabel: "Table microphone",
      outputDeviceLabel: "Headphones",
      cameraDeviceLabel: "Front camera",
      mainAudio: { published: 2, subscribed: 2, muted: 0 },
      whisperAudio: { published: 1, subscribed: 1, muted: 1 },
      video: { published: 2, subscribed: 1, muted: 0 }
    });

    expect(summary).toContain("Room: Thursday_Table");
    expect(summary).toContain("Client: u_client-42");
    expect(summary).toContain("packet loss 0.3%");
    expect(summary).toContain("Whisper audio subscriptions: 1/1 subscribed; 1 muted");
    expect(summary).toContain("Reconnected at 2026-07-09T19:59:00.000Z");
  });

  it("redacts tokens, authorization values, and secrets from report fields", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwbGF5ZXIifQ.signature123";
    const value = [
      `token=${jwt}`,
      "Authorization: Bearer super-secret-value",
      "https://example.invalid?access_token=abc123&room=safe",
      "client_secret=never-copy-this"
    ].join("\n");

    const redacted = redactDiagnosticText(value);
    expect(redacted).not.toContain(jwt);
    expect(redacted).not.toContain("super-secret-value");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("never-copy-this");
    expect(redacted).toContain("[REDACTED]");
  });

  it("sanitizes and bounds room/client identifiers", () => {
    expect(safeDiagnosticIdentifier("  table / secret?  ")).toBe("table___secret_");
    expect(safeDiagnosticIdentifier("x".repeat(120))).toHaveLength(80);
    expect(safeDiagnosticIdentifier("   ")).toBe("unknown");
  });
});

describe("network health", () => {
  it("prioritizes reconnection and poor packet-loss states", () => {
    expect(
      deriveNetworkHealth({
        connectionState: "reconnecting",
        livekitQuality: "excellent",
        packetLossPercent: 0
      }).tone
    ).toBe("poor");
    expect(
      deriveNetworkHealth({
        connectionState: "connected",
        livekitQuality: "excellent",
        packetLossPercent: 7.5
      }).label
    ).toBe("Poor");
  });
});
