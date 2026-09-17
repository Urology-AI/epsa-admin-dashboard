/**
 * Reads the Digital Twin's case_log through the twin's own Cloudflare Worker
 * (/api/turso/execute), so the dashboard holds no Turso credential for it.
 *
 * The Worker only allows the exact read the twin app issues
 * ("SELECT * FROM case_log ORDER BY date DESC"), so any filtering, limiting
 * or counting happens here.
 *
 * Server-side env vars:
 *   TWIN_API_URL — optional; defaults to the production twin origin
 */

const DEFAULT_TWIN_API_URL = 'https://digital-twin.urology.edu.eu.org';
const CASE_LOG_SELECT = 'SELECT * FROM case_log ORDER BY date DESC';

/** @returns {Promise<object[]>} case_log rows as objects, newest first */
export async function fetchTwinCaseLog(env) {
  const base = (env.TWIN_API_URL || DEFAULT_TWIN_API_URL).replace(/\/+$/, '');
  const res = await fetch(`${base}/api/turso/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql: CASE_LOG_SELECT, args: [] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Twin API HTTP ${res.status}`);
  return (data.rows || []).map((row) =>
    Object.fromEntries(data.columns.map((c, i) => [c, row[i]])));
}
