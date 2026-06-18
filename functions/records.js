/**
 * Cloudflare Pages Function — GET /records
 *
 * Fetches REDCap records via the epsa-redcap-proxy Worker.
 * Requires a valid Microsoft MSAL ID token in Authorization header.
 *
 * Server-side env vars:
 *   AZURE_CLIENT_ID, AZURE_TENANT_ID  — MSAL token verification
 *   DASHBOARD_SECRET                   — shared secret with epsa-redcap-proxy Worker
 *   REDCAP_PROXY_URL                   — proxy base URL (default: https://epsa-redcap-proxy.e-psa.workers.dev)
 */

import { verifyMsalToken, unauthorized } from './_auth.js';

const JSON_CT = { 'Content-Type': 'application/json' };
const PROXY_DEFAULT = 'https://epsa-redcap-proxy.e-psa.workers.dev';

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  const secret   = env.DASHBOARD_SECRET;
  const proxyUrl = (env.REDCAP_PROXY_URL || PROXY_DEFAULT).replace(/\/$/, '');

  if (!secret) {
    return new Response(JSON.stringify({ error: 'DASHBOARD_SECRET not configured' }), {
      status: 503, headers: JSON_CT,
    });
  }

  let res;
  try {
    res = await fetch(`${proxyUrl}/records`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not reach REDCap proxy', detail: err?.message }), {
      status: 502, headers: JSON_CT,
    });
  }

  const text = await res.text();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `REDCap proxy returned ${res.status}`, detail: text.slice(0, 200) }), {
      status: res.status, headers: JSON_CT,
    });
  }

  return new Response(text, { status: 200, headers: JSON_CT });
}
