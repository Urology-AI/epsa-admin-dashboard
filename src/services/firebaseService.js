// Calculator sessions via the same-origin Pages Function at GET /firebase-sessions.
// Firestore is queried server-side using a service account — no Firebase SDK or
// Firebase auth needed in the browser.

export const isFirebaseConfigured = true; // always available when deployed

/**
 * Fetch recent calculator sessions from Firestore (via Pages Function).
 */
export async function fetchCalculatorSessions({ limit = 200 } = {}) {
  const res = await fetch(`/firebase-sessions?limit=${limit}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
