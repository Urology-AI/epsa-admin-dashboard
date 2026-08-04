/**
 * Cloudflare Pages Function — POST /firebase-backfill-expiry
 *
 * One-time / idempotent migration: sets expiresAt = createdAt + 90 days
 * on every session document that is missing expiresAt.
 * Sessions that already have expiresAt are skipped (pass force=true to override).
 *
 * Returns { patched, skipped, errors } counts.
 */

import { verifyMsalToken, unauthorized } from './_auth.js';

const JSON_CT = { 'Content-Type': 'application/json' };
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestPost({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    return new Response(JSON.stringify({ error: 'Firebase service account not configured' }), {
      status: 503, headers: JSON_CT,
    });
  }

  let sa;
  try { sa = JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ error: 'Invalid FIREBASE_SERVICE_ACCOUNT JSON' }), {
      status: 500, headers: JSON_CT,
    });
  }

  const url   = new URL(request.url);
  const force = url.searchParams.get('force') === 'true'; // re-stamp even existing expiresAt

  let token;
  try { token = await getAccessToken(sa); } catch (err) {
    return new Response(JSON.stringify({ error: 'Google auth failed', detail: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }

  const projectId = sa.project_id;
  const baseUrl   = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  // Fetch all sessions (up to 500 per page — loop through pages)
  let patched = 0, skipped = 0, errors = 0;
  let pageToken = null;

  do {
    const fsUrl = `${baseUrl}/sessions?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const fsRes  = await fetch(fsUrl, { headers: { Authorization: `Bearer ${token}` } });
    const fsData = await fsRes.json();

    if (!fsRes.ok) {
      return new Response(JSON.stringify({ error: 'Firestore list error', detail: fsData }), {
        status: 502, headers: JSON_CT,
      });
    }

    pageToken = fsData.nextPageToken || null;

    for (const doc of (fsData.documents || [])) {
      const fields = doc.fields || {};

      // Skip if already has expiresAt and we're not forcing
      if (fields.expiresAt && !force) {
        skipped++;
        continue;
      }

      // Determine createdAt — use timestampValue if present, else fall back to now
      let createdMs = Date.now();
      if (fields.createdAt?.timestampValue) {
        createdMs = new Date(fields.createdAt.timestampValue).getTime();
      }

      const expiresAt = new Date(createdMs + NINETY_DAYS_MS).toISOString();

      // PATCH only the expiresAt field via Firestore REST
      const docPath = doc.name; // full resource path
      const patchUrl = `https://firestore.googleapis.com/v1/${docPath}?updateMask.fieldPaths=expiresAt`;
      const patchRes = await fetch(patchUrl, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            expiresAt: { timestampValue: expiresAt },
          },
        }),
      });

      if (patchRes.ok) {
        patched++;
      } else {
        errors++;
        console.error('patch failed for', docPath, await patchRes.text());
      }
    }
  } while (pageToken);

  return new Response(JSON.stringify({ patched, skipped, errors }), { status: 200, headers: JSON_CT });
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
