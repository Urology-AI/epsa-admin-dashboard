// Security monitor findings via GET /security-findings (see security-monitor/).

import { getAuthHeader } from './auth.js';

export async function fetchSecurityFindings() {
  const headers = await getAuthHeader();
  const res = await fetch('/security-findings', { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json(); // { findings, probe, audit }
}
