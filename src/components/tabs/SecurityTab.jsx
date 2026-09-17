import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ShieldAlert, ShieldCheck, CheckCircle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchSecurityFindings } from '../../services/securityService.js';

// Findings from the epsa-security-monitor Worker: unauthenticated API probes
// (every 15 min) and the hourly Cloudflare log / Firebase config audit.

const SEVERITY = {
  critical: { rank: 0, badge: 'badge-red',   label: 'Critical' },
  high:     { rank: 1, badge: 'badge-red',   label: 'High' },
  medium:   { rank: 2, badge: 'badge-amber', label: 'Medium' },
  low:      { rank: 3, badge: 'badge-blue',  label: 'Low' },
};

function ago(ts) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - new Date(ts)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function Checks({ title, run, stale }) {
  const [open, setOpen] = useState(false);
  const checks = run?.checks ?? [];
  const failing = checks.filter((c) => !c.ok).length;
  return (
    <div className="activity-card">
      <button className="security-checks-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <h3 className="activity-card-title" style={{ margin: 0 }}>{title}</h3>
        <span className={`badge ${!run ? 'badge-amber' : failing ? 'badge-red' : 'badge-green'}`}>
          {!run ? 'no runs' : failing ? `${failing} failing` : `${checks.length} passing`}
        </span>
        <span className="date-group-meta">
          last run {ago(run?.at)}{stale ? ' — overdue' : ''}{run?.error ? ` — error: ${run.error}` : ''}
        </span>
      </button>
      {open && (
        <ul className="security-check-list">
          {checks.map((c) => (
            <li key={c.name}>
              {c.ok ? <CheckCircle size={13} style={{ color: 'var(--green)' }} /> : <XCircle size={13} style={{ color: 'var(--red)' }} />}
              <span>{c.name}</span>
              <span className="date-group-meta">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SecurityTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await fetchSecurityFindings()); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const findings = (data?.findings ?? [])
    .filter((f) => showResolved || !f.resolvedAt)
    .sort((a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9) || (b.lastSeen > a.lastSeen ? 1 : -1));
  const open = (data?.findings ?? []).filter((f) => !f.resolvedAt);
  const count = (sev) => open.filter((f) => f.severity === sev).length;
  const overdue = (run, minutes) => !run || Date.now() - new Date(run.at) > minutes * 60000;

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">Security Monitor</h2>
        <button className="icon-btn" onClick={load} title="Refresh" disabled={loading}>
          <RefreshCw size={15} />
        </button>
      </div>

      {error ? (
        <div className="error-block"><p>Could not load findings: {error}</p></div>
      ) : loading && !data ? (
        <div className="loading">Loading findings…</div>
      ) : (
        <>
          <div className="stats-grid">
            {['critical', 'high', 'medium', 'low'].map((sev) => (
              <div className="stat-card" key={sev}>
                {count(sev) ? <ShieldAlert size={20} className="stat-icon" style={{ color: sev === 'low' ? 'var(--blue)' : sev === 'medium' ? 'var(--amber)' : 'var(--red)' }} />
                            : <ShieldCheck size={20} className="stat-icon" style={{ color: 'var(--green)' }} />}
                <div>
                  <div className="stat-value">{count(sev)}</div>
                  <div className="stat-label">Open {SEVERITY[sev].label.toLowerCase()}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="activity-grid" style={{ marginBottom: '1.25rem' }}>
            <Checks title="API lockdown probes (every 15 min)" run={data.probe} stale={overdue(data.probe, 35)} />
            <Checks title="Log & config audit (hourly)" run={data.audit} stale={overdue(data.audit, 130)} />
          </div>

          <div className="tab-header-row">
            <h3 className="activity-card-title" style={{ margin: 0 }}>Findings</h3>
            <label className="date-group-meta" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
              Show resolved
            </label>
          </div>

          {findings.length === 0 ? (
            <div className="empty">No {showResolved ? '' : 'open '}findings.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Finding</th>
                    <th>Source</th>
                    <th>First seen</th>
                    <th>Last seen</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f) => (
                    <tr key={f.id}>
                      <td><span className={`badge ${SEVERITY[f.severity]?.badge ?? 'badge-blue'}`}>{SEVERITY[f.severity]?.label ?? f.severity}</span></td>
                      <td>
                        <strong>{f.title}</strong>
                        <div className="security-detail">{f.detail}</div>
                      </td>
                      <td>{f.source}</td>
                      <td title={f.firstSeen}>{ago(f.firstSeen)}</td>
                      <td title={f.lastSeen}>{ago(f.lastSeen)}{f.count > 1 ? ` (×${f.count})` : ''}</td>
                      <td>{f.resolvedAt ? <span className="badge badge-green">Resolved {ago(f.resolvedAt)}</span> : <span className="badge badge-red">Open</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
