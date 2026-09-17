// Digital Twin pre-operative planning cases, via server-side Pages Functions
// (/twin-cases, /twin-stats). The twin uses its OWN Turso database, separate
// from the screening tool's — credentials (TWIN_TURSO_*) never leave the server.

import { getAuthHeader } from './auth.js';

export function isTwinConfigured() {
  return true; // resolved server-side; the functions report `configured: false`
}

export async function fetchTwinCases({ limit = 200 } = {}) {
  const headers = await getAuthHeader();
  const res = await fetch(`/twin-cases?limit=${limit}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json(); // { configured, cases }
}

export async function fetchTwinStats() {
  const headers = await getAuthHeader();
  const res = await fetch('/twin-stats', { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json(); // { configured, total, thisWeek, withPathology }
}
