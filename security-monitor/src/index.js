/**
 * epsa-security-monitor — scheduled security checks for the Urology AI tools.
 *
 * Every 15 min  probe()  calls each protected API with NO credentials and
 *                        checks it refuses. Anything that answers is a finding.
 * Hourly        audit()  reads Cloudflare traffic logs, the Worker inventory and
 *                        Firebase Auth / rules / functions, and flags drift or
 *                        suspicious traffic.
 *
 * Findings go to SECURITY_KV and are shown in the admin dashboard Security tab.
 * A finding that keeps recurring is updated in place (lastSeen/count), and is
 * marked resolved when a later run no longer sees it.
 *
 * Nothing here writes to any monitored system: probes are unauthenticated
 * reads or requests the target must reject before touching data.
 */

const SINAI_V4_PREFIX = '146.203.'; // Mount Sinai 146.203.0.0/16

const KNOWN_WORKERS = new Set([
  'compass-spa-fallback', 'epsa-redcap-proxy', 'epsa-turso-proxy',
  'shim-copilot', 'symposium-smtp-relay', 'epsa-security-monitor',
]);

// Client admin callables were removed (e-psa-calculator#233); any admin-named
// function reappearing is flagged as unreviewed.
const KNOWN_FUNCTIONS = new Set(('calculatePsaRecommendation,cleanupAbandonedSessions,cleanupOldAuditLogs,cleanupOldSessions,createSession,deleteSession,deleteUserData,exportUserData,getSectionLocks,getSession,getUser,getUserSessions,lockSection,loginAnonymousBySessionId,npiProxy,optimizeDatabase,predictBiopsyRisk,submitRedcap,submitSinaiSession,submitToRedcap,syncToRedcap,updateSession,upsertConsent,validateClinicCode').split(','));

