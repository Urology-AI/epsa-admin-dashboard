# ePSA Admin Dashboard

Unified research dashboard for the ePSA prostate cancer screening platform. Aggregates data from three sources in one place:

| Source | What it shows |
|--------|--------------|
| **Turso (screening)** | Community screening sessions from the mobile bus tool |
| **Digital Twin API** | De-identified pre-operative surgical-planning cases with model predictions and pathology outcomes (read through the twin's Worker) |
| **Firebase** | Full calculator sessions from the ePSA web app |
| **REDCap (Mount Sinai)** | Consented records pushed to the IRB study database |

Live at **[urology-ai.github.io/epsa-admin-dashboard](https://urology-ai.github.io/epsa-admin-dashboard/)**

Login requires a **Mount Sinai Microsoft account** (Azure AD SSO).

---

## Repos in this platform

| Repo | Role | URL |
|------|------|-----|
| [epsa-screening-tool](https://github.com/Urology-AI/epsa-screening-tool) | Mobile bus kiosk | Vercel |
| [e-psa-calculator](https://github.com/Urology-AI/e-psa-calculator) | Full clinical calculator | Firebase Hosting |
| **epsa-admin-dashboard** (this repo) | Unified admin dashboard | GitHub Pages |

---

## Local development

```bash
cp .env.example .env.local   # fill in values (see below)
npm install
npm run dev
```

The app runs at `http://localhost:5173`. MSAL redirect URIs must include `http://localhost:5173/` in your Azure app registration.

## Environment variables

Copy `.env.example` → `.env.local` and fill in:

| Variable | Where to get it |
|----------|-----------------|
| `VITE_AZURE_CLIENT_ID` | Azure → App registrations → your app → Application (client) ID |
| `VITE_AZURE_TENANT_ID` | Azure → App registrations → your app → Directory (tenant) ID |
| `VITE_TURSO_URL` | Turso dashboard or screening-tool `.env` |
| `VITE_TURSO_AUTH_TOKEN` | Turso dashboard or screening-tool `.env` |
| `TWIN_API_URL` | Optional. Digital twin origin whose Worker serves `/api/turso/execute`; defaults to `https://digital-twin.urology.edu.eu.org`. Runtime-only, not a `VITE_` var. |
| `TWIN_API_TOKEN` | Must match the twin Worker's `DASHBOARD_READ_TOKEN` secret. Runtime-only. |
| `VITE_REDCAP_PROXY_URL` | Deployed Cloudflare Worker URL |
| `VITE_DASHBOARD_SECRET` | Must match `wrangler secret put DASHBOARD_SECRET` on the worker |
| `VITE_FIREBASE_*` | Copy from e-psa-calculator frontend `.env` |

## Deployment (GitHub Pages)

Pushes to `main` trigger the [Deploy workflow](.github/workflows/deploy.yml) automatically. All `VITE_*` variables must be set as **repository secrets** in Settings → Secrets → Actions.

## Azure app registration (one-time setup)

1. [portal.azure.com](https://portal.azure.com) → Azure Active Directory → App registrations → **New registration**
2. Name: `ePSA Admin Dashboard`
3. Supported account types: *Accounts in this organizational directory only*
4. Redirect URIs (Web):
   - `https://urology-ai.github.io/epsa-admin-dashboard/`
   - `http://localhost:5173/` (for local dev)
5. Copy **Application (client) ID** and **Directory (tenant) ID** → secrets

## REDCap worker setup

The Cloudflare Worker (`epsa-screening-tool/worker/redcap-proxy.js`) must have a `DASHBOARD_SECRET` set:

```bash
cd epsa-screening-tool/worker
wrangler secret put DASHBOARD_SECRET   # enter the same value as VITE_DASHBOARD_SECRET
wrangler deploy
```

The dashboard calls `GET /records` on the worker with `Authorization: Bearer <DASHBOARD_SECRET>` to read back all REDCap records without exposing the REDCap API token to the browser.
