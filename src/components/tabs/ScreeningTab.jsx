import React, { useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

function RedcapBadge({ pushedAt, inRedcap }) {
  if (pushedAt) {
    return (
      <span className="badge badge-green" title={`Pushed to REDCap: ${pushedAt}`}>
        <CheckCircle size={11} /> REDCap ✓
      </span>
    );
  }
  if (inRedcap) {
    return (
      <span className="badge badge-blue" title="Found in REDCap by session_ref read-back">
        <CheckCircle size={11} /> REDCap (verified)
      </span>
    );
  }
  return (
    <span className="badge badge-amber">
      <XCircle size={11} /> Not in REDCap
    </span>
  );
}

function TierBadge({ tier }) {
  const color = tier?.toLowerCase().includes('low') || tier?.toLowerCase().includes('minimal')
    ? 'var(--green)'
    : tier?.toLowerCase().includes('high') || tier?.toLowerCase().includes('elevated')
    ? 'var(--red)'
    : 'var(--amber)';
  return tier
    ? <span className="badge" style={{ background: 'transparent', border: `1px solid ${color}`, color }}>{tier}</span>
    : null;
}

function SessionRow({ session, redcapIds }) {
  const [open, setOpen] = useState(false);
  const inRedcap = redcapIds?.has(session.session_ref);

  return (
    <>
      <tr className="session-row" onClick={() => setOpen((v) => !v)}>
        <td className="td-expand">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="td-ref">{session.session_ref ?? '—'}</td>
        <td>{session.created_at ? new Date(session.created_at).toLocaleDateString() : '—'}</td>
        <td>{session.age ?? '—'}</td>
        <td>{session.race ?? '—'}</td>
        <td><TierBadge tier={session.tier_key} /></td>
        <td>
          <RedcapBadge pushedAt={session.redcap_pushed_at} inRedcap={inRedcap} />
        </td>
      </tr>
      {open && (
        <tr className="session-detail-row">
          <td colSpan={7}>
            <div className="session-detail">
              {session._full
                ? <pre className="session-json">{JSON.stringify(session._full, null, 2)}</pre>
                : <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>No full record available</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ScreeningTab({ sessions, redcapIds, loading, error, onRefresh }) {
  const [filter, setFilter] = useState('all');

  const filtered = (sessions ?? []).filter((s) => {
    if (filter === 'redcap')   return s.redcap_pushed_at || redcapIds?.has(s.session_ref);
    if (filter === 'pending')  return !s.redcap_pushed_at && !redcapIds?.has(s.session_ref);
    return true;
  });

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">Screening Sessions</h2>
        <div className="tab-actions">
          <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All sessions</option>
            <option value="redcap">In REDCap</option>
            <option value="pending">Not in REDCap</option>
          </select>
          <button className="icon-btn" onClick={onRefresh} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Turso error warning */}
      {error && (
        <div className="error-block" style={{ marginBottom: '1.25rem' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <AlertCircle size={16} /> Could not load Turso screening sessions
          </p>
          <p className="error-hint" style={{ marginTop: '0.4rem' }}>{error}</p>
          <p className="error-hint">
            Set <code>TURSO_URL</code> and <code>TURSO_AUTH_TOKEN</code> as Cloudflare Pages environment variables.
          </p>
        </div>
      )}

      {/* REDCap correlation note */}
      {!error && redcapIds !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          <CheckCircle size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
          REDCap loaded — each row shows whether its <code style={{ color: 'var(--text)' }}>session_ref</code> matches a REDCap <code style={{ color: 'var(--text)' }}>record_id</code>.
        </div>
      )}

      {loading ? (
        <div className="loading">Loading sessions…</div>
      ) : !error && filtered.length === 0 ? (
        <div className="empty">No sessions found.</div>
      ) : !error && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <th>Session Ref</th>
                <th>Date</th>
                <th>Age</th>
                <th>Race</th>
                <th>Risk Tier</th>
                <th>REDCap</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <SessionRow key={s.id ?? s.session_ref} session={s} redcapIds={redcapIds} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!error && <p className="row-count">{filtered.length} of {(sessions ?? []).length} sessions shown</p>}
    </div>
  );
}