const TWIN = 'https://digital-twin.urology.edu.eu.org';
const DASH = 'https://epsa-admin.urology.edu.eu.org';
const FN   = 'https://us-central1-epsa-30d0b.cloudfunctions.net';
const JSON_POST = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Unauthenticated requests that must be refused. `ok` receives the status.
const PROBES = [
  { name: 'Twin: case_log read', url: `${TWIN}/api/turso/execute`, init: JSON_POST({ sql: 'SELECT * FROM case_log ORDER BY date DESC', args: [] }), ok: (s) => s === 401 },
  { name: 'Twin: schema write', url: `${TWIN}/api/turso/batch`, init: JSON_POST({ statements: [{ sql: 'alter table case_log add column zz_probe TEXT', args: [] }] }), ok: (s) => s === 401 },
  { name: 'Twin: case sync health', url: `${TWIN}/api/turso/health`, ok: (s) => s === 401 },
  { name: 'Twin: chat', url: `${TWIN}/api/chat`, init: JSON_POST({ messages: [] }), ok: (s) => s === 401 || s === 503 },
  { name: 'Twin: /clinical behind Access', url: `${TWIN}/clinical`, init: { redirect: 'manual' }, ok: (s, loc) => s === 302 && /cloudflareaccess\.com/.test(loc) },
  { name: 'Shim: behind Access', url: 'https://shim.urology.edu.eu.org/', init: { redirect: 'manual' }, ok: (s, loc) => s === 302 && /cloudflareaccess\.com/.test(loc) },
  // Same-account *.workers.dev can't be fetched from a Worker (error 1042), so
  // these go through service bindings — still no credentials attached.
  { name: 'REDCap proxy: records', binding: 'REDCAP_PROXY', url: 'https://epsa-redcap-proxy.e-psa.workers.dev/records', ok: (s) => s === 401 },
  { name: 'Screening proxy: sessions', binding: 'TURSO_PROXY', url: 'https://epsa-turso-proxy.e-psa.workers.dev/sessions', ok: (s) => s === 401 },
  { name: 'SMTP relay', binding: 'SMTP_RELAY', url: 'https://symposium-smtp-relay.e-psa.workers.dev/', init: JSON_POST({}), ok: (s) => s === 401 || s === 400 },
  ...['firebase-sessions', 'firebase-activity', 'twin-cases', 'twin-stats', 'records', 'turso-sessions', 'feature-flags', 'voice-servers', 'testing-responses']
    // An HTML 200 is the SPA fallback for a route not deployed yet, not data.
    .map((p) => ({ name: `Dashboard: /${p}`, url: `${DASH}/${p}`, ok: (s, _loc, type) => s === 401 || (s === 200 && type.startsWith('text/html')) })),
  { name: 'Deleted: compass-chat-proxy', url: 'https://compass-chat-proxy.e-psa.workers.dev/health', ok: (s) => s !== 200 },
  { name: 'Deleted: epsa-gemini-proxy', url: 'https://epsa-gemini-proxy.e-psa.workers.dev/health', ok: (s) => s !== 200 },
  { name: 'Firestore: anonymous list sessions', url: 'https://firestore.googleapis.com/v1/projects/epsa-30d0b/databases/(default)/documents/sessions?pageSize=1', ok: (s) => s === 403 || s === 401 },
  { name: 'Firestore: anonymous list users', url: 'https://firestore.googleapis.com/v1/projects/epsa-30d0b/databases/(default)/documents/users?pageSize=1', ok: (s) => s === 403 || s === 401 },
  { name: 'Functions: submitToRedcap unauthenticated', url: `${FN}/submitToRedcap`, init: JSON_POST({ data: {} }), ok: (s) => s === 401 },
  ...['adminListSinaiSessions', 'adminLogin', 'sendAdminOTP', 'getDecryptedPhone', 'exportSessionsCSV']
    .map((f) => ({ name: `Deleted function stays gone: ${f}`, url: `${FN}/${f}`, init: JSON_POST({ data: {} }), ok: (s) => s === 404 })),
  { name: 'Voice server: synthesis without sign-in', url: 'https://adidix99--voice-tts.modal.run/voice/audio', init: JSON_POST({ text: '.' }), timeoutMs: 60000, ok: (s) => s === 401 },
];

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(event.cron === '5 * * * *' ? run(env, 'audit', audit) : run(env, 'probe', probe));
  },

  // Manual trigger for testing: GET /run?job=probe|audit with the monitor token.
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get('Authorization') || '';
    if (!env.MONITOR_RUN_TOKEN || auth !== `Bearer ${env.MONITOR_RUN_TOKEN}`) {
      return new Response('Not found', { status: 404 });
    }
    const job = url.searchParams.get('job') === 'audit' ? 'audit' : 'probe';
    const result = await run(env, job, job === 'audit' ? audit : probe);
    return Response.json(result);
  },
};

// ── Runner / findings store ───────────────────────────────────────────────────

async function run(env, job, fn) {
  const started = new Date().toISOString();
  const seen = [];          // findings raised this run
  const checks = [];        // { name, ok, detail } for the status panel
  let error = null;
  try { await fn(env, { raise: (f) => seen.push(f), check: (c) => checks.push(c) }); }
  catch (err) { error = String(err?.message || err); seen.push({ id: `${job}:run-error`, severity: 'medium', title: `${job} run failed`, detail: error }); }

  const findings = (await env.SECURITY_KV.get('findings', 'json')) || [];
  const byId = new Map(findings.map((f) => [f.id, f]));
  for (const f of seen) {
    const prev = byId.get(f.id);
    if (prev) Object.assign(prev, f, { lastSeen: started, count: (prev.count || 1) + 1, resolvedAt: null });
    else byId.set(f.id, { ...f, source: job, firstSeen: started, lastSeen: started, count: 1, resolvedAt: null });
  }
  // Findings from this job that didn't recur are resolved. Traffic findings
  // are per-window events, so they resolve on their own too.
  const seenIds = new Set(seen.map((f) => f.id));
  for (const f of byId.values()) {
    if (f.source === job && !f.resolvedAt && !seenIds.has(f.id)) f.resolvedAt = started;
  }
  const kept = [...byId.values()]
    .sort((a, b) => (b.lastSeen > a.lastSeen ? 1 : -1))
    .slice(0, 400);
  await env.SECURITY_KV.put('findings', JSON.stringify(kept));
  await env.SECURITY_KV.put(`last:${job}`, JSON.stringify({ at: started, error, checks }));
  return { job, at: started, raised: seen.length, checks: checks.length, error };
}

