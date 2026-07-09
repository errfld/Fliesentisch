import { useEffect, useRef, useState } from "react";
import { formatConnectionEvent, formatPacketLoss } from "@/features/room-session/lib/diagnostics";
import type {
  DiagnosticsHealthTone,
  DiagnosticsPanelActions,
  DiagnosticsPanelViewModel,
  DiagnosticsSubscriptionState
} from "@/features/room-session/types";

type DiagnosticsPanelProps = {
  model: DiagnosticsPanelViewModel;
  actions: DiagnosticsPanelActions;
};

const TONE_CLASSES: Record<DiagnosticsHealthTone, string> = {
  good: "bg-[var(--c-emerald)]",
  watch: "bg-[var(--c-gold)]",
  poor: "bg-[var(--c-ember)]",
  unknown: "bg-[var(--c-text-faint)]"
};

export function DiagnosticsPanel({ model, actions: { onClose } }: DiagnosticsPanelProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const copySummary = async () => {
    try {
      await copyText(model.summary);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
      data-testid="diagnostics-overlay"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="diagnostics-title"
        aria-modal="true"
        className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-[var(--c-rule-strong)] bg-[var(--c-ink)] shadow-[-24px_0_80px_rgba(0,0,0,0.45)]"
        data-testid="diagnostics-panel"
        role="dialog"
      >
        <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px)] [background-size:100%_28px]" />

        <header className="relative flex items-start justify-between border-b border-[var(--c-rule-strong)] px-6 py-5 sm:px-8">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-[var(--c-gold)]">
              <span className={`h-1.5 w-1.5 rounded-full ${TONE_CLASSES[model.network.tone]} shadow-[0_0_12px_currentColor]`} />
              Live signal ledger
            </div>
            <h2 id="diagnostics-title" className="display-face mt-2 text-lg text-[var(--c-text-warm)]">
              Room Diagnostics
            </h2>
            <p className="mt-1 text-xs text-[var(--c-text-faint)]">
              Safe telemetry for solving call trouble without exposing access credentials.
            </p>
          </div>
          <button
            aria-label="Close diagnostics"
            className="act"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="diagnostics-scroll relative flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <div className="grid gap-px border border-[var(--c-rule-strong)] bg-[var(--c-rule-strong)] sm:grid-cols-3">
            <MetricCell
              eyebrow="Connection"
              value={humanize(model.connectionState)}
              detail={`${Math.max(0, model.reconnectHistory.filter((entry) => entry.kind === "reconnected").length)} recoveries`}
              tone={model.connectionState === "connected" ? "good" : "poor"}
            />
            <MetricCell
              eyebrow="Network"
              value={model.network.label}
              detail={`Loss ${formatPacketLoss(model.network.packetLossPercent)}`}
              tone={model.network.tone}
            />
            <div className="bg-[var(--c-slab)] p-4" data-testid="diagnostics-mic-meter">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">
                <span>Mic activity</span>
                <span>{model.microphoneEnabled ? `${Math.round(model.microphoneLevel * 100)}%` : "Muted"}</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden bg-[var(--c-void)]">
                <div
                  className={`h-full transition-[width] duration-150 ${model.microphoneEnabled ? "bg-[var(--c-emerald)]" : "bg-[var(--c-text-faint)]"}`}
                  style={{ width: `${model.microphoneEnabled ? Math.max(2, model.microphoneLevel * 100) : 0}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--c-text-dim)]">
                {model.microphoneEnabled ? "Listening for local speech" : "Main microphone is muted"}
              </p>
            </div>
          </div>

          <DiagnosticSection index="01" title="Media subscriptions">
            <p className="mb-4 max-w-xl text-xs text-[var(--c-text-faint)]">
              Published tracks are compared with streams this browser is actually receiving.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <SubscriptionCard label="Main audio" state={model.mainAudio} testId="diagnostics-main-audio" />
              <SubscriptionCard label="Whisper audio" state={model.whisperAudio} testId="diagnostics-whisper-audio" />
              <SubscriptionCard label="Video" state={model.video} testId="diagnostics-video" />
            </div>
          </DiagnosticSection>

          <DiagnosticSection index="02" title="Active devices">
            <dl className="divide-y divide-[var(--c-rule)] border-y border-[var(--c-rule)]">
              <DeviceRow label="Microphone input" value={model.inputDeviceLabel} />
              <DeviceRow label="Audio output" value={model.outputDeviceLabel} />
              <DeviceRow label="Camera input" value={model.cameraDeviceLabel} />
            </dl>
          </DiagnosticSection>

          <DiagnosticSection index="03" title="Connection history">
            {model.reconnectHistory.length > 0 ? (
              <ol className="relative ml-1 border-l border-[var(--c-rule-strong)] pl-5">
                {model.reconnectHistory.map((entry, index) => (
                  <li className="relative pb-4 last:pb-0" key={`${entry.kind}-${entry.at}-${index}`}>
                    <span className={`absolute top-1 -left-[1.48rem] h-2 w-2 rounded-full border-2 border-[var(--c-ink)] ${entry.kind === "reconnecting" || entry.kind === "signal-reconnecting" ? "bg-[var(--c-ember)]" : "bg-[var(--c-emerald)]"}`} />
                    <p className="text-xs text-[var(--c-text)]">{humanize(entry.kind)}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-[var(--c-text-faint)]">
                      {formatConnectionEvent(entry).split(" at ")[1]}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-[var(--c-text-faint)]">No connection events recorded.</p>
            )}
          </DiagnosticSection>

          <DiagnosticSection index="04" title="Safe identifiers">
            <dl className="grid gap-3 font-mono text-[11px] sm:grid-cols-2">
              <div className="border border-[var(--c-rule)] bg-[var(--c-void)]/50 p-3">
                <dt className="uppercase tracking-[0.1em] text-[var(--c-text-faint)]">Room</dt>
                <dd className="mt-1 break-all text-[var(--c-text)]" data-testid="diagnostics-room-id">{model.roomName}</dd>
              </div>
              <div className="border border-[var(--c-rule)] bg-[var(--c-void)]/50 p-3">
                <dt className="uppercase tracking-[0.1em] text-[var(--c-text-faint)]">Client</dt>
                <dd className="mt-1 break-all text-[var(--c-text)]" data-testid="diagnostics-client-id">{model.clientIdentity}</dd>
              </div>
            </dl>
          </DiagnosticSection>
        </div>

        <footer className="relative flex items-center justify-between gap-4 border-t border-[var(--c-rule-strong)] bg-[var(--c-void)]/80 px-6 py-4 sm:px-8">
          <p aria-live="polite" className="text-[11px] text-[var(--c-text-faint)]">
            {copyStatus === "copied" ? "Copied — paste this into a bug report." : copyStatus === "failed" ? "Copy failed. Check clipboard permissions." : `Captured ${new Date(model.capturedAt).toLocaleTimeString()}`}
          </p>
          <button className="chip" data-testid="copy-diagnostics" onClick={() => void copySummary()} type="button">
            Copy redacted summary
          </button>
        </footer>
      </section>
    </div>
  );
}

function MetricCell({
  eyebrow,
  value,
  detail,
  tone
}: {
  eyebrow: string;
  value: string;
  detail: string;
  tone: DiagnosticsHealthTone;
}) {
  return (
    <div className="bg-[var(--c-slab)] p-4">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">{eyebrow}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${TONE_CLASSES[tone]}`} />
        <p className="display-face text-sm text-[var(--c-text-warm)]">{value}</p>
      </div>
      <p className="mt-2 text-xs text-[var(--c-text-dim)]">{detail}</p>
    </div>
  );
}

