# Google OAuth Onboarding

This document explains how to prepare Google OAuth for this repository's current auth architecture:

- `frontend` stays a SPA
- `backend` owns Google OAuth and session cookies
- public `/api/v1/*` requests are proxied to `backend`

Status:

- The backend user store and role bootstrap are already in place.
- Google OAuth endpoints are planned but not fully implemented yet.
- You can use this guide now to prepare the Google Cloud side and secrets ahead of that implementation.

## Auth Architecture Assumption

Use the public app origin as the OAuth callback origin, not the raw backend container port.

Recommended callback path:

- `/api/v1/auth/google/callback`

Recommended login start path:

- `/api/v1/auth/google/login`

Why:

- In local development, the frontend dev server already proxies `/api/v1/*` to the backend.
- In production, Caddy already proxies `/api/v1/*` to the backend.
- Using the public app origin keeps cookies same-origin from the browser's perspective.

## Google Cloud Setup

### 1. Create or choose a Google Cloud project

Use a dedicated project for this app if possible. That keeps OAuth credentials isolated from unrelated workloads.

### 2. Configure the Google Auth platform

In Google Cloud Console:

1. Open `Google Auth platform`.
2. Configure `Branding`.
3. Configure `Audience`.
4. Configure `Data Access`.

Notes:

- If the app is only for accounts inside one Google Workspace organization, `Internal` may be enough.
- If players use personal Gmail accounts or accounts outside one Workspace org, use `External`.
- If the app is `External` and still in testing mode, every allowed tester must also be added as a Google test user until the app is published.

### 3. Branding values

Fill at least:

- App name
- User support email
- Developer contact email
- App logo and privacy policy only if you want a more polished consent screen now

This app only needs identity login, not broad Google API access, so branding can stay minimal at first.

### 4. Data access / scopes

Request only these scopes for login:

- `openid`
- `email`
- `profile`

These are sufficient for:

- stable Google subject (`sub`)
- verified email address
- basic profile name/avatar if desired

Do not request broader Google API scopes unless the app actually needs them.

## Create OAuth Client Credentials

Create an OAuth client of type `Web application`.

For this architecture, the critical value is the redirect URI.

### Authorized redirect URIs

Recommended local redirect URI:

- `http://localhost:3000/api/v1/auth/google/callback`

Recommended production redirect URI:

- `https://<your-domain>/api/v1/auth/google/callback`

Rules that matter:

- The redirect URI must match exactly.
- Scheme matters: `http` vs `https`.
- Host matters: `localhost` is not the same as `127.0.0.1`.
- Path matters.
- Trailing slash differences can break the flow.

### Authorized JavaScript origins

For a backend-owned web-server OAuth flow, these are typically not required.

If you add them anyway, keep them aligned with your public app origins:

- `http://localhost:3000`
- `https://<your-domain>`

## Repo Configuration

These values should be set once backend OAuth is wired up:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `AUTH_BASE_URL`
- `AUTH_COOKIE_SECRET`
- `AUTH_DATABASE_URL`
- `AUTH_BOOTSTRAP_ADMIN_EMAILS`
- `AUTH_BOOTSTRAP_GAMEMASTER_EMAILS`
- `AUTH_BOOTSTRAP_PLAYER_EMAILS`
- `AUTH_ENABLE_DEV_LOGIN` (optional, local automation only)

### Recommended values

Local development:

```env
AUTH_BASE_URL=http://localhost:3000
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_COOKIE_SECRET=replace-with-long-random-value
AUTH_DATABASE_URL=sqlite:///app/data/auth.db?mode=rwc
AUTH_BOOTSTRAP_ADMIN_EMAILS=gm@example.com
AUTH_BOOTSTRAP_GAMEMASTER_EMAILS=gm@example.com
AUTH_BOOTSTRAP_PLAYER_EMAILS=alice@example.com,bob@example.com
```

Production:

```env
AUTH_BASE_URL=https://<your-domain>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_COOKIE_SECRET=replace-with-long-random-value
AUTH_DATABASE_URL=sqlite:///app/data/auth.db?mode=rwc
AUTH_BOOTSTRAP_ADMIN_EMAILS=gm@example.com
AUTH_BOOTSTRAP_GAMEMASTER_EMAILS=gm@example.com
AUTH_BOOTSTRAP_PLAYER_EMAILS=alice@example.com,bob@example.com
```

Notes:

- `AUTH_BASE_URL` should be the public origin users visit in the browser.
- Do not point `AUTH_BASE_URL` at `http://auth:8787`.
- Do not commit real Google client secrets.
- `AUTH_ENABLE_DEV_LOGIN=true` is only for local Playwright or multi-client automation. Leave it disabled in production.

## Local Development Checklist

1. Add the local redirect URI in the Google OAuth client.
2. Put Google client credentials into `backend/.env` or `infrastructure/.env`, depending on how you run the app.
3. Set `AUTH_BASE_URL=http://localhost:3000`.
4. Start the frontend and backend normally.
5. Start login from the SPA using the proxied backend auth route.

## Production Checklist

1. Make sure your public domain is live and proxies `/api/v1/*` to backend.
2. Add the exact production redirect URI in the Google OAuth client.
3. Set production secrets in deployment env:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `AUTH_BASE_URL`
   - `AUTH_COOKIE_SECRET`
4. Seed at least one bootstrap admin and gamemaster email.
5. Verify the login flow with one bootstrap admin before inviting other users.

## Common Failure Modes

### `redirect_uri_mismatch`

Usually caused by one of these:

- callback URI in code does not exactly match the Google client config
- using `127.0.0.1` in one place and `localhost` in another
- missing `https` in production
- wrong path, especially if the final route becomes `/api/v1/auth/google/callback`

### App visible only to test users

If the Google app is `External` and not published, only configured Google test users can log in.

That is separate from this app's own allowlist. A user may need to be:

- a Google test user
- present in this app's bootstrap or stored user table

### Wrong audience type

If you choose `Internal`, only users in that Google Workspace organization can log in.

That is usually wrong if players use personal Gmail accounts.

### Cookie domain/origin confusion

If the backend sets cookies for a different origin than the browser is using, the login flow will appear to succeed but the SPA will behave as logged out.

Use the public app origin as `AUTH_BASE_URL`.

## Role Seeding Notes

Current bootstrap env behavior is additive:

- admin bootstrap promotes to admin, but does not demote existing admins
- gamemaster bootstrap promotes to gamemaster, but does not demote existing gamemasters
- bootstrap users are reactivated if they already exist

Suggested starting model:

- The gamemaster is both:
  - platform admin
  - game role `gamemaster`
- Players are:
  - platform users
  - game role `player`

## References

- Google OAuth web server flow: [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- Google consent screen setup: [Configure the OAuth consent screen and choose scopes](https://developers.google.com/workspace/guides/configure-oauth-consent)
- Google Sign-In / OpenID Connect overview: [OpenID Connect](https://developers.google.com/accounts/docs/OAuth2Login)