// ── probe ─────────────────────────────────────────────────────────────────────

async function probe(env, { raise, check }) {
  await Promise.all(PROBES.map(async (p) => {
    let status = 0, loc = '', type = '';
    try {
      const target = p.binding ? env[p.binding] : globalThis;
      if (!target) { check({ name: p.name, ok: false, detail: `binding ${p.binding} missing` }); return; }
      const res = await target.fetch(p.url, { ...p.init, signal: AbortSignal.timeout(p.timeoutMs || 15000) });
      status = res.status;
      loc = res.headers.get('Location') || '';
      type = res.headers.get('Content-Type') || '';
    } catch (err) {
      // A deleted service being unreachable is the desired state; anything
      // else we couldn't test is shown as failing, never silently passed.
      const gone = p.name.startsWith('Deleted:');
      check({ name: p.name, ok: gone, detail: `unreachable (${err.name}: ${String(err.message).slice(0, 80)})` });
      return;
    }
    const ok = p.ok(status, loc, type);
    check({ name: p.name, ok, detail: `HTTP ${status}` });
    if (!ok) {
      raise({
        id: `probe:${p.name}`,
        severity: 'critical',
        title: `${p.name} answered without credentials`,
        detail: `${p.init?.method || 'GET'} ${p.url} returned HTTP ${status}${loc ? ` → ${loc}` : ''}. Expected it to be refused.`,
      });
    }
  }));
}

// ── audit ─────────────────────────────────────────────────────────────────────

async function audit(env, ctx) {
  const tasks = [];
  if (env.CF_API_TOKEN) tasks.push(auditWorkers(env, ctx), auditTraffic(env, ctx));
  else ctx.raise({ id: 'audit:no-cf-token', severity: 'medium', title: 'Cloudflare log audit not configured', detail: 'Set the CF_API_TOKEN secret on epsa-security-monitor.' });
  if (env.FIREBASE_SERVICE_ACCOUNT) tasks.push(auditFirebase(env, ctx));
  else ctx.raise({ id: 'audit:no-firebase', severity: 'medium', title: 'Firebase audit not configured', detail: 'Set the FIREBASE_SERVICE_ACCOUNT secret on epsa-security-monitor.' });
  await Promise.all(tasks);
}

async function cfApi(env, path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } });
  const data = await res.json();
  if (!data.success) throw new Error(`Cloudflare API ${path}: ${JSON.stringify(data.errors).slice(0, 200)}`);
  return data.result;
}

async function cfGraphql(env, query) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (data.errors?.length) throw new Error(`GraphQL: ${data.errors[0].message}`);
  return data.data;
}

