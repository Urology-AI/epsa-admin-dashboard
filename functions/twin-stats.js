/**
 * Cloudflare Pages Function — GET /twin-stats
 *
 * Aggregate counts from the Digital Twin's case_log (separate Turso DB).
 * Requires a valid Microsoft MSAL ID token in the Authorization header.
 *
 * Server-side env vars: AZURE_CLIENT_ID, AZURE_TENANT_ID,
 *   TWIN_TURSO_URL, TWIN_TURSO_AUTH_TOKEN
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

  if (!env.TWIN_TURSO_URL || !env.TWIN_TURSO_AUTH_TOKEN) {
    return new Response(JSON.stringify({ configured: false }), {
      status: 200, headers: JSON_CT,
    });
  }

  const db = { url: env.TWIN_TURSO_URL, token: env.TWIN_TURSO_AUTH_TOKEN };

  try {
    const [total, week, withPath] = await Promise.all([
      tursoQuery(env, 'SELECT COUNT(*) AS n FROM case_log', [], db),
      tursoQuery(env, "SELECT COUNT(*) AS n FROM case_log WHERE date >= date('now', '-7 days')", [], db),
      tursoQuery(env, 'SELECT COUNT(*) AS n FROM case_log WHERE path_gg IS NOT NULL AND path_gg != 0', [], db),
    ]);

    return new Response(JSON.stringify({
      configured:    true,
      total:         total.rows[0].n,
      thisWeek:      week.rows[0].n,
      withPathology: withPath.rows[0].n,
    }), { status: 200, headers: JSON_CT });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }
}
