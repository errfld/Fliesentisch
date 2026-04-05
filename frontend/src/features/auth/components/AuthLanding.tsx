import { Link } from "@tanstack/react-router";
import { JoinForm } from "@/components/JoinForm";
import { buildGoogleLoginUrl } from "@/features/auth/lib/auth-api";
import type { SessionUser } from "@/features/auth/types";

type AuthLandingProps = {
  user?: SessionUser;
  onLogout: () => void;
  isLoggingOut: boolean;
};

function fallbackName(user?: SessionUser) {
  return user?.display_name?.trim() || user?.email.split("@")[0] || "Player";
}

export function AuthLanding({ user, onLogout, isLoggingOut }: AuthLandingProps) {
  const currentPath =
    typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  const loginHref = buildGoogleLoginUrl(currentPath);

  return (
    <main className="flex min-h-screen items-center bg-[var(--c-void)]">
      <div className="mx-auto grid w-full max-w-6xl gap-16 px-8 py-12 lg:grid-cols-[1fr_360px] lg:items-center lg:gap-24">
        <section>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">
            Google-authenticated room access with backend-owned session control
          </p>
          <h1 className="display-face mt-4 max-w-2xl text-5xl leading-[1.02] text-[var(--c-text-warm)] md:text-6xl">
            Virtual Table
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[var(--c-text-dim)]">
            Spotlight, whispers, and one steady room identity per player. The table opens only for explicitly allowed
            accounts, and the backend owns who gets to walk in.
          </p>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Allowlist</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                Access is tied to the Google account the group agreed on. No join key drift, no copied secrets.
              </p>
            </div>
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Stable identity</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                LiveKit identity is derived server-side from Google, while the nickname you display stays editable.
              </p>
            </div>
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Admin control</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                Admins manage players, gamemasters, and active access from one backend-owned user list.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--c-rule)] pt-5 text-[11px] text-[var(--c-text-faint)]">
            <span>
              Hold <kbd className="font-mono text-[var(--c-text-dim)]">V</kbd> for whisper push-to-talk
            </span>
            <span>
              Press <kbd className="font-mono text-[var(--c-text-dim)]">G</kbd> to leave a whisper
            </span>
            {user ? <span>Signed in as {user.email}</span> : <span>Google sign-in required before joining</span>}
          </div>
        </section>

        {user ? (
          <section className="border border-[var(--c-rule)] bg-[linear-gradient(180deg,rgba(20,26,31,0.96),rgba(8,9,11,0.96))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Authenticated</p>
                <h2 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">{fallbackName(user)}</h2>
                <p className="mt-2 text-sm text-[var(--c-text-dim)]">
                  {user.platform_role === "ADMIN" ? "Platform admin" : "Room user"} ·{" "}
                  {user.game_role === "GAMEMASTER" ? "Gamemaster" : "Player"}
                </p>
              </div>
              <button className="act act--hot" onClick={onLogout} type="button">
                {isLoggingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>

            <div className="mt-6 border-t border-[var(--c-rule)] pt-6">
              <JoinForm initialName={fallbackName(user)} />
            </div>

            <div className="mt-6 flex flex-wrap gap-4 border-t border-[var(--c-rule)] pt-4">
              {user.platform_role === "ADMIN" ? (
                <Link className="act act--gold" to="/admin">
                  Manage access
                </Link>
              ) : null}
              <p className="text-xs text-[var(--c-text-faint)]">Your room token is minted from this backend session.</p>
            </div>
          </section>
        ) : (
          <section className="border border-[var(--c-rule)] bg-[linear-gradient(180deg,rgba(20,26,31,0.96),rgba(8,9,11,0.96))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Sign in first</p>
            <h2 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">Enter through Google</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--c-text-dim)]">
              The backend checks whether your exact email is allowed before it issues any room token.
            </p>
            <a className="chip mt-8 w-full justify-center py-3 text-xs" href={loginHref}>
              Continue with Google
            </a>
            <p className="mt-4 text-xs text-[var(--c-text-faint)]">
              If this account should be allowed, ask an admin to add it in the access list.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
