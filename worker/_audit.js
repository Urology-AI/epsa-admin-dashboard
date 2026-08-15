/**
 * Structured audit logging for the ePSA Workers.
 *
 * WHAT THIS DOES AND DOES NOT RECORD
 *
 * Records: who acted, when, what they did, which record, and whether it
 * succeeded. That is the trail you need to answer "who touched this record?"
 * after the fact — during an audit, an IRB query, or a suspected breach.
 *
 * Never records: request or response bodies, form fields, clinical values, or
 * anything derived from them. An earlier version of redcap-proxy.js did
 * `console.log('REDCap response body:', text)`, which put study record content
 * into Cloudflare's logs.
 *
 * The distinction matters more than it looks. Logging nothing is not the safe
 * choice — it leaves you unable to reconstruct access. Logging payloads is
 * worse, because it copies regulated content into a system that was never
 * scoped to hold it. Metadata-only is the target.
 *
 * WHERE IT GOES
 *
 * These lines land in Cloudflare's Workers logs: visible via `wrangler tail`,
 * and retained durably only if Logpush is configured to ship them to your own
 * sink. Treat Logpush as required before relying on this as an audit trail —
 * without it, retention is short and this is a debugging aid, not evidence.
 *
 * Because entries carry an Entra object id and a record identifier, the log
 * sink is itself sensitive: restrict access to it the same way you would the
 * database, and confirm the arrangement with whoever owns your Cloudflare
 * agreement before routing anything regulated through it.
 */

/**
 * Emit one audit entry.
 *
 * @param {object} user    verified Entra token payload
 * @param {string} action  e.g. 'redcap.import', 'redcap.export'
 * @param {object} detail  identifiers and outcome ONLY — never content
 */
export function audit(user, action, detail = {}) {
  // Deliberately a single JSON line: Logpush ships raw console output, and a
  // one-line JSON object is what makes these queryable downstream.
  const entry = {
    type: 'audit',
    ts: new Date().toISOString(),
    action,
    // `oid` is the stable Entra object id. `upn`/`preferred_username` is the
    // human-readable account, useful in an investigation and no more
    // identifying than the sign-in itself.
    actor: user?.oid || user?.sub || 'unknown',
    actorName: user?.preferred_username || user?.upn || null,
    ...detail,
  };
  console.log(JSON.stringify(entry));
}

/**
 * Pull only non-clinical identifiers out of a REDCap record for the audit
 * trail. An allowlist, not a denylist: a new clinical field added upstream
 * must never start flowing into logs because nobody remembered to exclude it.
 */
export function recordIdentifiers(record) {
  if (!record || typeof record !== 'object') return {};
  const out = {};
  for (const key of ['record_id', 'session_ref', 'redcap_event_name']) {
    if (record[key] != null) out[key] = String(record[key]).slice(0, 64);
  }
  // Size is useful for spotting anomalies and reveals nothing about content.
  out.fieldCount = Object.keys(record).length;
  return out;
}
