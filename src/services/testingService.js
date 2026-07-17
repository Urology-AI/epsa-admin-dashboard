// Physician test-case responses via the same-origin Pages Function at /testing-responses.
// An MSAL ID token is required — only authenticated Mount Sinai users can read/write data.

import { getAuthHeader } from './auth.js';

export async function fetchTestResponses() {
  const headers = await getAuthHeader();
  const res = await fetch('/testing-responses', { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function submitTestResponse({ caseId, decision, notes, engineScore, engineTier, engineRecommendPSA }) {
  const authHeaders = await getAuthHeader();
  const res = await fetch('/testing-responses', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caseId, decision, notes, engineScore, engineTier, engineRecommendPSA }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
