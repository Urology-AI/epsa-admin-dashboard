// Read-back from REDCap via the Cloudflare Worker proxy (GET /records).
// The proxy validates DASHBOARD_SECRET so the REDCap token never reaches the browser.

import { REDCAP_PROXY_URL, DASHBOARD_SECRET } from '../config/env.js';

export function isRedcapConfigured() {
  return !!(REDCAP_PROXY_URL && DASHBOARD_SECRET);
}

/**
 * Fetch all records from REDCap.
 * Returns an array of record objects (REDCap flat format with labels).
 */
export async function fetchRedcapRecords() {
  if (!REDCAP_PROXY_URL || !DASHBOARD_SECRET) return [];
  const res = await fetch(`${REDCAP_PROXY_URL}/records`, {
    headers: { Authorization: `Bearer ${DASHBOARD_SECRET}` },
  });
  if (!res.ok) throw new Error(`REDCap proxy returned ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return Array.isArray(data) ? data : [];
}

/**
 * Build a Set of record_ids present in REDCap (for fast lookup in the screening tab).
 */
export async function fetchRedcapRecordIdSet() {
  const records = await fetchRedcapRecords();
  return new Set(records.map((r) => r.record_id));
}
