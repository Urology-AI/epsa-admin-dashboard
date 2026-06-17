/**
 * Cloudflare Pages Function — GET /firebase-sessions
 *
 * Queries Firestore via the REST API using a Google service account.
 * The service account JSON is stored as a CF Pages env var (server-side only).
 *
 * Returns an array of plain session objects from the /sessions collection.
 *
 * CF Pages env var to set:
 *   FIREBASE_SERVICE_ACCOUNT  — the full service account JSON as a single-line string
 *     (Firebase console → Project settings → Service accounts → Generate new private key)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env, request }) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Firebase service account not configured' }), {
      status: 503, headers: CORS,
    });
  }

  let sa;
  try { sa = JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ error: 'Invalid FIREBASE_SERVICE_ACCOUNT JSON' }), {
      status: 500, headers: CORS,
    });
  }

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '200', 10);

  let token;
  try { token = await getAccessToken(sa); } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to authenticate with Google', detail: err.message }), {
      status: 502, headers: CORS,
    });
  }

  const fsUrl = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/sessions?pageSize=${limit}`;
  const fsRes = await fetch(fsUrl, { headers: { Authorization: `Bearer ${token}` } });
  const fsData = await fsRes.json();

  if (!fsRes.ok) {
    return new Response(JSON.stringify({ error: 'Firestore error', detail: fsData }), {
      status: 502, headers: CORS,
    });
  }

  const sessions = (fsData.documents || []).map(parseDoc);
  return new Response(JSON.stringify(sessions), { status: 200, headers: CORS });
}

// ── Firestore REST document parser ──────────────────────────────────────────

function parseValue(v) {
  if (v.stringValue  !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue  !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue    !== undefined) return null;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue)   return parseFields(v.mapValue.fields || {});
  if (v.arrayValue) return (v.arrayValue.values || []).map(parseValue);
  return null;
}

function parseFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = parseValue(v);
  return obj;
}

function parseDoc(doc) {
  return { id: doc.name.split('/').pop(), ...parseFields(doc.fields || {}) };
}

// ── Google service-account → OAuth2 access token ────────────────────────────

async function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);

  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  };

  const b64url = (obj) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const unsigned = `${b64url(header)}.${b64url(payload)}`;

  // Import RSA private key (PKCS#8 DER)
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
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'No access token returned');
  return data.access_token;
}
