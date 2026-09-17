// Calculator sessions via the same-origin Pages Function at GET /firebase-sessions.
// Firestore is queried server-side using a service account — no Firebase SDK needed.
// An MSAL ID token is required — only authenticated Mount Sinai users can read data.

import { getAuthHeader } from './auth.js';

export const isFirebaseConfigured = true;

export async function fetchCalculatorSessions({ limit = 200 } = {}) {
  const headers = await getAuthHeader();
  const res = await fetch(`/firebase-sessions?limit=${limit}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function deleteCalculatorSession(id) {
  const headers = await getAuthHeader();
  const res = await fetch(`/firebase-sessions?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Calculator usage between two local calendar days (inclusive), from Cloud
// Functions logs plus GA4 locations. Days are 'YYYY-MM-DD' in the viewer's tz.
export async function fetchCalculatorActivity(fromDay, toDay) {
  const local = (day, plus = 0) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d + plus);
  };
  const headers = await getAuthHeader();
  const qs = new URLSearchParams({
    start: local(fromDay).toISOString(),
    end:   local(toDay, 1).toISOString(),
    tz:    Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const res = await fetch(`/firebase-activity?${qs}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
