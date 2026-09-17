/**
 * Cloudflare Pages Function — GET /security-findings
 *
 * Findings and last-run check results written by the epsa-security-monitor
 * Worker (security-monitor/) into the SECURITY_KV namespace.
 *
 * Requires a valid Microsoft MSAL ID token in the Authorization header.
 */

import { verifyMsalToken, unauthorized } from './_auth.js';

const JSON_CT = { 'Content-Type': 'application/json' };

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestGet({ env, request }) {
  const user = await verifyMsalToken(request.headers.get('Authorization'), env);
  if (!user) return unauthorized();

  if (!env.SECURITY_KV) {
    return new Response(JSON.stringify({ error: 'SECURITY_KV binding not configured' }), { status: 503, headers: JSON_CT });
  }

  const [findings, probe, audit] = await Promise.all([
    env.SECURITY_KV.get('findings', 'json'),
    env.SECURITY_KV.get('last:probe', 'json'),
    env.SECURITY_KV.get('last:audit', 'json'),
  ]);
  return new Response(JSON.stringify({ findings: findings ?? [], probe, audit }), { status: 200, headers: JSON_CT });
}
