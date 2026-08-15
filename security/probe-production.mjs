#!/usr/bin/env node
/**
 * Layer 3: probe the DEPLOYED admin dashboard.
 *
 * This dashboard is the highest-value target in the system. Its Pages
 * Functions hold a Firebase service account (full Admin SDK access — it
 * bypasses every Firestore and Storage rule), a Turso token, and a REDCap API
 * token. Every endpoint must refuse an unauthenticated caller, and none of
 * those credentials may appear in anything served to a browser.
 *
 * CI proves the committed code is correct. This proves the deployed thing is.
 *
 * Env:
 *   DASHBOARD_ORIGIN   default: https://epsa-admin.urology.edu.eu.org
 *   REDCAP_PROXY_URL   default: https://epsa-redcap-proxy.e-psa.workers.dev
 *   TURSO_PROXY_URL    default: https://epsa-turso-proxy.e-psa.workers.dev
 *
 * Exit: 0 all checks pass, 1 one or more FAILED, 2 could not run.
 */

// The custom domain is what staff actually load, so that is what the
// nightly probe checks. The pages.dev hostname still serves the same
// deployment; override DASHBOARD_ORIGIN to point at it or at a preview.
const ORIGIN = (process.env.DASHBOARD_ORIGIN || 'https://epsa-admin.urology.edu.eu.org')
  .replace(/\/$/, '');

// The Workers are part of the same trust boundary: they hold the REDCap and
// Turso credentials directly. A Pages Function that correctly refuses an
// anonymous caller proves nothing if the Worker behind it does not.
const REDCAP_PROXY = (process.env.REDCAP_PROXY_URL || 'https://epsa-redcap-proxy.e-psa.workers.dev')
  .replace(/\/$/, '');
const TURSO_PROXY = (process.env.TURSO_PROXY_URL || 'https://epsa-turso-proxy.e-psa.workers.dev')
  .replace(/\/$/, '');

let passed = 0;
let failed = 0;

const pass = (m) => { passed++; console.log(`  PASS  ${m}`); };
const fail = (m, d) => { failed++; console.log(`  FAIL  ${m}`); if (d) console.log(`        ${d}`); };

/**
 * Every Pages Function route the dashboard exposes, with the method each one
 * actually implements. The method matters: /firebase-backfill-expiry only
 * defines onRequestPost, so probing it with GET yields 405 and proves nothing.
 * It is safe to POST unauthenticated — verifyMsalToken() runs before the
 * function touches Firestore, which is precisely the property under test.
 */
const ENDPOINTS = [
  ['GET', '/feature-flags'],
  ['GET', '/records'],
  ['GET', '/testing-responses'],
  ['GET', '/turso-stats'],
  ['GET', '/turso-sessions?limit=1'],
  ['GET', '/firebase-sessions?limit=1'],
  ['POST', '/firebase-backfill-expiry'],
];

/**
 * A syntactically valid but unsigned JWT with plausible claims.
 * verifyMsalToken() must reject it at the signature check even though the
 * shape, audience field and expiry all look superficially right.
 */
function forgedToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', typ: 'JWT', kid: 'not-a-real-kid' });
  const payload = b64({
    aud: '00000000-0000-0000-0000-000000000000',
    iss: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0',
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: 'attacker@example.com',
    name: 'Not A Real Admin',
  });
  return `${header}.${payload}.${'A'.repeat(342)}`;
}

