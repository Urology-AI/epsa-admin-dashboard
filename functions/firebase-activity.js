/**
 * Cloudflare Pages Function — GET /firebase-activity?start=<ISO>&end=<ISO>&tz=<IANA>
 *
 * Daily usage of the ePSA calculator, read from Cloud Functions logs rather
 * than Firestore: the calculator's callables run on every visit, so the logs
 * show sessions even when nothing was saved under sessions/.
 *
 * Returns:
 *   calls     — invocation count per function
 *   hourly    — calculatePsaRecommendation calls bucketed by UTC hour (ISO)
 *   sessions  — one row per session id seen in syncToRedcap logs, with the
 *               anonymous user ids that touched it and first/last timestamps
 *   users     — distinct anonymous user ids seen
 *   locations — visitors by date/country/city from Google Analytics (GA4),
 *               or null when GA4_PROPERTY_ID isn't set
 *
 * Requires a valid Microsoft MSAL ID token in Authorization header.
 *
 * Server-side env vars:
 *   AZURE_CLIENT_ID, AZURE_TENANT_ID       — for MSAL token verification
 *   FIREBASE_SERVICE_ACCOUNT               — service account JSON; needs the
 *                                            Logs Viewer (roles/logging.viewer) role
 *   GA4_PROPERTY_ID                        — optional; numeric GA4 property id of the
 *                                            calculator. The service account email must
 *                                            be added as a Viewer on that property.
 */

import { verifyMsalToken, unauthorized } from './_auth.js';

const JSON_CT = { 'Content-Type': 'application/json' };
const MAX_RANGE_MS = 31 * 24 * 3600 * 1000;
const MAX_PAGES = 20;

const SESSION_RE = /user (\S+) .*\(session=([^)]+)\)/;

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return json({ error: 'Firebase service account not configured' }, 503);

  let sa;
  try { sa = JSON.parse(raw); } catch {
    return json({ error: 'Invalid FIREBASE_SERVICE_ACCOUNT JSON' }, 500);
  }

  const url   = new URL(request.url);
  const start = new Date(url.searchParams.get('start') || '');
  const end   = new Date(url.searchParams.get('end') || '');
  if (isNaN(start) || isNaN(end) || end <= start || end - start > MAX_RANGE_MS) {
    return json({ error: 'start and end must be ISO timestamps, at most 31 days apart' }, 400);
  }

  const tz = url.searchParams.get('tz') || 'UTC';

  let token;
  try { token = await getAccessToken(sa); } catch (err) {
    return json({ error: 'Failed to authenticate with Google', detail: err.message }, 502);
  }

  const filter = [
    'resource.type="cloud_function"',
    `timestamp>="${start.toISOString()}"`,
    `timestamp<"${end.toISOString()}"`,
    '(textPayload:"Function execution started" OR (resource.labels.function_name="syncToRedcap" AND textPayload:"session="))',
  ].join(' AND ');

  const calls    = {};
  const hourly   = {};
  const sessions = {};
  const users    = new Set();
  let pageToken;
  let truncated = false;

  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) { truncated = true; break; }
    const res = await fetch('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...JSON_CT },
      body: JSON.stringify({
        resourceNames: [`projects/${sa.project_id}`],
        filter,
        orderBy: 'timestamp asc',
        pageSize: 1000,
        pageToken,
      }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: 'Cloud Logging error', detail: data }, 502);

    for (const e of data.entries || []) {
      const fn   = e.resource?.labels?.function_name ?? 'unknown';
      const text = e.textPayload ?? '';
      const ts   = e.timestamp;

      if (text.startsWith('Function execution started')) {
        calls[fn] = (calls[fn] || 0) + 1;
        if (fn === 'calculatePsaRecommendation') {
          const hour = ts.slice(0, 13) + ':00:00Z';
          hourly[hour] = (hourly[hour] || 0) + 1;
        }
        continue;
      }

      const m = SESSION_RE.exec(text);
      if (!m) continue;
      const [, uid, sid] = m;
      users.add(uid);
      const s = sessions[sid] ??= { id: sid, users: [], first: ts, last: ts };
      if (!s.users.includes(uid)) s.users.push(uid);
      s.last = ts;
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  let locations = null;
  let locationsError = null;
  if (env.GA4_PROPERTY_ID) {
    try { locations = await fetchLocations(token, env.GA4_PROPERTY_ID, start, end, tz); }
    catch (err) { locationsError = err.message; }
  }

  return json({
    start: start.toISOString(),
    end:   end.toISOString(),
    calls,
    hourly,
    sessions: Object.values(sessions),
    users: [...users],
    truncated,
    locations,
    locationsError,
  });
}

// GA4 Data API: active users by date, country, city. GA4 dates are in the
// property's timezone and only day-granular, so the range is widened to whole
// days in the viewer's tz.
async function fetchLocations(token, propertyId, start, end, tz) {
  const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...JSON_CT },
    body: JSON.stringify({
      dateRanges: [{ startDate: day(start), endDate: day(new Date(end - 1)) }],
      dimensions: [{ name: 'date' }, { name: 'country' }, { name: 'city' }],
      metrics:    [{ name: 'activeUsers' }, { name: 'sessions' }],
      limit: 1000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || `GA4 HTTP ${res.status}`);
  return (data.rows || []).map((r) => {
    const [date, country, city] = r.dimensionValues.map((v) => v.value);
    return {
      date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      country,
      city,
      users:    Number(r.metricValues[0].value),
      sessions: Number(r.metricValues[1].value),
    };
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_CT });
}

// ── Google service-account → OAuth2 access token ─────────────────────────────

async function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);

  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/logging.read https://www.googleapis.com/auth/analytics.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  const b64url = (obj) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const unsigned = `${b64url(header)}.${b64url(payload)}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(unsigned)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${unsigned}.${sigB64}`;
}

async function getAccessToken(sa) {
  const jwt = await createJWT(sa);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'No access token returned');
  return data.access_token;
}
