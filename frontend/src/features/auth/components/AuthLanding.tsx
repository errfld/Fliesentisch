import { Link } from "@tanstack/react-router";
import { JoinForm } from "@/components/JoinForm";
import { buildGoogleLoginUrl } from "@/features/auth/lib/auth-api";
import type { SessionUser } from "@/features/auth/types";
import type { CampaignPreset } from "@/features/campaigns/types";

type AuthLandingProps = {
  campaigns?: CampaignPreset[];
  campaignsError?: string | null;
  campaignsLoading?: boolean;
  user?: SessionUser;
  onLogout: () => void;
  isLoggingOut: boolean;
  onRetryCampaigns?: () => void;
};

function fallbackName(user?: SessionUser) {
  return user?.display_name?.trim() || user?.email.split("@")[0] || "Player";
}

export function AuthLanding({
  campaigns,
  campaignsError,
  campaignsLoading,
  user,
  onLogout,
  onRetryCampaigns,
  isLoggingOut
}: AuthLandingProps) {
  const currentPath =
    typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  const loginHref = buildGoogleLoginUrl(currentPath);

  return (
    <main className="flex min-h-screen items-center bg-[var(--c-void)]">
      <div className="mx-auto grid w-full max-w-6xl gap-16 px-8 py-12 lg:grid-cols-[1fr_360px] lg:items-center lg:gap-24">
        <section>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">Private game night</p>
          <h1 className="display-face mt-4 max-w-2xl text-5xl leading-[1.02] text-[var(--c-text-warm)] md:text-6xl">
            Welcome to the table
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[var(--c-text-dim)]">
            If you're here, you already know what this is. Sign in with the Google account we added, pick the name
            everyone knows you by, and join the room.
          </p>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Same room</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                Use the usual room unless someone said otherwise.
              </p>
            </div>
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Whispers</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                Step aside for a quick private chat without leaving the table.
              </p>
            </div>
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">GM spotlight</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                When the GM needs everyone's eyes in one place, follow the spotlight.
              </p>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--c-rule)] pt-5 text-[11px] text-[var(--c-text-faint)]">
            <span>
              Hold <kbd className="font-mono text-[var(--c-text-dim)]">V</kbd> to whisper
            </span>
            <span>
              Press <kbd className="font-mono text-[var(--c-text-dim)]">G</kbd> to leave a whisper
            </span>
            {user ? <span>Signed in as {user.email}</span> : <span>Sign in first, then join</span>}
          </div>
        </section>

        {user ? (
          <section className="border border-[var(--c-rule)] bg-[linear-gradient(180deg,rgba(20,26,31,0.96),rgba(8,9,11,0.96))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Authenticated</p>
                <h2 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">You're signed in</h2>
                <p className="mt-2 text-sm text-[var(--c-text-dim)]">
                  {user.platform_role === "ADMIN" ? "Platform admin" : "Room user"} ·{" "}
                  {user.game_role === "GAMEMASTER" ? "Gamemaster" : "Player"}
                </p>
              </div>
              <button
                aria-busy={isLoggingOut}
                className="act act--hot"
                disabled={isLoggingOut}
                onClick={onLogout}
                type="button"
              >
                {isLoggingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>

            <div className="mt-6 border-t border-[var(--c-rule)] pt-6">
              <JoinForm
                campaigns={campaigns}
                campaignsError={campaignsError}
                campaignsLoading={campaignsLoading}
                initialName={fallbackName(user)}
                onRetryCampaigns={onRetryCampaigns}
              />
            </div>

            <div className="mt-6 flex flex-wrap gap-4 border-t border-[var(--c-rule)] pt-4">
              {user.platform_role === "ADMIN" || user.game_role === "GAMEMASTER" ? (
                <Link className="act act--gold" to="/campaigns">
                  Manage campaigns
                </Link>
              ) : null}
              {user.platform_role === "ADMIN" ? (
                <Link className="act act--gold" to="/admin">
                  Manage access
                </Link>
              ) : null}
              <p className="text-xs text-[var(--c-text-faint)]">All set. Join when you're ready.</p>
            </div>
          </section>
        ) : (
          <section className="border border-[var(--c-rule)] bg-[linear-gradient(180deg,rgba(20,26,31,0.96),rgba(8,9,11,0.96))] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
            <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Sign in first</p>
            <h2 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">Use your game account</h2>
            <p className="mt-3 text-sm leading-6 text-[var(--c-text-dim)]">
              Sign in with the Google account we added for the game.
            </p>
            <a className="chip mt-8 w-full justify-center py-3 text-xs" href={loginHref}>
              Continue with Google
            </a>
            <p className="mt-4 text-xs text-[var(--c-text-faint)]">
              If it doesn't let you in, ping the GM or whoever manages access.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