function DiagnosticSection({ index, title, children }: { index: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-4 flex items-baseline gap-3 border-b border-[var(--c-rule)] pb-2">
        <span className="font-mono text-[10px] text-[var(--c-gold)]">{index}</span>
        <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SubscriptionCard({ label, state, testId }: { label: string; state: DiagnosticsSubscriptionState; testId: string }) {
  const healthy = state.published === state.subscribed;
  return (
    <article className="border border-[var(--c-rule)] bg-[var(--c-slab)] p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[11px] uppercase tracking-[0.08em] text-[var(--c-text-dim)]">{label}</h4>
        <span className={`h-1.5 w-1.5 rounded-full ${healthy ? "bg-[var(--c-emerald)]" : "bg-[var(--c-gold)]"}`} />
      </div>
      <p className="display-face mt-4 text-2xl text-[var(--c-text-warm)]">
        {state.subscribed}<span className="text-sm text-[var(--c-text-faint)]">/{state.published}</span>
      </p>
      <p className="mt-1 text-[11px] text-[var(--c-text-faint)]">
        receiving · {state.muted} muted
      </p>
    </article>
  );
}

function DeviceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-[10px] uppercase tracking-[0.1em] text-[var(--c-text-faint)]">{label}</dt>
      <dd className="truncate text-xs text-[var(--c-text)]" title={value}>{value}</dd>
    </div>
  );
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase());
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through for browsers that expose Clipboard API without granting permission.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) {
    throw new Error("Clipboard unavailable");
  }
}
