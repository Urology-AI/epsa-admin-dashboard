// Screening data via server-side Pages Functions (/turso-sessions, /turso-stats).
// Turso credentials never leave the server — no VITE_ vars needed.

import { getAuthHeader } from './auth.js';

export function isTursoConfigured() {
  return true; // always available when deployed to Cloudflare Pages
}

export async function fetchScreeningSessions({ limit = 200 } = {}) {
  const headers = await getAuthHeader();
  const res = await fetch(`/turso-sessions?limit=${limit}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchScreeningStats() {
  const headers = await getAuthHeader();
  const res = await fetch('/turso-stats', { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
