// REDCap data via the same-origin Pages Function at GET /records.
// The REDCap token lives in Cloudflare Pages environment variables (server-side only).
// An MSAL ID token is required — only authenticated Mount Sinai users can read data.

import { getAuthHeader } from './auth.js';

export function isRedcapConfigured() {
  return typeof window !== 'undefined';
}

export async function fetchRedcapRecords() {
  const headers = await getAuthHeader();
  const res = await fetch('/records', { headers });
  if (!res.ok) throw new Error(`REDCap proxy returned ${res.status}`);
  const data = await res.json();
  if (data?.error) throw new Error(data.error);
  return Array.isArray(data) ? data : [];
}

export async function fetchRedcapRecordIdSet() {
  const records = await fetchRedcapRecords();
  return new Set(records.map((r) => r.record_id));
}
