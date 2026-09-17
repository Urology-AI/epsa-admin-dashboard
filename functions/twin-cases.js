/**
 * Cloudflare Pages Function — GET /twin-cases
 *
 * Returns case_log rows from the Digital Twin's (separate) Turso database —
 * de-identified pre-operative planning cases with model predictions and, where
 * entered, surgical pathology outcomes.
 *
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
    // Not an error — the twin source is optional. The dashboard shows this
    // source as "not configured" rather than failed.
    return new Response(JSON.stringify({ configured: false, cases: [] }), {
      status: 200, headers: JSON_CT,
    });
  }

  const db = { url: env.TWIN_TURSO_URL, token: env.TWIN_TURSO_AUTH_TOKEN };
  const url   = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200', 10), 500);

  try {
    const { rows } = await tursoQuery(
      env,
      `SELECT id, date,
              age, psa, vol, psad, gg, cores, pirads, laterality,
              pred_ece, pred_svi, pred_upgrade, pred_psm, pred_bcr, pred_lni,
              ns_left, ns_right,
              path_gg, path_ece, path_svi, path_upgrade, path_psm, path_lni,
              full_record
       FROM case_log
       ORDER BY date DESC
       LIMIT ?`,
      [limit],
      db,
    );

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
