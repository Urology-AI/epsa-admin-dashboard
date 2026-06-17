// Read-only Turso client for the unified dashboard.
// Queries the same DB used by the screening tool.

import { createClient } from '@libsql/client/web';
import { TURSO_URL, TURSO_AUTH_TOKEN } from '../config/env.js';

export function isTursoConfigured() {
  return !!(TURSO_URL && TURSO_AUTH_TOKEN);
}

function getClient() {
  if (!TURSO_URL || !TURSO_AUTH_TOKEN) throw new Error('Turso not configured');
  return createClient({
    url: TURSO_URL.replace(/^libsql:\/\//, 'https://'),
    authToken: TURSO_AUTH_TOKEN,
  });
}

/**
 * Fetch all screening sessions, newest first.
 * Returns an array of plain objects with all flat columns + parsed full_record.
 */
export async function fetchScreeningSessions({ limit = 200 } = {}) {
  const client = getClient();
  const result = await client.execute({
    sql: `SELECT id, session_ref, created_at, age, race, family_history,
                 tier_key, tier_label, display_range,
                 psa, pirads, redcap_pushed_at, full_record
          FROM clinical_sessions
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [limit],
  });

  const cols = result.columns;
  return result.rows.map((row) => {
    const obj = {};
    cols.forEach((col, i) => { obj[col] = row[i]; });
    try { obj._full = JSON.parse(obj.full_record); } catch { obj._full = null; }
    return obj;
  });
}

/**
 * Aggregate counts: total, consented, redcap_pushed, this_week.
 */
export async function fetchScreeningStats() {
  const client = getClient();
  const [total, pushed, week] = await Promise.all([
    client.execute('SELECT COUNT(*) as n FROM clinical_sessions'),
    client.execute("SELECT COUNT(*) as n FROM clinical_sessions WHERE redcap_pushed_at IS NOT NULL AND redcap_pushed_at != ''"),
    client.execute(`SELECT COUNT(*) as n FROM clinical_sessions WHERE created_at >= datetime('now', '-7 days')`),
  ]);
  const n  = (r) => Number(r.rows[0][0]);
  return { total: n(total), redcapPushed: n(pushed), thisWeek: n(week) };
}
