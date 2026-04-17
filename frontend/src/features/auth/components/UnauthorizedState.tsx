import { Link } from "@tanstack/react-router";

type UnauthorizedStateProps = {
  detail?: string;
  reason?: string;
};

const REASON_COPY: Record<string, string> = {
  access_denied: "This Google account is not on the table allowlist.",
  email_not_verified: "Google returned an unverified email address for this account.",
  google_denied: "Google sign-in was cancelled before the table could create a session.",
  missing_code: "The Google callback did not include a valid authorization code.",
  missing_state: "The login attempt expired before it returned to the table.",
  missing_verifier: "The login verifier was missing when Google returned to the table.",
  oauth_exchange_failed: "Google sign-in failed while the backend exchanged the callback code.",
  state_mismatch: "The login response could not be matched to the original sign-in attempt."
};

export function UnauthorizedState({ detail, reason }: UnauthorizedStateProps) {
  const description = REASON_COPY[reason ?? ""] ?? "The table could not authorize this account.";

  return (
    <main className="flex min-h-screen items-center bg-[var(--c-void)] px-8 py-12">
      <section className="mx-auto w-full max-w-2xl border border-[var(--c-rule)] bg-[linear-gradient(180deg,rgba(20,26,31,0.96),rgba(8,9,11,0.96))] p-8 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
        <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">Access denied</p>
        <h1 className="display-face mt-3 text-4xl text-[var(--c-text-warm)]">The table stayed closed.</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-[var(--c-text-dim)]">{description}</p>
        {detail ? <p className="mt-3 text-sm text-[var(--c-ember)]">{detail}</p> : null}
        <div className="mt-8 flex flex-wrap gap-4">
          <a className="chip" href="/api/v1/auth/google/login?next=%2F">
            Try Google sign-in again
          </a>
          <Link className="act" to="/">
            Return home
          </Link>
        </div>
      </section>
    </main>
  );
}
