/**
 * Cloudflare Worker — REDCap proxy for ePSA Screening Tool.
 *
 * Deploy:
 *   wrangler deploy
 *
 * Secrets (set once, never in code):
 *   wrangler secret put REDCAP_TOKEN
 *   wrangler secret put REDCAP_API_URL   # e.g. https://redcap.mountsinai.org/api/
 *   wrangler secret put ALLOWED_ORIGIN   # e.g. https://urology-ai.github.io
 *   wrangler secret put DASHBOARD_SECRET # arbitrary secret for dashboard read-back
 *
 * Routes:
 *   POST /          – import one record into REDCap (screening tool → REDCap)
 *   GET  /records   – export all records from REDCap (dashboard read-back)
 *                     Requires:  Authorization: Bearer <DASHBOARD_SECRET>
 */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Enforce origin allowlist in production
    if (allowed && origin && !origin.startsWith(allowed)) {
      return new Response('Forbidden', { status: 403, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // ── GET /records — dashboard read-back ───────────────────────────────────
    if (request.method === 'GET' && url.pathname === '/records') {
      const authHeader = request.headers.get('Authorization') || '';
      const dashSecret = env.DASHBOARD_SECRET;
      if (!dashSecret || authHeader !== `Bearer ${dashSecret}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const token = env.REDCAP_TOKEN;
      const apiUrl = env.REDCAP_API_URL;
      if (!token || !apiUrl) {
        return new Response(JSON.stringify({ error: 'REDCap not configured on server' }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const params = new URLSearchParams({
        token,
        content: 'record',
        action: 'export',
        format: 'json',
        type: 'flat',
        rawOrLabel: 'label',
        exportSurveyFields: 'false',
        exportDataAccessGroups: 'false',
      });

      let redcapRes;
      try {
        redcapRes = await fetch(apiUrl, {
          method: 'POST',
          body: params,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          redirect: 'error',
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Could not reach REDCap', detail: err?.message }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const text = await redcapRes.text();
      if (!redcapRes.ok) {
        return new Response(JSON.stringify({ error: `REDCap returned HTTP ${redcapRes.status}`, detail: text.slice(0, 200) }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(text, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── POST / — import one record ────────────────────────────────────────────
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const record = body?.record;
    if (!record || typeof record !== 'object') {
      return new Response(JSON.stringify({ error: 'Missing record payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = env.REDCAP_TOKEN;
    const apiUrl = env.REDCAP_API_URL;

    if (!token || !apiUrl) {
      return new Response(JSON.stringify({ error: 'REDCap not configured on server' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const params = new URLSearchParams({
      token,
      content: 'record',
      action: 'import',
      format: 'json',
      type: 'flat',
      data: JSON.stringify([record]),
      returnContent: 'ids',
      overwriteBehavior: 'normal',
    });

    let redcapRes;
    try {
      redcapRes = await fetch(apiUrl, {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        redirect: 'manual',
      });
    } catch (fetchErr) {
      console.error('REDCap fetch failed (network error):', fetchErr);
      return new Response(JSON.stringify({ error: 'Could not reach REDCap — check REDCAP_API_URL' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (redcapRes.status >= 300 && redcapRes.status < 400) {
      const location = redcapRes.headers.get('Location') || '(unknown)';
      console.error('REDCap URL redirects to:', location);
      return new Response(JSON.stringify({ error: 'REDCAP_API_URL redirects — use the final URL directly', location }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const redcapText = await redcapRes.text();
    console.log('REDCap HTTP status:', redcapRes.status);
    console.log('REDCap response body:', redcapText);

    if (!redcapRes.ok) {
      console.error('REDCap HTTP error:', redcapRes.status, redcapText);
      return new Response(JSON.stringify({ error: `REDCap returned HTTP ${redcapRes.status}`, detail: redcapText.slice(0, 200) }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (redcapText.startsWith('{"error"') || redcapText.toLowerCase().includes('"error"')) {
      let parsed;
      try { parsed = JSON.parse(redcapText); } catch { /* not JSON */ }
      const detail = parsed?.error ?? redcapText;
      console.error('REDCap application error:', detail);
      return new Response(JSON.stringify({ error: 'REDCap rejected the record', detail }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, redcap: redcapText }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  },
};
