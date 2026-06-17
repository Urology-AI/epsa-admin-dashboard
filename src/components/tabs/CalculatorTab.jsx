import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function CalculatorTab({ sessions, loading, error, onRefresh }) {
  const list = sessions ?? [];

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">Calculator Sessions (ePSA Full Tool)</h2>
        <button className="icon-btn" onClick={onRefresh} title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading sessions…</div>
      ) : error ? (
        <div className="error-block">
          <p>Could not load calculator sessions: {error}</p>
          <p className="error-hint">Make sure <code>FIREBASE_SERVICE_ACCOUNT</code> is set as a Cloudflare Pages environment variable.</p>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">No calculator sessions found.</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Session ID</th>
                <th>Date</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Risk Tier</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const ts = s.createdAt;
                const created = ts ? new Date(typeof ts === 'string' ? ts : ts) : null;
                return (
                  <tr key={s.id} className="session-row">
                    <td className="td-ref">{s.id}</td>
                    <td>{created ? created.toLocaleDateString() : '—'}</td>
                    <td>{s.status ?? '—'}</td>
                    <td>{s.step2 ? 'post-PSA' : 'pre-PSA'}</td>
                    <td>{s.step1?.preResult?.tierKey ?? s.finalCategory ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="row-count">{list.length} sessions</p>
    </div>
  );
}
