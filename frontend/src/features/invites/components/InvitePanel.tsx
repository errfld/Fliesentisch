import { useState } from "react";
import { useCampaignInvites } from "@/features/invites/hooks/useInvites";
import type { CampaignInvite, InviteInput } from "@/features/invites/types";

export function InvitePanel({ campaignId, campaignArchived }: { campaignId: number; campaignArchived: boolean }) {
  const inviteState = useCampaignInvites(campaignId);
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy link");

  const create = async () => {
    setPending(true);
    setActionError(null);
    try {
      const input: InviteInput = {
        role: "PLAYER",
        expires_at: expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined,
        max_uses: maxUses ? Number(maxUses) : undefined
      };
      const created = await inviteState.create(input);
      const origin = typeof window === "undefined" ? "" : window.location.origin;
      setCreatedLink(`${origin}${created.path}`);
      setCopyLabel("Copy link");
    } catch (value) {
      setActionError(value instanceof Error ? value.message : "Failed to create invite");
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Select and copy");
    }
  };

  const revoke = async (inviteId: number) => {
    setActionError(null);
    try {
      await inviteState.revoke(inviteId);
    } catch (value) {
      setActionError(value instanceof Error ? value.message : "Failed to revoke invite");
    }
  };

  return (
    <section className="mt-7 border-t border-dashed border-[var(--c-rule)] pt-6" data-testid={`invite-panel-${campaignId}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--c-gold)]">Admit one more traveler</p>
          <h4 className="display-face mt-2 text-lg text-[var(--c-text-warm)]">Player invite slips</h4>
          <p className="mt-2 max-w-xl text-xs leading-5 text-[var(--c-text-dim)]">
            Each bearer link grants only a player seat at this table. The secret is shown once.
          </p>
        </div>
        <span className="border border-[var(--c-rule)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">
          Player only
        </span>
      </div>

      {!campaignArchived ? (
        <div className="mt-5 grid gap-3 border border-[var(--c-rule)] bg-[rgba(0,0,0,0.16)] p-4 sm:grid-cols-[1fr_110px_auto] sm:items-end" data-testid="invite-create-form">
          <label className="text-[9px] uppercase tracking-[0.08em] text-[var(--c-text-dim)]">
            Expires (optional)
            <input className="field mt-2" min={localDateTimeMinimum()} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" value={expiresAt} />
          </label>
          <label className="text-[9px] uppercase tracking-[0.08em] text-[var(--c-text-dim)]">
            Max uses
            <input className="field mt-2" max={1000} min={1} onChange={(event) => setMaxUses(event.target.value)} type="number" value={maxUses} />
          </label>
          <button className="act act--gold h-[42px] justify-center" disabled={pending} onClick={() => void create()} type="button">
            {pending ? "Sealing..." : "Create slip"}
          </button>
        </div>
      ) : null}

      {createdLink ? (
        <div className="mt-4 border-l-2 border-[var(--c-gold)] bg-[rgba(182,137,69,0.08)] p-4" data-testid="created-invite-slip">
          <p className="text-[9px] uppercase tracking-[0.14em] text-[var(--c-gold)]">Fresh seal · copy now</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input aria-label="New invite link" className="field min-w-0 flex-1 font-mono text-[11px]" readOnly value={createdLink} />
            <button className="act" onClick={() => void copy()} type="button">{copyLabel}</button>
            <a className="act" href={createdLink}>Open invite</a>
          </div>
        </div>
      ) : null}

      {actionError || inviteState.error ? (
        <p className="mt-4 text-xs text-[var(--c-ember)]">{actionError ?? inviteState.error}</p>
      ) : null}
      {inviteState.isLoading ? <p className="mt-4 text-xs text-[var(--c-text-faint)]">Checking issued slips...</p> : null}
      <div className="mt-4 grid gap-2">
        {inviteState.invites.map((invite) => (
          <InviteRow invite={invite} key={invite.id} onRevoke={revoke} />
        ))}
        {!inviteState.isLoading && inviteState.invites.length === 0 ? (
          <p className="border border-dashed border-[var(--c-rule)] px-4 py-3 text-xs text-[var(--c-text-faint)]">No invite slips issued.</p>
        ) : null}
      </div>
    </section>
  );
}

function InviteRow({ invite, onRevoke }: { invite: CampaignInvite; onRevoke: (id: number) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="grid gap-3 border border-[var(--c-rule)] px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center" data-testid={`invite-${invite.id}`}>
      <div>
        <p className="font-mono text-[11px] text-[var(--c-text-dim)]">seal {invite.token_hint}…</p>
        <p className="mt-1 text-[10px] text-[var(--c-text-faint)]">
          {usageLabel(invite)} · {expiryLabel(invite.expires_at)}
        </p>
      </div>
      <span className={`text-[9px] uppercase tracking-[0.14em] ${invite.status === "ACTIVE" ? "text-[var(--c-emerald)]" : "text-[var(--c-ember)]"}`}>
        {invite.status.toLowerCase()}
      </span>
      {invite.status === "ACTIVE" ? (
        <button
          className="act act--hot"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void onRevoke(invite.id).finally(() => setPending(false));
          }}
          type="button"
        >
          {pending ? "Revoking..." : "Revoke"}
        </button>
      ) : null}
    </div>
  );
}

function usageLabel(invite: CampaignInvite) {
  return invite.max_uses ? `${invite.use_count} of ${invite.max_uses} used` : `${invite.use_count} used`;
}

function expiryLabel(expiresAt?: number) {
  return expiresAt ? `expires ${new Date(expiresAt * 1000).toLocaleString()}` : "no expiry";
}

function localDateTimeMinimum() {
  const date = new Date(Date.now() + 60_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
