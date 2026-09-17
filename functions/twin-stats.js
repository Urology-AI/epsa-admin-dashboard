/**
 * Cloudflare Pages Function — GET /twin-stats
 *
 * Aggregate counts from the Digital Twin's case_log (via the twin's Worker).
 * Requires a valid Microsoft MSAL ID token in the Authorization header.
 *
 * Server-side env vars: AZURE_CLIENT_ID, AZURE_TENANT_ID,
 *   TWIN_API_URL (optional, see _twin.js)
 */

import { verifyMsalToken, unauthorized } from './_auth.js';
import { fetchTwinCaseLog }              from './_twin.js';

const JSON_CT = { 'Content-Type': 'application/json' };

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  try {
    const rows = await fetchTwinCaseLog(env);
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    return new Response(JSON.stringify({
      configured:    true,
      total:         rows.length,
      thisWeek:      rows.filter((r) => r.date >= weekAgo).length,
      withPathology: rows.filter((r) => r.path_gg != null && Number(r.path_gg) !== 0).length,
    }), { status: 200, headers: JSON_CT });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }
}