async function auditWorkers(env, { raise, check }) {
  const scripts = await cfApi(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/scripts`);
  const unknown = scripts.map((s) => s.id).filter((id) => !KNOWN_WORKERS.has(id));
  check({ name: 'Cloudflare Worker inventory', ok: unknown.length === 0, detail: `${scripts.length} Workers` });
  for (const id of unknown) {
    raise({ id: `worker:unknown:${id}`, severity: 'high', title: `Unreviewed Worker deployed: ${id}`, detail: 'Not in the monitor allowlist. Confirm it is intended and gated, then add it to KNOWN_WORKERS.' });
  }

  const since = new Date(Date.now() - 65 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const d = await cfGraphql(env, `{ viewer { accounts(filter:{accountTag:"${env.CF_ACCOUNT_ID}"}) {
    workersInvocationsAdaptive(limit:100, filter:{datetime_geq:"${since}", datetime_lt:"${now}"}) { sum { requests errors } dimensions { scriptName } } } } }`);
  for (const g of d.viewer.accounts[0].workersInvocationsAdaptive) {
    const { requests, errors } = g.sum;
    if (errors >= 50 && errors / Math.max(requests, 1) > 0.2) {
      raise({ id: `worker:errors:${g.dimensions.scriptName}`, severity: 'medium', title: `Error spike on ${g.dimensions.scriptName}`, detail: `${errors} errors out of ${requests} invocations in the last hour.` });
    }
  }
}

async function auditTraffic(env, { raise, check }) {
  const since = new Date(Date.now() - 65 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const d = await cfGraphql(env, `{ viewer { zones(filter:{zoneTag:"${env.CF_ZONE_ID}"}) {
    httpRequestsAdaptiveGroups(limit:2000, filter:{datetime_geq:"${since}", datetime_lt:"${now}"}, orderBy:[count_DESC]) {
      count dimensions { clientRequestHTTPHost clientRequestPath clientRequestHTTPMethodName edgeResponseStatus clientIP clientCountryName userAgent } } } } }`);
  const rows = d.viewer.zones[0].httpRequestsAdaptiveGroups;
  const total = rows.reduce((n, r) => n + r.count, 0);
  check({ name: 'Cloudflare traffic log audit', ok: true, detail: `${total} requests in the last hour` });

  // Cloudflare's own egress (2a06:98c0::/29) is Workers calling other routes —
  // including this monitor's probes — not a person.
  const sinai = (ip) => ip.startsWith(SINAI_V4_PREFIX) || /^2a06:98c[0-7]:/i.test(ip);
  const denials = new Map();
  let scans = 0;
  for (const { count, dimensions: r } of rows) {
    const where = `${r.clientRequestHTTPMethodName} ${r.clientRequestHTTPHost}${r.clientRequestPath}`;
    const who = `${r.clientIP} (${r.clientCountryName}, ${r.userAgent.slice(0, 60) || 'no user agent'})`;
    const path = r.clientRequestPath;

    // Successful access to gated data routes from outside Mount Sinai.
    if (r.edgeResponseStatus === 200 && !sinai(r.clientIP)) {
      if (/^\/api\/turso\/(batch|health)/.test(path)) {
        raise({ id: `traffic:gated-200:${r.clientIP}:${path}`, severity: 'high', title: 'Gated case-sync route served outside Sinai', detail: `${count}× ${where} → 200 from ${who}. Should only succeed for signed-in clinicians; confirm this user.` });
      } else if (path === '/api/turso/execute') {
        raise({ id: `traffic:execute-200:${r.clientIP}`, severity: 'medium', title: 'Twin database read from outside Sinai', detail: `${count}× ${where} → 200 from ${who}. Patient share lookups are public; anything else needs a signed-in clinician.` });
      } else if (/^\/(records|firebase-|twin-|turso-|testing-responses|feature-flags|voice-servers|security-findings)/.test(path) && r.clientRequestHTTPHost.startsWith('epsa-admin')) {
        raise({ id: `traffic:dash-200:${r.clientIP}:${path}`, severity: 'medium', title: 'Dashboard data API used from outside Sinai', detail: `${count}× ${where} → 200 from ${who}. Fine if it is staff working remotely.` });
      }
    }

    // Many refusals on API routes from one address = credential or route probing.
    if ([401, 403, 429].includes(r.edgeResponseStatus) && /^\/(api\/|records|firebase-|twin-|turso-)/.test(path)) {
      denials.set(r.clientIP, (denials.get(r.clientIP) || { n: 0, who, paths: new Set() }));
      const e = denials.get(r.clientIP);
      e.n += count; e.paths.add(path);
    }

    if (/\.env|\.git\/|wp-|phpinfo|\.php$|actuator|\.sql|backup/i.test(path)) scans += count;
  }

  for (const [ip, e] of denials) {
    if (e.n >= 30 && !sinai(ip)) {
      raise({ id: `traffic:denials:${ip}`, severity: 'high', title: `Repeated refused API calls from ${ip}`, detail: `${e.n} refused requests in the last hour from ${e.who} on ${[...e.paths].slice(0, 6).join(', ')}. Consider a WAF block.` });
    }
  }
  if (scans >= 200) {
    raise({ id: 'traffic:scanner-volume', severity: 'low', title: 'High vulnerability-scanner volume', detail: `${scans} requests for .env / .git / WordPress / PHP paths in the last hour. None of these exist here; watch for any that return data.` });
  }
}

async function auditFirebase(env, { raise, check }) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await googleToken(sa, 'https://www.googleapis.com/auth/cloud-platform');
  const g = async (url) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`${url.split('?')[0]}: ${data.error?.message || res.status}`);
    return data;
  };
  const state = (await env.SECURITY_KV.get('state', 'json')) || {};

  // Auth providers: only anonymous (and phone, used by consent) are expected.
  const cfg = await g(`https://identitytoolkit.googleapis.com/admin/v2/projects/${sa.project_id}/config`);
  const emailOn = cfg.signIn?.email?.enabled === true;
  check({ name: 'Firebase: Email/Password sign-in disabled', ok: !emailOn, detail: emailOn ? 'ENABLED' : 'disabled' });
  if (emailOn) raise({ id: 'firebase:email-signin', severity: 'critical', title: 'Firebase Email/Password sign-in was re-enabled', detail: 'Anyone can create accounts with the public API key. Disable it in Firebase Auth → Sign-in method.' });
  const testNumbers = Object.keys(cfg.signIn?.phoneNumber?.testPhoneNumbers || {});
  if (cfg.signIn?.phoneNumber?.enabled && testNumbers.length) {
    raise({ id: 'firebase:phone-test-numbers', severity: 'medium', title: 'Phone sign-in has fixed test numbers', detail: `${testNumbers.length} test phone numbers with fixed codes let anyone sign in as those numbers. Remove them in Firebase Auth → Sign-in method → Phone.` });
  }

  // Non-anonymous accounts: any new one is worth a look.
  let nonAnon = [];
  let pageToken = '';
  do {
    const r = await g(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:batchGet?maxResults=1000${pageToken ? `&nextPageToken=${pageToken}` : ''}`);
    for (const u of r.users || []) if (u.email || u.phoneNumber) nonAnon.push(u);
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  const known = new Set(state.knownAccounts || []);
  const fresh = nonAnon.filter((u) => !known.has(u.localId));
  check({ name: 'Firebase: non-anonymous accounts', ok: fresh.length === 0 || !state.knownAccounts, detail: `${nonAnon.length} accounts with email/phone` });
  if (state.knownAccounts) {
    for (const u of fresh) {
      const label = u.email ? u.email.replace(/^(.{2}).*@/, '$1***@') : `phone …${u.phoneNumber.slice(-4)}`;
      raise({ id: `firebase:new-account:${u.localId}`, severity: u.email && !u.emailVerified ? 'high' : 'medium', title: `New Firebase account: ${label}`, detail: `Created ${new Date(Number(u.createdAt)).toISOString()}${u.email ? `, email ${u.emailVerified ? 'verified' : 'NOT verified'}` : ''}. Confirm it belongs to the team.` });
    }
  }
  state.knownAccounts = nonAnon.map((u) => u.localId);

  // Security rules: must keep the verified-email admin check; flag any change.
  const releases = (await g(`https://firebaserules.googleapis.com/v1/projects/${sa.project_id}/releases`)).releases || [];
  for (const rel of releases) {
    const svc = rel.name.includes('firebase.storage') ? 'storage' : 'firestore';
    const src = (await g(`https://firebaserules.googleapis.com/v1/${rel.rulesetName}`)).source.files.map((f) => f.content).join('\n');
    const hash = await sha256(src);
    if (svc === 'firestore') {
      const hasVerified = /email_verified['"]?(,\s*false\))?\s*==\s*true/.test(src);
      check({ name: 'Firestore rules require verified admin email', ok: hasVerified, detail: hasVerified ? 'present' : 'MISSING' });
      if (!hasVerified) raise({ id: 'firebase:rules-unverified-admin', severity: 'critical', title: 'Firestore rules no longer require a verified admin email', detail: 'isSuperAdmin() must check request.auth.token.email_verified == true.' });
      if (/allow\s+read[^;]*:\s*if\s+true/.test(src.replace(/match \/appConfig[\s\S]*?\n    }/, ''))) {
        raise({ id: 'firebase:rules-public-read', severity: 'critical', title: 'Firestore rules contain a public read', detail: 'An `allow read: if true` outside appConfig was deployed.' });
      }
    }
    const key = `${svc}RulesHash`;
    if (state[key] && state[key] !== hash) {
      raise({ id: `firebase:rules-changed:${svc}:${hash.slice(0, 12)}`, severity: 'medium', title: `${svc === 'storage' ? 'Storage' : 'Firestore'} rules were redeployed`, detail: `Ruleset ${rel.rulesetName.split('/').pop()} (updated ${rel.updateTime}). Review the change.` });
    }
    state[key] = hash;
  }

  // App Check: both apps registered with an attestation provider, and
  // enforcement status on Firestore / Auth.
  const appBase = `https://firebaseappcheck.googleapis.com/v1/projects/${sa.project_id}/apps`;
  const webApp = '1:148985999968:web:2c49caf6875ca31f348905';
  const iosApp = '1:148985999968:ios:92cf8fd3928be0ae348905';
  const [recaptcha, attest, services] = await Promise.all([
    g(`${appBase}/${webApp}/recaptchaEnterpriseConfig`).catch(() => null),
    g(`${appBase}/${iosApp}/appAttestConfig`).catch(() => null),
    g(`https://firebaseappcheck.googleapis.com/v1/projects/${sa.project_id}/services`).catch(() => ({ services: [] })),
  ]);
  check({ name: 'App Check: web app uses reCAPTCHA Enterprise', ok: Boolean(recaptcha?.siteKey), detail: recaptcha?.siteKey ? 'registered' : 'NOT registered' });
  check({ name: 'App Check: iOS app uses App Attest', ok: Boolean(attest?.name), detail: attest?.name ? 'registered' : 'NOT registered' });
  if (!recaptcha?.siteKey || !attest?.name) {
    raise({ id: 'appcheck:unregistered', severity: 'high', title: 'An app is missing its App Check provider', detail: `Web reCAPTCHA Enterprise: ${recaptcha?.siteKey ? 'ok' : 'missing'}; iOS App Attest: ${attest?.name ? 'ok' : 'missing'}.` });
  }
  const enforced = new Map((services.services || []).map((sv) => [sv.name.split('/').pop(), sv.enforcementMode]));
  for (const svc of ['firestore.googleapis.com', 'identitytoolkit.googleapis.com']) {
    const mode = enforced.get(svc) || 'UNENFORCED';
    check({ name: `App Check enforcement: ${svc.split('.')[0]}`, ok: mode === 'ENFORCED', detail: mode });
    if (mode !== 'ENFORCED') {
      raise({ id: `appcheck:unenforced:${svc}`, severity: 'medium', title: `App Check not enforced on ${svc.split('.')[0]}`, detail: 'Requests that are not from the genuine web or iOS app are still accepted. Enforce once App Check metrics show legitimate traffic is verified.' });
    }
  }

  // Cloud Functions inventory.
  const fns = (await g(`https://cloudfunctions.googleapis.com/v1/projects/${sa.project_id}/locations/-/functions`)).functions || [];
  const names = fns.map((f) => f.name.split('/').pop());
  const unknownFns = names.filter((n) => !KNOWN_FUNCTIONS.has(n));
  check({ name: 'Firebase: Cloud Functions inventory', ok: unknownFns.length === 0, detail: `${names.length} functions` });
  for (const n of unknownFns) {
    raise({ id: `firebase:unknown-function:${n}`, severity: 'high', title: `Unreviewed Cloud Function deployed: ${n}`, detail: 'Not in the monitor allowlist. Check its auth, then add it to KNOWN_FUNCTIONS.' });
  }

  await env.SECURITY_KV.put('state', JSON.stringify(state));
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function googleToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----|\n/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'Google token failed');
  return data.access_token;
}
