/**
 * Cloudflare Pages Function — GET /twin-cases
 *
 * Returns case_log rows from the Digital Twin (via the twin's own Worker) —
 * de-identified pre-operative planning cases with model predictions and, where
 * entered, surgical pathology outcomes.
 *
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

  const url   = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500);

  try {
    const rows = (await fetchTwinCaseLog(env)).slice(0, limit);

    const cases = rows.map((r) => {
      let _full = null;
      try { _full = JSON.parse(r.full_record); } catch { /* keep null */ }
      const { full_record, ...rest } = r;
      return { ...rest, _full };
    });

    return new Response(JSON.stringify({ configured: true, cases }), {
      status: 200, headers: JSON_CT,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502, headers: JSON_CT,
    });
  }
}
