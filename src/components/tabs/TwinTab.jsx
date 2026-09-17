import React, { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw, CheckCircle, WifiOff } from 'lucide-react';

function Pct({ value }) {
  if (value === null || value === undefined || value === '') return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const n = Number(value);
  const color = n >= 40 ? 'var(--red)' : n >= 20 ? 'var(--amber)' : 'var(--green)';
  return <span style={{ color, fontWeight: 600 }}>{n}%</span>;
}

function PathologyBadge({ c }) {
  const has = [c.path_gg, c.path_ece, c.path_svi, c.path_upgrade, c.path_psm, c.path_lni]
    .some((v) => v !== null && v !== undefined && v !== 0 && v !== '');
  return has
    ? <span className="badge badge-green"><CheckCircle size={11} /> Pathology entered</span>
    : <span className="badge badge-amber">Prediction only</span>;
}

function CaseRow({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="session-row" onClick={() => setOpen((v) => !v)}>
        <td className="td-expand">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="td-ref">{c.id ?? '—'}</td>
        <td>{c.date ? new Date(c.date).toLocaleDateString() : '—'}</td>
        <td>{c.age ?? '—'}</td>
        <td>{c.psa ?? '—'}</td>
        <td>{c.gg ?? '—'}</td>
        <td>{c.pirads ?? '—'}</td>
        <td><Pct value={c.pred_ece} /></td>
        <td><Pct value={c.pred_svi} /></td>
        <td><Pct value={c.pred_bcr} /></td>
        <td><PathologyBadge c={c} /></td>
      </tr>
      {open && (
        <tr className="session-detail-row">
          <td colSpan={11}>
            <div className="session-detail">
              {c._full
                ? <pre className="session-json">{JSON.stringify(c._full, null, 2)}</pre>
                : <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>No full record available</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function TwinTab({ cases, configured, loading, error, onRefresh }) {
  const [filter, setFilter] = useState('all');

  const rows = (cases ?? []).filter((c) => {
    const hasPath = [c.path_gg, c.path_ece, c.path_svi, c.path_upgrade, c.path_psm, c.path_lni]
      .some((v) => v !== null && v !== undefined && v !== 0 && v !== '');
    if (filter === 'pathology') return hasPath;
    if (filter === 'prediction') return !hasPath;
    return true;
  });

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">Digital Twin — Surgical Planning Cases</h2>
        <div className="tab-actions">
          <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All cases</option>
            <option value="pathology">Pathology entered</option>
            <option value="prediction">Prediction only</option>
          </select>
          <button className="icon-btn" onClick={onRefresh} title="Refresh"><RefreshCw size={15} /></button>
        </div>
      </div>

      {configured === false && !error && (
        <div className="error-block" style={{ marginBottom: '1.25rem', borderColor: 'var(--border)' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <WifiOff size={16} /> Digital Twin source not configured
          </p>
          <p className="error-hint" style={{ marginTop: '0.4rem' }}>
            Check <code>TWIN_API_URL</code> points at the digital twin site whose Worker serves
            <code>/api/turso/execute</code>.
          </p>
        </div>
      )}

      {error && (
        <div className="error-block" style={{ marginBottom: '1.25rem' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <AlertCircle size={16} /> Could not load Digital Twin cases
          </p>
          <p className="error-hint" style={{ marginTop: '0.4rem' }}>{error}</p>
        </div>
      )}

      {configured && !error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          <CheckCircle size={13} style={{ color: 'var(--green)', flexShrink: 0 }} />
          De-identified pre-operative cases. <strong style={{ color: 'var(--text)' }}>ECE / SVI / BCR</strong> columns are model predictions; the last column shows whether surgical pathology has been entered.
        </div>
      )}

      {loading ? (
        <div className="loading">Loading cases…</div>
      ) : !error && configured && rows.length === 0 ? (
        <div className="empty">No cases found.</div>
      ) : !error && configured && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <th>Case</th>
                <th>Date</th>
                <th>Age</th>
                <th>PSA</th>
                <th>GG</th>
                <th>PI-RADS</th>
                <th>ECE</th>
                <th>SVI</th>
                <th>BCR</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => <CaseRow key={c.id ?? c.date} c={c} />)}
            </tbody>
          </table>
        </div>
      )}
      {!error && configured && <p className="row-count">{rows.length} of {(cases ?? []).length} cases shown</p>}
    </div>
  );
}
