import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function CalculatorTab({ sessions, loading, onRefresh }) {
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
      ) : list.length === 0 ? (
        <div className="empty">No calculator sessions found. Make sure Firebase is configured.</div>
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
                const created = s.createdAt?.toDate?.() ?? (s.createdAt ? new Date(s.createdAt) : null);
                return (
                  <tr key={s.id} className="session-row">
                    <td className="td-ref">{s.id}</td>
                    <td>{created ? created.toLocaleDateString() : '—'}</td>
                    <td>{s.status ?? '—'}</td>
                    <td>{s.stage ?? (s.step2 ? 'post' : 'pre')}</td>
                    <td>{s.preResult?.tierKey ?? s.engineResult?.tierKey ?? '—'}</td>
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
