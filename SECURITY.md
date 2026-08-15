# Security audit setup

This dashboard holds the most dangerous credentials in the system. Its Pages
Functions carry a **Firebase service account**, which uses the Admin SDK and
therefore **bypasses every Firestore and Storage rule**, plus a Turso token and
a REDCap API token. None of them may ever reach a browser.

| Layer | What runs | When | Catches |
|---|---|---|---|
| 1 | `.githooks/pre-push` | before a push leaves your machine | a secret about to become public |
| 2 | `.github/workflows/security.yml` | every PR and push to main | secrets in history, secrets in the bundle, server creds read from `src/` |
| 3 | `.github/workflows/security-nightly.yml` | 03:00 UTC daily | a deployed endpoint that stopped checking auth |
| 4 | manual / scheduled review | weekly | design-level issues no scanner sees |

## How this deploys

Cloudflare's own Git integrations deploy this repo — **Pages** for the dashboard
and its Functions, **Workers Builds** for `epsa-redcap-proxy`. Both trigger on
push to `main` and appear as checks on pull requests.

There is no GitHub Actions deploy step. `.github/workflows/deploy.yml` used to
run `wrangler deploy` and `wrangler pages deploy`, but `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` were never set, so it failed on every run from July
2026 onward while Cloudflare's integrations quietly did the real work. It was
removed rather than repaired: adding the secrets would have produced two
systems racing to deploy the same artifacts. A workflow that always fails also
trains everyone to ignore red CI, which is the opposite of what the rest of
this file is for.

Worker secrets are set out-of-band and never in CI:

```bash
wrangler secret put REDCAP_TOKEN   --config worker/wrangler.toml
wrangler secret put REDCAP_API_URL --config worker/wrangler.toml
```

## Setup

```bash
brew install gitleaks
git config core.hooksPath .githooks
```

## Running things locally

```bash
./security/check-vite-env.sh src .env.example      # browser-exposed creds
./security/check-server-secrets.sh src             # server creds read from src/
npm run build && ./security/scan-bundle.sh dist    # secrets in built output
node security/probe-production.mjs                 # probe the live deployment
```

The probe takes `DASHBOARD_ORIGIN` if you need to point it at a preview
deployment:

```bash
DASHBOARD_ORIGIN=https://abc123.epsa-admin-dashboard.pages.dev \
  node security/probe-production.mjs
```

## What the probe checks

For every Pages Function route it sends two requests: one with no
`Authorization` header, and one with a **syntactically valid but unsigned JWT**
carrying plausible `aud`, `iss`, and `exp` claims. Both must be rejected.

The forged-token case is the important one. A regression that reduced
`verifyMsalToken()` to "is a Bearer token present", or that skipped the
signature check, would look identical to a correct implementation if you only
ever tested the unauthenticated case.

## Things worth understanding

**`VITE_`-prefixed vars are inlined into the bundle** and are public from the
first build that includes them. They never appear in git, so no secret scanner
over history will find them. This repo shipped exactly that bug once —
`src/config/env.js` read `import.meta.env.VITE_TURSO_AUTH_TOKEN` (commit
`afad9344`, 2026-06-17) — which is why `check-vite-env.sh` exists and why
`security/vite-exposure-baseline.txt` is intentionally empty.

**Naming a credential is not leaking it.** The dashboard prints variable names
in error hints ("set `FIREBASE_SERVICE_ACCOUNT` as a Cloudflare Pages
environment variable"). `check-server-secrets.sh` matches env *access*
(`process.env.X`, `import.meta.env.X`, `env["X"]`), not any mention, so those
hints do not trip it.

**Headers come from `public/_headers`.** Vite copies `public/` to the root of
`dist/`, and Pages reads `_headers` from there. Before that file existed the
deployed console sent no framing protection at all — an admin UI backed by a
service account could be embedded and clickjacked.

## Credential rotation

If any of these is ever exposed, rotate it before doing anything else:

- **`FIREBASE_SERVICE_ACCOUNT`** — Google Cloud console → IAM → Service
  Accounts → delete and recreate the key. Highest priority: it bypasses all
  security rules.
- **`TURSO_AUTH_TOKEN`** — `turso db tokens revoke` then mint a new one.
- **`REDCAP_TOKEN`** — regenerate in REDCap; it is tied to a user's project
  rights and grants access to study data.
- **Cloudflare / Azure** — rotate in their respective dashboards.
