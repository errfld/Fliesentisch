import type { ReactNode } from "react";

type SessionSidebarProps = {
  open: boolean;
  splitPanel?: ReactNode;
  whisperPanel: ReactNode;
  rosterPanel: ReactNode;
  devicePanel: ReactNode;
};

export function SessionSidebar({ open, splitPanel, whisperPanel, rosterPanel, devicePanel }: SessionSidebarProps) {
  return (
    <aside
      className={`z-10 flex shrink-0 flex-col bg-[var(--c-ink)] transition-[width] duration-300 ${
        open ? "w-64" : "w-0 overflow-hidden"
      }`}
    >
      <div className="sidebar-scroll flex flex-1 flex-col overflow-y-auto">
        {splitPanel}
        {splitPanel ? <div className="mx-5 h-px bg-[var(--c-rule)]" /> : null}
        {whisperPanel}
        <div className="mx-5 h-px bg-[var(--c-rule)]" />
        {rosterPanel}
        <div className="mx-5 h-px bg-[var(--c-rule)]" />
        {devicePanel}
      </div>
    </aside>
  );
}