async function checkEndpointAuth() {
  console.log('\nPages Functions — every endpoint must refuse an unauthenticated caller');

  for (const [method, path] of ENDPOINTS) {
    const url = `${ORIGIN}${path}`;

    // 1. No Authorization header at all.
    let res;
    try {
      res = await fetch(url, { method });
    } catch (e) {
      fail(`${method} ${path} unreachable`, String(e.message));
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      pass(`${method} ${path} rejects anonymous (${res.status})`);
    } else if (res.status === 404) {
      fail(`${method} ${path} returned 404 — route missing or renamed; this probe is stale`);
      continue;
    } else if (res.ok) {
      const body = await res.text();
      fail(
        `${method} ${path} SERVED DATA to an unauthenticated caller (${res.status})`,
        body.slice(0, 200),
      );
      continue;
    } else {
      fail(`${method} ${path} unexpected status ${res.status} for anonymous request`);
      continue;
    }

    // 2. A forged, unsigned token. Catches a regression where verification is
    //    reduced to "is a Bearer token present" or the signature check is
    //    skipped — which would look identical to check 1 from the outside.
    const forged = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${forgedToken()}` },
    });

    if (forged.ok) {
      const body = await forged.text();
      fail(
        `${method} ${path} ACCEPTED a forged unsigned token (${forged.status})`,
        body.slice(0, 200),
      );
    } else if (forged.status === 401 || forged.status === 403) {
      pass(`${method} ${path} rejects a forged token (${forged.status})`);
    } else {
      fail(`${method} ${path} unexpected status ${forged.status} for forged token`);
    }
  }
}

/**
 * Both Workers must refuse every route without a verified Entra token.
 *
 * The REDCap proxy's POST / is the one that matters most: it writes records
 * into the study database and was, until recently, protected only by an Origin
 * header — which any non-browser client can set to anything.
 */
async function checkWorkerAuth() {
  console.log('\nWorkers — no route may be reachable without Entra auth');

  const routes = [
    [REDCAP_PROXY, 'POST', '/', 'redcap import'],
    [REDCAP_PROXY, 'GET', '/records', 'redcap export'],
    [TURSO_PROXY, 'GET', '/sessions', 'turso pull'],
    [TURSO_PROXY, 'POST', '/sessions/push', 'turso push'],
    [TURSO_PROXY, 'POST', '/sessions/delete', 'turso delete'],
  ];

  for (const [base, method, path, label] of routes) {
    const url = `${base}${path}`;
    const body = method === 'POST'
      ? { headers: { 'content-type': 'application/json' }, body: '{}' }
      : {};

    let res;
    try {
      res = await fetch(url, { method, ...body });
    } catch (e) {
      fail(`${label} (${method} ${path}) unreachable`, String(e.message));
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      pass(`${label} rejects anonymous (${res.status})`);
    } else if (res.ok) {
      fail(
        `${label} RESPONDED to an unauthenticated caller (${res.status})`,
        (await res.text()).slice(0, 160),
      );
      continue;
    } else if (res.status === 404) {
      fail(
        `${label} returned 404 — Worker not deployed, or the route was renamed`,
        `checked ${method} ${url}`,
      );
      continue;
    } else if (res.status === 400 || res.status === 422) {
      // The request got past authentication and was rejected by payload
      // validation instead. That is the signature of an unauthenticated
      // endpoint, not a protected one.
      fail(
        `${label} reached request VALIDATION without a token (${res.status}) — the route is unauthenticated`,
        `a protected route rejects with 401 before parsing the body`,
      );
      continue;
    } else {
      fail(`${label} unexpected status ${res.status} for anonymous request`);
      continue;
    }

    const forged = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${forgedToken()}`, ...(body.headers || {}) },
      ...(body.body ? { body: body.body } : {}),
    });
    if (forged.ok) {
      fail(`${label} ACCEPTED a forged unsigned token (${forged.status})`);
    } else if (forged.status === 401 || forged.status === 403) {
      pass(`${label} rejects a forged token (${forged.status})`);
    } else {
      fail(`${label} unexpected status ${forged.status} for forged token`);
    }
  }
}

/**
 * The Turso proxy's one public route, /public/session, is upload-only for the
 * patient-facing screening tool.
 *
 * This check deliberately sends an INVALID payload (no row.id). A valid one
 * would insert a row into the live clinical_sessions table — a probe must
 * never write to production. The 400 proves the route is reachable and
 * validating; the checks below prove it grants nothing beyond inserting.
 */
