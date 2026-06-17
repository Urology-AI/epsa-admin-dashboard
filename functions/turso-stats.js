/**
 * Cloudflare Pages Function — GET /turso-stats
 *
 * Returns aggregate counts from clinical_sessions.
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

  try {
    const [total, pushed, week] = await Promise.all([
      tursoQuery(env, 'SELECT COUNT(*) AS n FROM clinical_sessions'),
      tursoQuery(env, "SELECT COUNT(*) AS n FROM clinical_sessions WHERE redcap_pushed_at IS NOT NULL AND redcap_pushed_at != ''"),
      tursoQuery(env, "SELECT COUNT(*) AS n FROM clinical_sessions WHERE created_at >= datetime('now', '-7 days')"),
    ]);

    return new Response(JSON.stringify({
      total:        total.rows[0].n,
      redcapPushed: pushed.rows[0].n,
      thisWeek:     week.rows[0].n,
    }), { status: 200, headers: JSON_CT });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }
}
