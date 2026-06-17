import React from 'react';
import { Activity, Database, FileCheck, TrendingUp, AlertCircle, CheckCircle, Clock } from 'lucide-react';

function StatCard({ icon: Icon, label, value, sub, color = 'var(--accent)' }) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ color }}><Icon size={20} /></div>
      <div className="stat-body">
        <div className="stat-value">{value ?? '—'}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function SourceBadge({ ok, label }) {
  return (
    <span className={`source-badge ${ok ? 'source-ok' : 'source-off'}`}>
      {ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
      {label}
    </span>
  );
}

export default function OverviewTab({ screeningStats, sources }) {
  const { total = 0, redcapPushed = 0, thisWeek = 0 } = screeningStats ?? {};
  const pct = total > 0 ? Math.round((redcapPushed / total) * 100) : 0;

  return (
    <div className="tab-content">
      <h2 className="tab-heading">Overview</h2>

      <div className="source-row">
        <SourceBadge ok={sources.turso}   label="Turso (Screening DB)" />
        <SourceBadge ok={sources.firebase} label="Firebase (Calculator)" />
        <SourceBadge ok={sources.redcap}   label="REDCap Sinai" />
      </div>

      <div className="stats-grid">
        <StatCard icon={Activity}   label="Screening sessions (all time)" value={total}       color="var(--blue)" />
        <StatCard icon={Clock}      label="Screening sessions this week"   value={thisWeek}    color="var(--accent)" />
        <StatCard icon={FileCheck}  label="Pushed to REDCap"              value={redcapPushed} color="var(--green)"
          sub={total > 0 ? `${pct}% of all sessions` : undefined} />
        <StatCard icon={Database}   label="Not yet in REDCap"             value={total - redcapPushed} color="var(--amber)" />
      </div>

      {total > 0 && (
        <div className="progress-block">
          <div className="progress-label">
            <span>REDCap upload coverage</span>
            <span>{pct}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--green)' : 'var(--accent)' }} />
          </div>
        </div>
      )}
    </div>
  );
}