async function checkPublicUploadRoute() {
  console.log('\nTurso proxy — the public upload route must stay upload-only');

  const url = `${TURSO_PROXY}/public/session`;

  const bad = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ row: {} }),
  });
  if (bad.status === 400) pass('public upload rejects a payload with no row.id (400)');
  else if (bad.status === 404) fail('public upload route missing (404) — Worker not deployed?');
  else fail(`public upload returned ${bad.status} for an invalid payload; expected 400`);

  // It must expose no way to read, list or delete — only insert.
  for (const [method, path, label] of [
    ['GET', '/public/session', 'GET on the public route'],
    ['DELETE', '/public/session', 'DELETE on the public route'],
    ['GET', '/public/sessions', 'listing via the public route'],
  ]) {
    const res = await fetch(`${TURSO_PROXY}${path}`, { method });
    if (res.ok) fail(`${label} is permitted (${res.status}) — the route must be insert-only`);
    else pass(`${label} refused (${res.status})`);
  }
}

async function checkNoSecretsServed() {
  console.log('\nServed assets — no credential may reach the browser');

  let html;
  try {
    const res = await fetch(ORIGIN);
    if (!res.ok) {
      fail(`could not fetch ${ORIGIN} (${res.status})`);
      return;
    }
    html = await res.text();
  } catch (e) {
    fail(`could not fetch ${ORIGIN}`, String(e.message));
    return;
  }

  // Follow the built asset references and scan what is actually served, which
  // is the only copy that matters.
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (assets.length === 0) fail('no /assets/ references found in index.html — probe may be stale');

  const patterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY/, 'PEM private key'],
    [/"type"\s*:\s*"service_account"/, 'service account JSON'],
    [/private_key_id/, 'service account private_key_id'],
    [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'JWT (possible Turso token)'],
    [/libsql:\/\//, 'Turso database URL'],
    [/\b[0-9A-F]{32}\b/, 'REDCap-token-shaped hex string'],
  ];

  let clean = true;
  for (const asset of [ORIGIN, ...assets.map((a) => `${ORIGIN}${a}`)]) {
    let body;
    try {
      const r = await fetch(asset);
      if (!r.ok) continue;
      body = await r.text();
    } catch {
      continue;
    }
    for (const [re, label] of patterns) {
      if (re.test(body)) {
        fail(`${label} present in served asset`, asset);
        clean = false;
      }
    }
  }
  if (clean) pass(`no credential patterns in ${assets.length + 1} served asset(s)`);
}

async function checkHeaders() {
  console.log(`\nTransport — ${ORIGIN}`);

  let res;
  try {
    res = await fetch(ORIGIN, { redirect: 'follow' });
  } catch (e) {
    fail(`could not reach ${ORIGIN}`, String(e.message));
    return;
  }

  if (!res.url.startsWith('https://')) fail('did not end on HTTPS');
  else pass('served over HTTPS');

  const h = res.headers;
  const csp = h.get('content-security-policy') || '';
  const xfo = h.get('x-frame-options') || '';

  // An admin console must never be framable — see public/_headers.
  if (/frame-ancestors/.test(csp) || xfo) pass(`framing blocked (${xfo || 'CSP frame-ancestors'})`);
  else fail('no framing protection — the admin console can be clickjacked');

  if (h.get('x-content-type-options')) pass('nosniff present');
  else fail('X-Content-Type-Options missing');

  if (h.get('strict-transport-security')) pass('HSTS present');
  else fail('Strict-Transport-Security missing');

  if (h.get('referrer-policy')) pass('Referrer-Policy present');
  else fail('Referrer-Policy missing');
}

async function main() {
  console.log('ePSA admin dashboard production security probe');
  console.log(`origin: ${ORIGIN}`);
  console.log(`time:   ${new Date().toISOString()}`);

  await checkEndpointAuth();
  await checkWorkerAuth();
  await checkPublicUploadRoute();
  await checkNoSecretsServed();
  await checkHeaders();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nTHE DEPLOYED DASHBOARD FAILED ONE OR MORE CHECKS.');
    console.log('An endpoint serving data without auth exposes PHI via the Admin SDK.');
    process.exit(1);
  }
  console.log('Deployed dashboard passed all checks.');
}

main().catch((e) => {
  console.error('probe crashed:', e);
  process.exit(2);
});
