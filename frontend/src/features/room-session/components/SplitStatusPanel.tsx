type SplitStatusPanelProps = {
  isActive: boolean;
  currentRoomName: string;
  participantCount: number;
  notice: string | null;
};

export function SplitStatusPanel({
  isActive,
  currentRoomName,
  participantCount,
  notice
}: SplitStatusPanelProps) {
  if (!isActive && !notice) {
    return null;
  }

  return (
    <section className="px-5 pt-4 pb-4">
      <div className="rounded-md border border-[var(--c-rule)] bg-[color-mix(in_srgb,var(--c-ink)_82%,black)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="display-face text-[11px] tracking-[0.08em] text-[var(--c-text-warm)]">
              {isActive ? "SPLIT MODE" : "TABLE MODE"}
            </p>
            <p className="mt-1 text-xs text-[var(--c-text)]">{currentRoomName}</p>
          </div>
          <div className="text-right text-[10px] text-[var(--c-text-faint)]">
            <p>{participantCount} visible</p>
          </div>
        </div>
        {notice ? (
          <p className="mt-3 text-[11px] leading-5 text-[var(--c-gold)]" data-testid="split-room-notice">
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}
