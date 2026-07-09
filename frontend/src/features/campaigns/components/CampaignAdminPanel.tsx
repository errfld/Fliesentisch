import { useEffect, useMemo, useState } from "react";
import { useManagedCampaigns } from "@/features/campaigns/hooks/useCampaigns";
import type { CampaignDirectoryUser, CampaignInput, CampaignPreset } from "@/features/campaigns/types";
import { InvitePanel } from "@/features/invites/components/InvitePanel";

const EMPTY_CAMPAIGN: CampaignInput = {
  display_name: "",
  room_slug: "",
  gamemaster_user_ids: [],
  player_user_ids: [],
  default_split_room_names: [],
  is_archived: false
};

export function CampaignAdminPanel({ users }: { users: CampaignDirectoryUser[] }) {
  const campaigns = useManagedCampaigns(true);
  const [draft, setDraft] = useState<CampaignInput>(EMPTY_CAMPAIGN);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const create = async () => {
    setPending(true);
    setActionError(null);
    try {
      await campaigns.create(draft);
      setDraft(EMPTY_CAMPAIGN);
    } catch (value) {
      setActionError(value instanceof Error ? value.message : "Failed to create campaign");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="mt-16 border-t border-[var(--c-rule)] pt-10" data-testid="campaign-admin-panel">
      <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">Recurring tables</p>
          <h2 className="display-face mt-3 text-3xl text-[var(--c-text-warm)]">Campaign presets</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--c-text-dim)]">
            Give each campaign a durable room and a precise guest list. Players only see tables where they have a seat.
          </p>
          <div className="mt-7 border border-[var(--c-rule)] bg-[var(--c-ink)] p-5" data-testid="campaign-create-form">
            <CampaignFields input={draft} onChange={setDraft} users={users} />
            {actionError ? <p className="mt-4 text-sm text-[var(--c-ember)]">{actionError}</p> : null}
            <button
              className="chip mt-6 w-full justify-center py-3 text-xs"
              disabled={pending || !draft.display_name.trim() || !draft.room_slug.trim()}
              onClick={() => void create()}
              type="button"
            >
              {pending ? "Creating..." : "Create campaign"}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {campaigns.error ? <p className="text-sm text-[var(--c-ember)]">{campaigns.error}</p> : null}
          {campaigns.isLoading ? <p className="text-sm text-[var(--c-text-dim)]">Loading campaigns...</p> : null}
          {campaigns.campaigns.map((campaign) => (
            <CampaignCard
              campaign={campaign}
              key={campaign.id}
              onArchive={campaigns.archive}
              onSave={campaigns.save}
              users={users}
            />
          ))}
          {!campaigns.isLoading && campaigns.campaigns.length === 0 ? (
            <div className="border border-dashed border-[var(--c-rule)] p-8 text-sm text-[var(--c-text-faint)]">
              No recurring table yet. Create the first campaign from the ledger at left.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CampaignCard({
  campaign,
  onArchive,
  onSave,
  users
}: {
  campaign: CampaignPreset;
  onArchive: (id: number) => Promise<void>;
  onSave: (id: number, input: CampaignInput) => Promise<CampaignPreset>;
  users: CampaignDirectoryUser[];
}) {
  const [draft, setDraft] = useState<CampaignInput>(toInput(campaign));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(toInput(campaign)), [campaign]);

  const run = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Campaign update failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <article
      className="border border-[var(--c-rule)] bg-[linear-gradient(135deg,rgba(20,26,31,0.98),rgba(8,9,11,0.94))] p-6"
      data-testid={`campaign-${campaign.id}`}
    >
      <div className="mb-5 flex items-center justify-between gap-4 border-b border-[var(--c-rule)] pb-4">
        <div>
          <h3 className="display-face text-xl text-[var(--c-text-warm)]">{campaign.display_name}</h3>
          <p className="mt-1 font-mono text-[11px] text-[var(--c-text-faint)]">/{campaign.room_slug}</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">
          {campaign.is_archived ? "Archived" : "Open"}
        </span>
      </div>
      <CampaignFields input={draft} onChange={setDraft} users={users} />
      {error ? <p className="mt-4 text-sm text-[var(--c-ember)]">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-4">
        {!campaign.is_archived ? (
          <button className="act act--hot" disabled={pending} onClick={() => void run(() => onArchive(campaign.id))} type="button">
            Archive
          </button>
        ) : null}
        <button className="act act--gold" disabled={pending} onClick={() => void run(() => onSave(campaign.id, draft))} type="button">
          {pending ? "Saving..." : "Save preset"}
        </button>
      </div>
      <InvitePanel campaignArchived={campaign.is_archived} campaignId={campaign.id} />
    </article>
  );
}

function CampaignFields({
  input,
  onChange,
  users
}: {
  input: CampaignInput;
  onChange: (input: CampaignInput) => void;
  users: CampaignDirectoryUser[];
}) {
  const activeUsers = useMemo(() => users.filter((user) => user.is_active), [users]);
  return (
    <div className="space-y-5">
      <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
        Display name
        <input className="field" value={input.display_name} onChange={(event) => onChange({ ...input, display_name: event.target.value })} placeholder="Thursday Night" />
      </label>
      <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
        Room slug
        <input className="field font-mono" value={input.room_slug} onChange={(event) => onChange({ ...input, room_slug: slugify(event.target.value) })} placeholder="thursday-night" />
      </label>
      <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
        Default split rooms
        <input
          className="field"
          value={input.default_split_room_names.join(", ")}
          onChange={(event) => onChange({ ...input, default_split_room_names: splitList(event.target.value) })}
          placeholder="Library, Courtyard"
        />
      </label>
      <fieldset>
        <legend className="text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">Seats</legend>
        <div className="mt-3 max-h-44 space-y-2 overflow-y-auto border border-[var(--c-rule)] p-3">
          {activeUsers.map((user) => {
            const role = input.gamemaster_user_ids.includes(user.id)
              ? "gm"
              : input.player_user_ids.includes(user.id)
                ? "player"
                : "none";
            return (
              <div className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs" key={user.id}>
                <span className="truncate text-[var(--c-text-dim)]">{user.display_name || user.email}</span>
                <select aria-label={`Seat for ${user.email}`} className="border border-[var(--c-rule)] bg-[var(--c-void)] px-2 py-1 text-[var(--c-text-warm)]" value={role} onChange={(event) => onChange(setMemberRole(input, user.id, event.target.value))}>
                  <option value="none">No seat</option>
                  <option value="player">Player</option>
                  <option value="gm">GM</option>
                </select>
              </div>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

function setMemberRole(input: CampaignInput, userId: number, role: string): CampaignInput {
  return {
    ...input,
    gamemaster_user_ids: role === "gm" ? [...input.gamemaster_user_ids.filter((id) => id !== userId), userId] : input.gamemaster_user_ids.filter((id) => id !== userId),
    player_user_ids: role === "player" ? [...input.player_user_ids.filter((id) => id !== userId), userId] : input.player_user_ids.filter((id) => id !== userId)
  };
}

function toInput(campaign: CampaignPreset): CampaignInput {
  return {
    display_name: campaign.display_name,
    room_slug: campaign.room_slug,
    gamemaster_user_ids: campaign.gamemaster_user_ids,
    player_user_ids: campaign.player_user_ids,
    default_split_room_names: campaign.default_split_room_names,
    is_archived: campaign.is_archived
  };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
