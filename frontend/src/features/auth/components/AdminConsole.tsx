import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAdminUsers } from "@/features/auth/hooks/useAdminUsers";
import type { AdminUser, GameRole, PlatformRole, SessionUser } from "@/features/auth/types";

type AdminConsoleProps = {
  currentUser: SessionUser;
};

type UserDraft = {
  email: string;
  display_name: string;
  platform_role: PlatformRole;
  game_role: GameRole;
  is_active: boolean;
};

const EMPTY_DRAFT: UserDraft = {
  email: "",
  display_name: "",
  platform_role: "USER",
  game_role: "PLAYER",
  is_active: true
};

export function AdminConsole({ currentUser }: AdminConsoleProps) {
  const { createUser, error, isLoading, removeUser, saveUser, users } = useAdminUsers(true);
  const [draft, setDraft] = useState<UserDraft>(EMPTY_DRAFT);
  const [pendingUserIds, setPendingUserIds] = useState<Set<number>>(() => new Set());
  const [createError, setCreateError] = useState<string | null>(null);

  const onCreate = async () => {
    setCreateError(null);

    try {
      await createUser({
        ...draft,
        display_name: draft.display_name.trim() || undefined,
        email: draft.email.trim()
      });
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create user");
    }
  };

  const markUserPending = (userId: number, isPending: boolean) => {
    setPendingUserIds((current) => {
      const next = new Set(current);
      if (isPending) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  };

  const onSave = async (user: AdminUser) => {
    markUserPending(user.id, true);
    try {
      const trimmedDisplayName = user.display_name?.trim() ?? "";
      await saveUser(user.id, {
        display_name: trimmedDisplayName === "" ? "" : trimmedDisplayName,
        email: user.email.trim(),
        game_role: user.game_role,
        is_active: user.is_active,
        platform_role: user.platform_role
      });
    } finally {
      markUserPending(user.id, false);
    }
  };

  const onDelete = async (userId: number) => {
    markUserPending(userId, true);
    try {
      await removeUser(userId);
    } finally {
      markUserPending(userId, false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--c-void)] px-8 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--c-rule)] pb-8">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">Admin console</p>
            <h1 className="display-face mt-3 text-4xl text-[var(--c-text-warm)]">Allowlist and roles</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--c-text-dim)]">
              Manage who can sign in, who stays active, and whether they enter the table as a gamemaster or player.
            </p>
          </div>
          <div className="text-right text-sm text-[var(--c-text-dim)]">
            <p>{currentUser.email}</p>
            <Link className="act mt-3 justify-end" to="/">
              Return home
            </Link>
          </div>
        </div>

        <section className="mt-8 grid gap-8 lg:grid-cols-[340px_1fr]">
          <div className="border border-[var(--c-rule)] bg-[var(--c-ink)] p-6" data-testid="admin-create-form">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Add user</p>
            <div className="mt-6 space-y-5">
              <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
                Email
                <input
                  className="field"
                  value={draft.email}
                  onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                  placeholder="player@example.com"
                />
              </label>
              <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
                Nickname
                <input
                  className="field"
                  value={draft.display_name}
                  onChange={(event) => setDraft((current) => ({ ...current, display_name: event.target.value }))}
                  placeholder="Optional"
                />
              </label>
              <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
                Platform role
                <select
                  className="field"
                  value={draft.platform_role}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      platform_role: event.target.value as PlatformRole
                    }))}
                >
                  <option value="USER">User</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
              <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
                Game role
                <select
                  className="field"
                  value={draft.game_role}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      game_role: event.target.value as GameRole
                    }))}
                >
                  <option value="PLAYER">Player</option>
                  <option value="GAMEMASTER">Gamemaster</option>
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm text-[var(--c-text-dim)]">
                <input
                  checked={draft.is_active}
                  onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                  type="checkbox"
                />
                Active
              </label>
              {createError ? <p className="text-sm text-[var(--c-ember)]">{createError}</p> : null}
              <button className="chip w-full justify-center py-3 text-xs" onClick={() => void onCreate()} type="button">
                Add to allowlist
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {error ? <p className="text-sm text-[var(--c-ember)]">{error}</p> : null}
            {isLoading ? <p className="text-sm text-[var(--c-text-dim)]">Loading users...</p> : null}
            {users.map((user) => (
              <EditableUserCard
                busy={pendingUserIds.has(user.id)}
                key={user.id}
                onDelete={onDelete}
                onSave={onSave}
                user={user}
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function EditableUserCard({
  busy,
  onDelete,
  onSave,
  user
}: {
  busy: boolean;
  onDelete: (userId: number) => Promise<void>;
  onSave: (user: AdminUser) => Promise<void>;
  user: AdminUser;
}) {
  const [draft, setDraft] = useState(user);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(user);
  }, [user]);

  return (
    <article
      className="border border-[var(--c-rule)] bg-[linear-gradient(180deg,rgba(20,26,31,0.94),rgba(8,9,11,0.94))] p-5"
      data-testid={`admin-user-${user.id}`}
    >
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr_1fr_auto] lg:items-end">
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Email
          <input
            className="field"
            value={draft.email}
            onChange={(event) => {
              setError(null);
              setDraft((current) => ({ ...current, email: event.target.value }));
            }}
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Nickname
          <input
            className="field"
            value={draft.display_name ?? ""}
            onChange={(event) => {
              setError(null);
              setDraft((current) => ({ ...current, display_name: event.target.value || undefined }));
            }}
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Role mix
          <div className="grid grid-cols-2 gap-3">
            <select
              className="field"
              value={draft.platform_role}
              onChange={(event) => {
                setError(null);
                setDraft((current) => ({ ...current, platform_role: event.target.value as PlatformRole }));
              }}
            >
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
            <select
              className="field"
              value={draft.game_role}
              onChange={(event) => {
                setError(null);
                setDraft((current) => ({ ...current, game_role: event.target.value as GameRole }));
              }}
            >
              <option value="PLAYER">Player</option>
              <option value="GAMEMASTER">Gamemaster</option>
            </select>
          </div>
        </label>
        <div className="flex flex-wrap items-center justify-end gap-4">
          <label className="flex items-center gap-3 text-sm text-[var(--c-text-dim)]">
            <input
              checked={draft.is_active}
              onChange={(event) => {
                setError(null);
                setDraft((current) => ({ ...current, is_active: event.target.checked }));
              }}
              type="checkbox"
            />
            Active
          </label>
          <button
            className="act act--gold"
            disabled={busy}
            onClick={() =>
              void onSave(draft).catch((err) => {
                setError(err instanceof Error ? err.message : "Failed to save user");
              })}
            type="button"
          >
            {busy ? "Saving..." : "Save"}
          </button>
          <button
            className="act act--hot"
            disabled={busy}
            onClick={() =>
              void onDelete(draft.id).catch((err) => {
                setError(err instanceof Error ? err.message : "Failed to delete user");
              })}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--c-text-faint)]">
        <span>{draft.is_linked ? "Linked to Google account" : "Not signed in yet"}</span>
        <span>{draft.game_role === "GAMEMASTER" ? "Gamemaster access" : "Player access"}</span>
      </div>
      {error ? <p className="mt-3 text-sm text-[var(--c-ember)]">{error}</p> : null}
    </article>
  );
}
