/**
 * Cloudflare Worker — REDCap proxy for the ePSA estate.
 *
 * CANONICAL COPY. A byte-different Worker of the same name
 * ("epsa-redcap-proxy") also lived in the epsa-screening-tool repo. Both were
 * deployed to the same account, so whichever shipped last silently replaced
 * the other — and only one of them had rate limiting. That duplicate is gone;
 * this file is the only source for this Worker.
 *
 * AUTHENTICATION
 * Every route requires a Mount Sinai Entra (MSAL) ID token. Previously
 * `POST /` — which writes records into the REDCap study database — had no
 * authentication at all: it was protected only by an Origin header check and
 * per-IP rate limiting. Origin is set by browsers and is trivially forged by
 * any non-browser client, so in practice anyone on the internet could inject
 * records into the study.
 *
 * `GET /records` previously used a static shared secret (DASHBOARD_SECRET)
 * that was never rotated. Both routes now verify a real user identity, and
 * that shared secret is gone.
 *
 * Deploy:
 *   wrangler deploy --config worker/wrangler.toml
 *
 * Secrets:
 *   wrangler secret put REDCAP_TOKEN    --config worker/wrangler.toml
 *   wrangler secret put REDCAP_API_URL  --config worker/wrangler.toml
 *
 * Vars (wrangler.toml):
 *   AZURE_CLIENT_ID, AZURE_TENANT_ID, ALLOWED_ORIGINS
 *
 * Optional KV binding for rate limiting:
 *   [[kv_namespaces]]
 *   binding = "RATE_LIMIT_KV"
 *
 * Routes:
 *   POST /          import one record into REDCap
 *   GET  /records   export all records (dashboard read-back)
 */

import { audit, recordIdentifiers } from './_audit.js';

// ---------------------------------------------------------------------------
// Mount Sinai Entra (MSAL) token verification.
// Kept identical to worker/turso-proxy.js and functions/_auth.js so all three
// enforce the same checks.
// ---------------------------------------------------------------------------

const jwksCache = {};

async function fetchJwks(tenantId) {
  const cached = jwksCache[tenantId];
  if (cached && cached.exp > Date.now()) return cached.keys;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
  );
  if (!res.ok) throw new Error('jwks_fetch_failed');
  const { keys } = await res.json();
  jwksCache[tenantId] = { keys, exp: Date.now() + 3_600_000 };
  return keys;
}

