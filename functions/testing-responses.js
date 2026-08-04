/**
 * Cloudflare Pages Function — /testing-responses
 *
 * GET  — list all physician responses to the ePSA test-case sequence.
 * POST — submit/update one physician's decision for one test case.
 *        Body: { caseId, decision, notes? }
 *        Document ID is `${caseId}_${physicianEmail}` so a resubmission overwrites.
 *
 * Requires a valid Microsoft MSAL ID token — only authenticated Mount Sinai users.
 *
 * Server-side env vars:
 *   AZURE_CLIENT_ID, AZURE_TENANT_ID       — for MSAL token verification
 *   FIREBASE_SERVICE_ACCOUNT               — full service account JSON (one line)
 */

import { verifyMsalToken, unauthorized } from './_auth.js';

const JSON_CT = { 'Content-Type': 'application/json' };
const COLLECTION = 'testCaseResponses';

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  const sa = await loadServiceAccount(env);
  if (sa.error) return sa.error;

  let token;
  try { token = await getAccessToken(sa.value); } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to authenticate with Google', detail: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }

  const fsUrl = `https://firestore.googleapis.com/v1/projects/${sa.value.project_id}/databases/(default)/documents/${COLLECTION}?pageSize=500`;
  const fsRes  = await fetch(fsUrl, { headers: { Authorization: `Bearer ${token}` } });
  const fsData = await fsRes.json();

  if (!fsRes.ok) {
    return new Response(JSON.stringify({ error: 'Firestore error', detail: fsData }), {
      status: 502, headers: JSON_CT,
    });
  }

  const responses = (fsData.documents || []).map(parseDoc);
  return new Response(JSON.stringify(responses), { status: 200, headers: JSON_CT });
}

export async function onRequestPost({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: JSON_CT });
  }

  const { caseId, decision, notes, engineScore, engineTier, engineRecommendPSA } = body || {};
  if (!caseId || !decision) {
    return new Response(JSON.stringify({ error: 'caseId and decision are required' }), { status: 400, headers: JSON_CT });
  }

  const sa = await loadServiceAccount(env);
  if (sa.error) return sa.error;

  let token;
  try { token = await getAccessToken(sa.value); } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to authenticate with Google', detail: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }

  const physicianEmail = user.preferred_username || user.email || user.upn || user.oid;
  const physicianName  = user.name || physicianEmail;
  const docId = `${caseId}_${physicianEmail}`;

  const fsUrl = `https://firestore.googleapis.com/v1/projects/${sa.value.project_id}/databases/(default)/documents/${COLLECTION}/${encodeURIComponent(docId)}`;
  const fsRes = await fetch(fsUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fields: {
        caseId:             { stringValue: caseId },
        decision:           { stringValue: decision },
        notes:              { stringValue: notes || '' },
        physicianEmail:     { stringValue: physicianEmail },
        physicianName:      { stringValue: physicianName },
        submittedAt:        { timestampValue: new Date().toISOString() },
        engineScore:        Number.isFinite(engineScore) ? { integerValue: String(Math.trunc(engineScore)) } : { nullValue: null },
        engineTier:         engineTier ? { stringValue: engineTier } : { nullValue: null },
        engineRecommendPSA: typeof engineRecommendPSA === 'boolean' ? { booleanValue: engineRecommendPSA } : { nullValue: null },
      },
    }),
  });
  const fsData = await fsRes.json();

  if (!fsRes.ok) {
    return new Response(JSON.stringify({ error: 'Firestore write error', detail: fsData }), {
      status: 502, headers: JSON_CT,
    });
  }

  return new Response(JSON.stringify(parseDoc(fsData)), { status: 200, headers: JSON_CT });
}

// ── helpers ───────────────────────────────────────────────────────────────

async function loadServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    return { error: new Response(JSON.stringify({ error: 'Firebase service account not configured' }), {
      status: 503, headers: JSON_CT,
    }) };
  }
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: new Response(JSON.stringify({ error: 'Invalid FIREBASE_SERVICE_ACCOUNT JSON' }), {
      status: 500, headers: JSON_CT,
    }) };
  }
}

function parseValue(v) {
  if (v.stringValue    !== undefined) return v.stringValue;
  if (v.integerValue   !== undefined) return Number(v.integerValue);
  if (v.doubleValue    !== undefined) return v.doubleValue;
  if (v.booleanValue   !== undefined) return v.booleanValue;
  if (v.nullValue      !== undefined) return null;
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
  const pemBody  = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const der      = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key      = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig      = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const sigB64   = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${unsigned}.${sigB64}`;
}

async function getAccessToken(sa) {
  const jwt = await createJWT(sa);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'No access token');
  return data.access_token;
}
