import type { FormEvent } from "react";

type JoinFormSession = {
  email: string;
  gameRole: string;
  platformRole: string;
};

type JoinFormProps = {
  authBusy: boolean;
  authError: string | null;
  authIsLoading: boolean;
  authSession: JoinFormSession | null;
  email: string;
  isAuthenticated: boolean;
  joinKey: string;
  name: string;
  onChangeEmail: (value: string) => void;
  onChangeJoinKey: (value: string) => void;
  onChangeName: (value: string) => void;
  onChangeRoom: (value: string) => void;
  onSignIn: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onSignOut: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  room: string;
};

export function JoinForm({
  authBusy,
  authError,
  authIsLoading,
  authSession,
  email,
  isAuthenticated,
  joinKey,
  name,
  onChangeEmail,
  onChangeJoinKey,
  onChangeName,
  onChangeRoom,
  onSignIn,
  onSignOut,
  onSubmit,
  room
}: JoinFormProps) {
  return (
    <section className="w-full max-w-sm">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Enter the room</p>
      <h1 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">Join the table</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--c-text-dim)]">
        Choose the name your group knows you by and step into the room. Whispers and spotlight stay inside.
      </p>
      <div className="mt-6 rounded-md border border-[var(--c-rule)] bg-[color-mix(in_srgb,var(--c-ink)_78%,black)] p-4">
        <p className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">Simple Auth</p>
        {authIsLoading ? (
          <p className="mt-2 text-sm text-[var(--c-text-dim)]">Checking session…</p>
        ) : authSession ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-[var(--c-text)]">
              Signed in as <span className="font-medium">{authSession.email}</span>
            </p>
            <p className="text-[11px] text-[var(--c-text-faint)]">
              Role: {authSession.gameRole} / {authSession.platformRole}
            </p>
            <button className="act" onClick={onSignOut} type="button">
              Sign out
            </button>
          </div>
        ) : (
          <form className="mt-3 space-y-3" onSubmit={onSignIn}>
            <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
              Allowed email
              <input
                className="field"
                value={email}
                onChange={(event) => onChangeEmail(event.target.value)}
                placeholder="gm@example.com"
                required
                type="email"
              />
            </label>
            <button className="chip w-full justify-center py-2 text-xs" disabled={authBusy} type="submit">
              {authBusy ? "Signing in…" : "Sign in"}
            </button>
            <p className="text-[11px] leading-5 text-[var(--c-text-faint)]">
              This simple auth trusts an allowlisted email and sets a local session cookie. It is a stopgap until full
              backend OAuth lands.
            </p>
          </form>
        )}
        {authError ? <p className="mt-3 text-[11px] text-[var(--c-ember)]">{authError}</p> : null}
      </div>
      <form className="mt-8 space-y-6" onSubmit={onSubmit}>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Display name
          <input
            className="field"
            value={name}
            onChange={(event) => onChangeName(event.target.value)}
            placeholder="Alice"
            required
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Room
          <input
            className="field"
            value={room}
            onChange={(event) => onChangeRoom(event.target.value)}
            placeholder="dnd-table-1"
            required
          />
        </label>
        {!isAuthenticated ? (
          <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
            Join key
            <input
              className="field"
              value={joinKey}
              onChange={(event) => onChangeJoinKey(event.target.value)}
              placeholder="Optional"
            />
          </label>
        ) : null}
        <button className="chip mt-4 w-full justify-center py-2.5 text-xs" type="submit">
          Enter table
        </button>
      </form>
    </section>
  );
}
