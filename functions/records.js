/**
 * Cloudflare Pages Function — GET /records
 *
 * Fetches REDCap records via the epsa-redcap-proxy Worker.
 * Requires a valid Microsoft MSAL ID token in Authorization header.
 *
 * Server-side env vars:
 *   AZURE_CLIENT_ID, AZURE_TENANT_ID  — MSAL token verification
 *   REDCAP_PROXY_URL                   — proxy base URL (default: https://epsa-redcap-proxy.e-psa.workers.dev)
 *
 * The caller's own Entra token is forwarded to the Worker rather than swapped
 * for a shared DASHBOARD_SECRET. The Worker then verifies a real user identity
 * instead of trusting "some service that knows the password", and there is no
 * long-lived static credential to leak or rotate.
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

  const proxyUrl = (env.REDCAP_PROXY_URL || PROXY_DEFAULT).replace(/\/$/, '');

  let res;
  try {
    res = await fetch(`${proxyUrl}/records`, {
      headers: { Authorization: request.headers.get('Authorization') },
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
