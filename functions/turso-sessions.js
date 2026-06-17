/**
 * Cloudflare Pages Function — GET /turso-sessions
 *
 * Returns clinical_sessions rows from Turso (the screening tool's DB).
 * Requires a valid Microsoft MSAL ID token in Authorization header.
 *
 * Server-side env vars: AZURE_CLIENT_ID, AZURE_TENANT_ID, TURSO_URL, TURSO_AUTH_TOKEN
 */

import { verifyMsalToken, unauthorized } from './_auth.js';
import { tursoQuery }                    from './_turso.js';

const JSON_CT = { 'Content-Type': 'application/json' };

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  if (!env.TURSO_URL || !env.TURSO_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: 'Turso not configured' }), {
      status: 503, headers: JSON_CT,
    });
  }

  const url   = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500);

  try {
    const { rows } = await tursoQuery(
      env,
      `SELECT id, session_ref, created_at, age, race, family_history,
              tier_key, tier_label, display_range,
              psa, pirads, redcap_pushed_at, full_record
       FROM clinical_sessions
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit]
    );

    // Parse full_record JSON inline so the browser doesn't have to
    const sessions = rows.map((r) => {
      let _full = null;
      try { _full = JSON.parse(r.full_record); } catch { /* keep null */ }
      return { ...r, _full };
    });

    return new Response(JSON.stringify(sessions), { status: 200, headers: JSON_CT });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }
}
