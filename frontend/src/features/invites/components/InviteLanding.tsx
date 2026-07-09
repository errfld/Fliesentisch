import { Link } from "@tanstack/react-router";
import { buildGoogleLoginUrl } from "@/features/auth/lib/auth-api";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";
import type { SessionUser } from "@/features/auth/types";
import { useInviteRedemption } from "@/features/invites/hooks/useInvites";
import type { InviteStatus, PublicInvite, RedeemedInvite } from "@/features/invites/types";

export function InviteLanding({ token, callbackError }: { token: string; callbackError?: string }) {
  const auth = useAuthSession();
  const redemption = useInviteRedemption(token, auth.session.authenticated);
  return (
    <InviteLandingView
      authError={auth.error}
      callbackError={callbackError}
      invite={redemption.invite}
      inviteError={redemption.error}
      loading={auth.isLoading || redemption.isLoading}
      redeeming={redemption.isRedeeming}
      redeemed={redemption.redeemed}
      token={token}
      user={auth.session.user}
    />
  );
}

export function InviteLandingView({
  authError,
  callbackError,
  invite,
  inviteError,
  loading,
  redeeming,
  redeemed,
  token,
  user
}: {
  authError?: string | null;
  callbackError?: string;
  invite: PublicInvite | null;
  inviteError?: string | null;
  loading: boolean;
  redeeming: boolean;
  redeemed: RedeemedInvite | null;
  token: string;
  user?: SessionUser;
}) {
  const status = callbackError ? callbackStatus(callbackError) : invite?.status;
  const failure = authError ?? inviteError;
  const loginPath = `/invite/${encodeURIComponent(token)}`;

  return (
    <main className="relative flex min-h-screen items-center overflow-hidden bg-[var(--c-void)] px-6 py-12">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,rgba(182,137,69,0.18),transparent_32%),linear-gradient(115deg,transparent_48%,rgba(255,255,255,0.025)_49%,transparent_50%)]" />
      <section className="relative mx-auto w-full max-w-2xl border border-[var(--c-rule)] bg-[linear-gradient(145deg,rgba(20,26,31,0.98),rgba(7,8,10,0.98))] p-7 shadow-[0_28px_100px_rgba(0,0,0,0.55)] md:p-10">
        <div className="border-b border-dashed border-[var(--c-rule)] pb-7">
          <p className="text-[9px] uppercase tracking-[0.22em] text-[var(--c-gold)]">Bearer invitation · player seat</p>
          <h1 className="display-face mt-4 text-4xl text-[var(--c-text-warm)]">A place is set for you</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--c-text-dim)]">
            This seal opens one campaign table. Sign in with the Google account you want attached to the seat.
          </p>
        </div>

        {loading ? <InviteMessage eyebrow="Checking the seal" title="Reading the invitation..." /> : null}
        {!loading && redeemed ? (
          <div className="mt-8" data-testid="invite-success">
            <InviteMessage eyebrow="Seat confirmed" title={`Welcome to ${redeemed.campaign_display_name}`} />
            <p className="mt-3 text-sm text-[var(--c-text-dim)]">Your account has player access to this campaign.</p>
            <Link
              className="chip mt-7 w-full justify-center py-3 text-xs"
              params={{ room: redeemed.room_slug }}
              search={{ name: fallbackName(user) }}
              to="/room/$room"
            >
              Enter {redeemed.campaign_display_name}
            </Link>
          </div>
        ) : null}
        {!loading && !redeemed && redeeming ? <InviteMessage eyebrow="Accepting" title="Adding your player seat..." /> : null}
        {!loading && !redeemed && !redeeming && failure ? (
          <InviteMessage eyebrow="The seal did not open" title={failure} tone="error" />
        ) : null}
        {!loading && !redeemed && !redeeming && !failure && !user && status === "ACTIVE" && invite ? (
          <div className="mt-8" data-testid="invite-sign-in">
            <InviteMessage eyebrow="Invitation verified" title={invite.campaign_display_name} />
            <p className="mt-3 text-sm text-[var(--c-text-dim)]">{expiryCopy(invite.expires_at)}</p>
            <a className="chip mt-7 w-full justify-center py-3 text-xs" href={buildGoogleLoginUrl(loginPath)}>
              Continue with Google
            </a>
          </div>
        ) : null}
        {!loading && !redeemed && !redeeming && !failure && !user && status && status !== "ACTIVE" ? (
          <InviteMessage eyebrow="Invitation unavailable" title={statusMessage(status)} tone="error" />
        ) : null}
        <div className="mt-9 flex items-center justify-between gap-4 border-t border-[var(--c-rule)] pt-5 text-[10px] text-[var(--c-text-faint)]">
          <span className="font-mono">seal {token.slice(0, 8)}…</span>
          <Link className="act" to="/">Return home</Link>
        </div>
      </section>
    </main>
  );
}

function InviteMessage({ eyebrow, title, tone = "normal" }: { eyebrow: string; title: string; tone?: "normal" | "error" }) {
  return (
    <div className="mt-8">
      <p className={`text-[9px] uppercase tracking-[0.18em] ${tone === "error" ? "text-[var(--c-ember)]" : "text-[var(--c-emerald)]"}`}>{eyebrow}</p>
      <h2 className={`display-face mt-3 text-2xl ${tone === "error" ? "text-[var(--c-ember)]" : "text-[var(--c-text-warm)]"}`}>{title}</h2>
    </div>
  );
}

function callbackStatus(value: string): InviteStatus | undefined {
  const statuses: Record<string, InviteStatus> = {
    revoked: "REVOKED",
    expired: "EXPIRED",
    exhausted: "EXHAUSTED",
    archived: "ARCHIVED"
  };
  return statuses[value];
}

function statusMessage(status: InviteStatus) {
  const messages: Record<InviteStatus, string> = {
    ACTIVE: "This invitation is ready.",
    REVOKED: "This invitation was revoked by its gamemaster.",
    EXPIRED: "This invitation has expired.",
    EXHAUSTED: "This invitation has already filled every available seat.",
    ARCHIVED: "This campaign is archived."
  };
  return messages[status];
}

function expiryCopy(expiresAt?: number) {
  return expiresAt ? `This invitation expires ${new Date(expiresAt * 1000).toLocaleString()}.` : "This invitation has no expiry.";
}

function fallbackName(user?: SessionUser) {
  return user?.display_name?.trim() || user?.email.split("@")[0] || "Player";
}
