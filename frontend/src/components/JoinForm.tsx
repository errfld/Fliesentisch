import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";

const DEFAULT_ROOM = import.meta.env.VITE_DEFAULT_ROOM ?? "dnd-table-1";
const DEFAULT_JOIN_KEY = import.meta.env.VITE_JOIN_KEY ?? "";

export function JoinForm() {
  const navigate = useNavigate({ from: "/" });
  const auth = useAuthSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [joinKey, setJoinKey] = useState(DEFAULT_JOIN_KEY);
  const [authBusy, setAuthBusy] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    void navigate({
      to: "/room/$room",
      params: { room: room.trim() || DEFAULT_ROOM },
      search: {
        name: name.trim() || "Player",
        joinKey: auth.isAuthenticated ? undefined : joinKey.trim() || undefined
      }
    });
  };

  const onSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    try {
      await auth.login(email.trim());
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <section className="w-full max-w-sm">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Enter the room</p>
      <h1 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">Join the table</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--c-text-dim)]">
        Choose the name your group knows you by and step into the room. Whispers and spotlight stay inside.
      </p>
      <div className="mt-6 rounded-md border border-[var(--c-rule)] bg-[color-mix(in_srgb,var(--c-ink)_78%,black)] p-4">
        <p className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">Simple Auth</p>
        {auth.isLoading ? (
          <p className="mt-2 text-sm text-[var(--c-text-dim)]">Checking session…</p>
        ) : auth.session ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm text-[var(--c-text)]">
              Signed in as <span className="font-medium">{auth.session.email}</span>
            </p>
            <p className="text-[11px] text-[var(--c-text-faint)]">
              Role: {auth.session.game_role} / {auth.session.platform_role}
            </p>
            <button className="act" onClick={() => void auth.logout()} type="button">
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
                onChange={(event) => setEmail(event.target.value)}
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
        {auth.error ? <p className="mt-3 text-[11px] text-[var(--c-ember)]">{auth.error}</p> : null}
      </div>
      <form className="mt-8 space-y-6" onSubmit={onSubmit}>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Display name
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alice"
            required
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Room
          <input
            className="field"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="dnd-table-1"
            required
          />
        </label>
        {!auth.isAuthenticated ? (
          <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
            Join key
            <input
              className="field"
              value={joinKey}
              onChange={(event) => setJoinKey(event.target.value)}
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
