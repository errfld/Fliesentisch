import { Link } from "@tanstack/react-router";
import type { SessionUser } from "@/features/auth/types";
import { CampaignAdminPanel } from "@/features/campaigns/components/CampaignAdminPanel";
import { useCampaignDirectory } from "@/features/campaigns/hooks/useCampaigns";

export function CampaignConsole({ currentUser }: { currentUser: SessionUser }) {
  const directory = useCampaignDirectory(true);

  return (
    <main className="min-h-screen bg-[var(--c-void)] px-8 py-12">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--c-rule)] pb-8">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">Gamemaster ledger</p>
            <h1 className="display-face mt-3 text-4xl text-[var(--c-text-warm)]">Campaign tables</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--c-text-dim)]">
              Keep recurring rooms, seats, and split-room defaults ready before game night begins.
            </p>
          </div>
          <div className="text-right text-sm text-[var(--c-text-dim)]">
            <p>{currentUser.email}</p>
            <Link className="act mt-3 justify-end" to="/">
              Return home
            </Link>
          </div>
        </header>

        {directory.error ? (
          <div className="panel mt-8 text-sm text-[var(--c-ember)]">{directory.error}</div>
        ) : null}
        {directory.isLoading ? (
          <p className="mt-8 text-sm text-[var(--c-text-dim)]">Opening the player ledger...</p>
        ) : (
          <CampaignAdminPanel users={directory.users} />
        )}
      </div>
    </main>
  );
}
