/**
 * Cloudflare Pages Function — GET/POST /feature-flags
 *
 * Reads and writes the appConfig/featureFlags document in Firestore via the
 * REST API using a Google service account. Requires a valid Microsoft MSAL ID
 * token in the Authorization header — only authenticated Mount Sinai admins
 * can read or write these flags (the ePSA app itself reads the same document
 * directly via the public "get" rule in firestore.rules, not through here).
 *
 * Server-side env vars:
 *   AZURE_CLIENT_ID, AZURE_TENANT_ID       — for MSAL token verification
 *   FIREBASE_SERVICE_ACCOUNT               — full service account JSON (one line)
 */

import { verifyMsalToken, unauthorized } from './_auth.js';

const JSON_CT = { 'Content-Type': 'application/json' };
const FEATURE_FLAGS_DOC = 'appConfig/featureFlags';

// Flags this endpoint knows how to publish, with their defaults.
const DEFAULT_FLAGS = {
  biomarkersEnabled: false,
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' },
  });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  const sa = getServiceAccount(env);
  if (sa instanceof Response) return sa;

  let token;
  try { token = await getAccessToken(sa); } catch (err) {
    return errorResponse('Failed to authenticate with Google', 502, err.message);
  }

  const fsRes = await fetch(docUrl(sa.project_id), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (fsRes.status === 404) {
    return new Response(JSON.stringify(DEFAULT_FLAGS), { status: 200, headers: JSON_CT });
  }

  const fsData = await fsRes.json();
  if (!fsRes.ok) {
    return errorResponse('Firestore error', 502, fsData);
  }

  return new Response(JSON.stringify({ ...DEFAULT_FLAGS, ...parseFields(fsData.fields || {}) }), {
    status: 200,
    headers: JSON_CT,
  });
}

export async function onRequestPost({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  let body;
  try { body = await request.json(); } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Only accept known boolean flags — reject anything else.
  const updates = {};
  for (const key of Object.keys(DEFAULT_FLAGS)) {
    if (key in body) {
      if (typeof body[key] !== 'boolean') {
        return errorResponse(`Flag "${key}" must be a boolean`, 400);
      }
      updates[key] = body[key];
    }
  }
  if (Object.keys(updates).length === 0) {
    return errorResponse('No recognized flags in request body', 400);
  }

  const sa = getServiceAccount(env);
  if (sa instanceof Response) return sa;

  let token;
  try { token = await getAccessToken(sa); } catch (err) {
    return errorResponse('Failed to authenticate with Google', 502, err.message);
  }

  // Merge with existing flags so a partial update doesn't clobber other fields.
  const currentRes = await fetch(docUrl(sa.project_id), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const current = currentRes.ok
    ? { ...DEFAULT_FLAGS, ...parseFields((await currentRes.json()).fields || {}) }
    : { ...DEFAULT_FLAGS };
  const merged = { ...current, ...updates };

  const writeUrl = `${docUrl(sa.project_id)}?${Object.keys(merged)
    .map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join('&')}`;

  const fsRes = await fetch(writeUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFields(merged) }),
  });
  const fsData = await fsRes.json();
  if (!fsRes.ok) {
    return errorResponse('Firestore write error', 502, fsData);
  }

  return new Response(JSON.stringify(merged), { status: 200, headers: JSON_CT });
}

// ── helpers ──────────────────────────────────────────────────────────────

function errorResponse(error, status, detail) {
  return new Response(JSON.stringify(detail ? { error, detail } : { error }), {
    status,
    headers: JSON_CT,
  });
}

function getServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return errorResponse('Firebase service account not configured', 503);
  try {
    return JSON.parse(raw);
  } catch {
    return errorResponse('Invalid FIREBASE_SERVICE_ACCOUNT JSON', 500);
  }
}

function docUrl(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${FEATURE_FLAGS_DOC}`;
}

function parseValue(v) {
  if (v.stringValue   !== undefined) return v.stringValue;
  if (v.integerValue  !== undefined) return Number(v.integerValue);
  if (v.doubleValue   !== undefined) return v.doubleValue;
  if (v.booleanValue  !== undefined) return v.booleanValue;
  if (v.nullValue     !== undefined) return null;
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

function toFieldValue(v) {
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v === null) return { nullValue: null };
  throw new Error(`Unsupported flag value type: ${typeof v}`);
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFieldValue(v);
  return fields;
}

// ── Google service-account → OAuth2 access token ─────────────────────────────

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
