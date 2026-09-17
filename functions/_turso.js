/**
 * Thin wrapper around the Turso hrana-over-HTTP pipeline API.
 * Uses raw fetch — no npm dependency needed in Pages Functions.
 *
 * Server-side env vars required:
 *   TURSO_URL        — libsql:// or https:// URL of the database
 *   TURSO_AUTH_TOKEN — Turso auth token (read-only recommended)
 */

function tursoUrl(env) {
  return env.TURSO_URL.replace(/^libsql:\/\//, 'https://');
}

function parseValue(v) {
  if (!v || v.type === 'null') return null;
  if (v.type === 'integer') return Number(v.value);
  if (v.type === 'float')   return Number(v.value);
  if (v.type === 'text')    return v.value;
  return v.value ?? null;
}

/**
 * Execute a single SQL statement via the Turso HTTP pipeline.
 * @param {object} env  - CF env with TURSO_URL + TURSO_AUTH_TOKEN
 * @param {string} sql
 * @param {Array}  args - positional args as Turso typed values or plain JS values
 * @returns {Promise<{ columns: string[], rows: object[] }>}
 */
export async function tursoQuery(env, sql, args = []) {
  const typedArgs = args.map((a) => {
    if (a === null || a === undefined) return { type: 'null',    value: null };
    if (typeof a === 'number' && Number.isInteger(a)) return { type: 'integer', value: String(a) };
    if (typeof a === 'number') return { type: 'float',   value: String(a) };
    return { type: 'text', value: String(a) };
  });

  const res = await fetch(`${tursoUrl(env)}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${env.TURSO_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args: typedArgs } },
        { type: 'close' },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Turso HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const result = data.results?.[0];
  if (result?.type === 'error') throw new Error(result.error?.message || 'Turso error');

  const { cols, rows } = result.response.result;
  const columns = cols.map((c) => c.name);
  const parsed  = rows.map((row) => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = parseValue(row[i]); });
    return obj;
  });

  return { columns, rows: parsed };
}
