import { useEffect, useState } from "react";
import { MAX_HANDOUT_TITLE_LENGTH, MAX_HANDOUT_URL_LENGTH } from "@/lib/protocol";
import type {
  HandoutControlPanelActions,
  HandoutControlPanelViewModel
} from "@/features/room-session/types";

type HandoutControlPanelProps = {
  model: HandoutControlPanelViewModel;
  actions: HandoutControlPanelActions;
};

export function HandoutControlPanel({
  model: { handout, isPublishing, commandError },
  actions: { onBroadcast, onStop }
}: HandoutControlPanelProps) {
  const [imageUrl, setImageUrl] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (handout) {
      setImageUrl(handout.imageUrl);
      setTitle(handout.title ?? "");
    }
  }, [handout]);

  return (
    <section className="px-5 pt-5 pb-4" data-testid="handout-control-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.2em] text-[var(--c-gold)]">PRESENTATION DESK</p>
          <h3 className="display-face mt-1 text-xs text-[var(--c-text-warm)]">Scene spotlight</h3>
        </div>
        {handout ? (
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.12em] text-[var(--c-emerald)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--c-emerald)]" /> LIVE
          </span>
        ) : null}
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onBroadcast(imageUrl, title);
        }}
      >
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--c-text-faint)]">Image URL</span>
          <input
            aria-label="Handout image URL"
            className="field mt-1 text-xs"
            disabled={isPublishing}
            maxLength={MAX_HANDOUT_URL_LENGTH}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://…/scene.jpg"
            type="url"
            value={imageUrl}
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--c-text-faint)]">Caption</span>
          <input
            aria-label="Handout caption"
            className="field mt-1 text-xs"
            disabled={isPublishing}
            maxLength={MAX_HANDOUT_TITLE_LENGTH}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="The ruined observatory"
            value={title}
          />
        </label>

        {commandError ? (
          <p className="text-[11px] leading-4 text-[var(--c-ember)]" role="alert">
            {commandError}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button className="chip" disabled={isPublishing} type="submit">
            {isPublishing ? "Sending…" : handout ? "Update handout" : "Broadcast handout"}
          </button>
          {handout ? (
            <button
              className="act act--hot"
              disabled={isPublishing}
              onClick={() => void onStop()}
              type="button"
            >
              End spotlight
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
