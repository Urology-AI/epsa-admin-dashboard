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
