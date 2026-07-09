import { useEffect, useState } from "react";
import type {
  HandoutSpotlightActions,
  HandoutSpotlightViewModel
} from "@/features/room-session/types";

type HandoutSpotlightSurfaceProps = {
  model: HandoutSpotlightViewModel;
  actions: HandoutSpotlightActions;
};

export function HandoutSpotlightSurface({
  model: { handout, presenterLabel, isMinimized },
  actions: { onMinimize, onRestore }
}: HandoutSpotlightSurfaceProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [handout?.imageUrl]);

  if (!handout) {
    return null;
  }

  if (isMinimized) {
    return (
      <button
        className="absolute bottom-5 left-5 z-20 flex max-w-[min(24rem,calc(100%-2.5rem))] items-center gap-3 border border-[var(--c-gold)]/40 bg-[var(--c-ink)]/95 px-4 py-3 text-left shadow-2xl backdrop-blur-md transition hover:border-[var(--c-gold)]"
        data-testid="handout-spotlight-minimized"
        onClick={onRestore}
        type="button"
      >
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--c-gold)]" />
        <span className="min-w-0">
          <span className="block text-[9px] font-semibold tracking-[0.18em] text-[var(--c-gold)]">HANDOUT LIVE</span>
          <span className="display-face block truncate text-xs text-[var(--c-text-warm)]">
            {handout.title ?? "Untitled scene"}
          </span>
        </span>
        <span className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.1em] text-[var(--c-text-dim)]">Restore</span>
      </button>
    );
  }

  return (
    <article
      aria-label="Shared handout spotlight"
      className="absolute inset-0 z-10 flex flex-col overflow-hidden bg-[color-mix(in_srgb,var(--c-void)_92%,black)]"
      data-testid="handout-spotlight"
    >
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_50%_40%,rgba(201,150,62,0.12),transparent_52%)]" />
      <header className="relative flex shrink-0 items-center justify-between gap-5 border-b border-[var(--c-rule-strong)] px-6 py-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold tracking-[0.22em] text-[var(--c-gold)]">
            {handout.presenterRole === "admin" ? "ADMIN PRESENTATION" : "GAMEMASTER PRESENTATION"}
          </p>
          <h2 className="display-face mt-1 truncate text-base text-[var(--c-text-warm)]">
            {handout.title ?? "Untitled scene"}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <p className="hidden text-right text-[10px] leading-4 text-[var(--c-text-faint)] sm:block">
            Presented by
            <span className="block text-[var(--c-text-dim)]" data-testid="handout-presenter">
              {presenterLabel}
            </span>
          </p>
          <button className="act" onClick={onMinimize} type="button">
            Minimize locally
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-5 sm:p-8">
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden border border-[var(--c-rule-strong)] bg-black/40 p-2 shadow-[0_24px_80px_rgba(0,0,0,0.6)] sm:p-4">
          <span className="pointer-events-none absolute top-0 left-0 h-8 w-8 border-t border-l border-[var(--c-gold)]/55" />
          <span className="pointer-events-none absolute right-0 bottom-0 h-8 w-8 border-r border-b border-[var(--c-gold)]/55" />
          {imageFailed ? (
            <div className="max-w-sm text-center">
              <p className="display-face text-lg text-[var(--c-text-warm)]">The image could not be displayed</p>
              <p className="mt-2 text-xs leading-5 text-[var(--c-text-dim)]">
                The spotlight is still active. Open the source directly or ask the presenter to update it.
              </p>
              <a
                className="act act--gold mt-5"
                href={handout.imageUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open source image
              </a>
            </div>
          ) : (
            <img
              alt={handout.title ?? "Shared handout"}
              className="block max-h-full max-w-full object-contain"
              data-testid="handout-image"
              onError={() => setImageFailed(true)}
              src={handout.imageUrl}
            />
          )}
        </div>
      </div>
    </article>
  );
}
