/**
 * Cloudflare Pages Function — GET /records
 *
 * Exports all REDCap records as JSON.
 * Requires a valid Microsoft MSAL ID token in Authorization header —
 * only authenticated Mount Sinai users can read REDCap data.
 *
 * Server-side env vars: AZURE_CLIENT_ID, AZURE_TENANT_ID, REDCAP_TOKEN, REDCAP_API_URL
 */

import { verifyMsalToken, unauthorized } from './_auth.js';

const JSON_CT = { 'Content-Type': 'application/json' };

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  const token  = env.REDCAP_TOKEN;
  const apiUrl = env.REDCAP_API_URL;

  if (!token || !apiUrl) {
    return new Response(JSON.stringify({ error: 'REDCap not configured on server' }), {
      status: 503, headers: JSON_CT,
    });
  }

  const params = new URLSearchParams({
    token,
    content:                'record',
    action:                 'export',
    format:                 'json',
    type:                   'flat',
    rawOrLabel:             'label',
    exportSurveyFields:     'false',
    exportDataAccessGroups: 'false',
  });

  let res;
  try {
    res = await fetch(apiUrl, {
      method:   'POST',
      body:     params,
      headers:  { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'error',
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not reach REDCap', detail: err?.message }), {
      status: 502, headers: JSON_CT,
    });
  }

  const text = await res.text();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `REDCap returned ${res.status}`, detail: text.slice(0, 200) }), {
      status: 502, headers: JSON_CT,
    });
  }

  return new Response(text, { status: 200, headers: JSON_CT });
}
