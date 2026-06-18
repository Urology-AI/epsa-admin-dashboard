/**
 * GET /redcap-test
 * Diagnostic endpoint — tests REDCap connectivity and token validity.
 * Calls content=version (lightest possible REDCap API call).
 * Auth-gated same as /records.
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

  const result = {
    env: {
      REDCAP_API_URL: apiUrl ? `${apiUrl.slice(0, 30)}…` : '(not set)',
      REDCAP_TOKEN:   token  ? `${token.slice(0, 6)}…(${token.length} chars)` : '(not set)',
    },
    version: null,
    error: null,
    status: null,
    rawBody: null,
  };

  if (!token || !apiUrl) {
    result.error = 'REDCAP_TOKEN or REDCAP_API_URL not set in env';
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers: JSON_CT });
  }

  try {
    const res = await fetch(apiUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({ token, content: 'version' }),
    });

    result.status = res.status;
    const text = await res.text();
    result.rawBody = text.slice(0, 500);

    if (res.ok) {
      result.version = text.trim();
    } else {
      result.error = `HTTP ${res.status}`;
    }
  } catch (err) {
    result.error = err.message;
  }

  return new Response(JSON.stringify(result, null, 2), { status: 200, headers: JSON_CT });
}
