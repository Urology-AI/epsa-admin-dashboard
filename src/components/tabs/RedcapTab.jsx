import React, { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

function RecordRow({ record }) {
  const [open, setOpen] = useState(false);
  const keys = Object.keys(record).filter((k) => k !== 'record_id');

  return (
    <>
      <tr className="session-row" onClick={() => setOpen((v) => !v)}>
        <td className="td-expand">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="td-ref">{record.record_id}</td>
        <td>{record.age ?? '—'}</td>
        <td>{record.race_epsa ?? '—'}</td>
        <td>{record.family_history ?? '—'}</td>
        <td>{record.genetic_risk ?? '—'}</td>
      </tr>
      {open && (
        <tr className="session-detail-row">
          <td colSpan={6}>
            <div className="session-detail">
              <div className="record-fields">
                {keys.map((k) => (
                  <div key={k} className="record-field">
                    <span className="field-key">{k}</span>
                    <span className="field-val">{String(record[k] ?? '—')}</span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function RedcapTab({ records, loading, error, onRefresh }) {
  const list = records ?? [];

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">REDCap Records — Mount Sinai</h2>
        <button className="icon-btn" onClick={onRefresh} title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? (
        <div className="loading">Fetching from REDCap…</div>
      ) : error ? (
        <div className="error-block">
          <p>Could not load REDCap records: {error}</p>
          <p className="error-hint">Make sure <code>VITE_REDCAP_PROXY_URL</code> and <code>VITE_DASHBOARD_SECRET</code> are set, and the Cloudflare Worker is deployed.</p>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">No REDCap records found. Configure the proxy or check IRB access.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <th>Record ID</th>
                <th>Age</th>
                <th>Race</th>
                <th>Family History</th>
                <th>Genetic Risk</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <RecordRow key={r.record_id} record={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="row-count">{list.length} records in REDCap</p>
    </div>
  );
}