function b64url(s) {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

/**
 * Returns the decoded payload for a valid token, or null.
 * Verifies signature, audience, issuer and expiry — a token that merely looks
 * like a JWT is rejected at the signature check.
 */
async function verifyMsalToken(authHeader, env) {
  try {
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(b64url(parts[0]));
    const payload = JSON.parse(b64url(parts[1]));

    const tenantId = env.AZURE_TENANT_ID;

    // AZURE_CLIENT_ID is a comma-separated ALLOWLIST of accepted audiences,
    // not a single value. This Worker is called by two different apps — the
    // screening tool (POST /) and the admin dashboard (GET /records) — and if
    // they are separate Azure app registrations their tokens carry different
    // `aud` claims. A single-value check would silently reject one of them.
    //
    // Still strict: exact GUID matches only, no wildcards or prefixes.
    const allowedAudiences = (env.AZURE_CLIENT_ID || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
    if (!tenantId || allowedAudiences.length === 0) return null;

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!allowedAudiences.includes(payload.aud)) return null;

    const validIssuers = [
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`,
    ];
    if (!validIssuers.includes(payload.iss)) return null;

    const keys = await fetchJwks(tenantId);
    const jwk = keys.find((k) => k.kid === header.kid && k.use === 'sig');
    if (!jwk) return null;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify'],
    );

    const sigBytes = Uint8Array.from(b64url(parts[2]), (c) => c.charCodeAt(0));
    const dataBytes = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    return (await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, dataBytes,
    )) ? payload : null;
  } catch {
    return null;
  }
}

/** Sliding-window rate limiter backed by KV. True = block. */
async function isRateLimited(kv, key, limitPerMinute = 20) {
  if (!kv) return false; // KV not bound — limiter is a no-op.
  const now = Date.now();
  const windowStart = now - 60_000;
  const raw = await kv.get(key, { type: 'json' });
  const stamps = Array.isArray(raw) ? raw.filter((t) => t > windowStart) : [];
  if (stamps.length >= limitPerMinute) return true;
  stamps.push(now);
  await kv.put(key, JSON.stringify(stamps), { expirationTtl: 90 });
  return false;
}

// ---------------------------------------------------------------------------

async function callRedcap(env, params) {
  return fetch(env.REDCAP_API_URL, {
    method: 'POST',
    body: params,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // ALLOWED_ORIGINS (comma-separated) is preferred; ALLOWED_ORIGIN is the
    // older single-value name, still honoured so a deploy cannot silently
    // lose the allowlist.
    const allowedList = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const originAllowed = allowedList.length === 0 || allowedList.includes(origin);

    const cors = {
      'Access-Control-Allow-Origin': originAllowed && origin ? origin : (allowedList[0] || '*'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
    };

    const json = (data, status) => new Response(JSON.stringify(data), {
      status, headers: { ...cors, 'Content-Type': 'application/json' },
    });

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Defence in depth only. This is NOT the access control — the token check
    // below is. An Origin header means nothing outside a browser.
    if (allowedList.length > 0 && origin && !originAllowed) {
      return json({ error: 'Forbidden origin' }, 403);
    }

    // ── Authentication — applies to every route ──────────────────────────
    const user = await verifyMsalToken(request.headers.get('Authorization'), env);
    if (!user) {
      // Rejected attempts are the entries an investigation cares about most.
      audit(null, 'auth.denied', {
        path: new URL(request.url).pathname,
        method: request.method,
        ok: false,
      });
      return json({ error: 'Unauthorized' }, 401);
    }

    // Rate limit per authenticated identity rather than per IP: a whole clinic
    // can share one egress address, and an identity is the thing we actually
    // want to bound.
    const rlKey = `rl:${user.oid || user.sub || 'unknown'}`;
    if (await isRateLimited(env.RATE_LIMIT_KV, rlKey, 30)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests — please wait a moment' }),
        { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'Retry-After': '60' } },
      );
    }

    if (!env.REDCAP_TOKEN || !env.REDCAP_API_URL) {
      return json({ error: 'REDCap not configured on server' }, 503);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // ── GET /records — dashboard read-back ───────────────────────────────
    if (request.method === 'GET' && path === '/records') {
      const params = new URLSearchParams({
        token: env.REDCAP_TOKEN,
        content: 'record',
        action: 'export',
        format: 'json',
        type: 'flat',
        rawOrLabel: 'label',
        exportSurveyFields: 'false',
        exportDataAccessGroups: 'false',
      });

      let res;
      try {
        res = await callRedcap(env, params);
      } catch (err) {
        return json({ error: 'Could not reach REDCap', detail: err?.message }, 502);
      }

      const text = await res.text();
      if (!res.ok) {
        return json({
          error: `REDCap returned HTTP ${res.status}`,
          detail: text.slice(0, 200),
        }, 502);
      }

      audit(user, 'redcap.export', { ok: true, bytes: text.length });
      return new Response(text, {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // ── POST / — import one record ───────────────────────────────────────
    if (request.method !== 'POST' || path !== '/') {
      return json({ error: 'Not found' }, 404);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const record = body?.record;
    if (!record || typeof record !== 'object') {
      return json({ error: 'Missing record payload' }, 400);
    }

    const params = new URLSearchParams({
      token: env.REDCAP_TOKEN,
      content: 'record',
      action: 'import',
      format: 'json',
      type: 'flat',
      data: JSON.stringify([record]),
      returnContent: 'ids',
      overwriteBehavior: 'normal',
    });

    let res;
    try {
      res = await callRedcap(env, params);
    } catch (err) {
      // Status and shape only. The previous version logged the full REDCap
      // request and response bodies, which put study record content into
      // Cloudflare's logs where it does not belong.
      console.error('REDCap import: network error', err?.message);
      return json({ error: 'Could not reach REDCap — check REDCAP_API_URL' }, 502);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location') || '(unknown)';
      console.error('REDCap import: URL redirects');
      return json({
        error: 'REDCAP_API_URL redirects — use the final URL directly',
        location,
      }, 502);
    }

    const text = await res.text();
    if (!res.ok) {
      console.error('REDCap import: HTTP', res.status);
      return json({
        error: `REDCap returned HTTP ${res.status}`,
        detail: text.slice(0, 200),
      }, 502);
    }

    if (text.startsWith('{"error"') || text.toLowerCase().includes('"error"')) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      audit(user, 'redcap.import', { ...recordIdentifiers(record), ok: false, reason: 'rejected' });
      return json({ error: 'REDCap rejected the record', detail: parsed?.error ?? text }, 422);
    }

    audit(user, 'redcap.import', { ...recordIdentifiers(record), ok: true });
    return json({ success: true, redcap: text }, 200);
  },
};
