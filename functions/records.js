/**
 * Cloudflare Pages Function — GET /records
 *
 * Reads all records from REDCap and returns them as JSON.
 * REDCAP_TOKEN and REDCAP_API_URL are set as Pages environment variables
 * (server-side only — never shipped to the browser).
 *
 * No auth header required from the dashboard: the function is same-origin,
 * so only users who loaded the dashboard (i.e. passed MSAL) can call it.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const token  = env.REDCAP_TOKEN;
  const apiUrl = env.REDCAP_API_URL;

  if (!token || !apiUrl) {
    return new Response(JSON.stringify({ error: 'REDCap not configured on server' }), {
      status: 503, headers: CORS,
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
      method:  'POST',
      body:    params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      redirect: 'error',
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Could not reach REDCap', detail: err?.message }), {
      status: 502, headers: CORS,
    });
  }

  const text = await res.text();
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `REDCap returned ${res.status}`, detail: text.slice(0, 200) }), {
      status: 502, headers: CORS,
    });
  }

  return new Response(text, { status: 200, headers: CORS });
}
