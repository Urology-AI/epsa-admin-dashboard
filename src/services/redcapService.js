// REDCap read-back via the same-origin Pages Function at GET /records.
// The REDCap token lives in Cloudflare Pages environment variables (server-side).
// No secret is needed in the browser — the function is same-origin.

export function isRedcapConfigured() {
  // Always available when deployed to Cloudflare Pages.
  // In local dev it returns false gracefully if the function isn't running.
  return typeof window !== 'undefined';
}

/**
 * Fetch all records from REDCap.
 * Returns an array of record objects (REDCap flat format with labels).
 */
export async function fetchRedcapRecords() {
  const res = await fetch('/records');
  if (!res.ok) throw new Error(`REDCap proxy returned ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data) ? data : [];
}

/**
 * Build a Set of record_ids present in REDCap (for fast lookup in the screening tab).
 */
export async function fetchRedcapRecordIdSet() {
  const records = await fetchRedcapRecords();
  return new Set(records.map((r) => r.record_id));
}
