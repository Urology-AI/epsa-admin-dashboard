import React from 'react';
import { Activity, Database, FileCheck, AlertCircle, CheckCircle, Clock, Loader2, WifiOff } from 'lucide-react';

// status: 'loading' | 'ok' | 'error' | 'off'
function SourceBadge({ status, label }) {
  if (status === 'loading') {
    return (
      <span className="source-badge source-loading">
        <Loader2 size={12} className="source-spin" /> {label}
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="source-badge source-error" title="Connection failed — check server env vars">
        <AlertCircle size={12} /> {label}
      </span>
    );
  }
  if (status === 'off') {
    return (
      <span className="source-badge source-off">
        <WifiOff size={12} /> {label} (not configured)
      </span>
    );
  }
  return (
    <span className="source-badge source-ok">
      <CheckCircle size={12} /> {label}
    </span>
  );
}

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

export default function OverviewTab({ screeningStats, calcSessions, sourceStatus = {} }) {
  const { total = 0, redcapPushed = 0, thisWeek = 0 } = screeningStats ?? {};
  const pct = total > 0 ? Math.round((redcapPushed / total) * 100) : 0;

  const hasErrors = Object.values(sourceStatus).some((s) => s === 'error');

  return (
    <div className="tab-content">
      <h2 className="tab-heading">Overview</h2>

      {/* Source health row */}
      <div className="source-row">
        <SourceBadge status={sourceStatus.turso}    label="Turso (Screening DB)" />
        <SourceBadge status={sourceStatus.firebase}  label="Firebase (Calculator)" />
        <SourceBadge status={sourceStatus.redcap}    label="REDCap Sinai" />
      </div>

      {/* Warning banner if any source errored */}
      {hasErrors && (
        <div className="error-block" style={{ marginBottom: '1.5rem' }}>
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={16} /> One or more data sources failed to load.
          </p>
          {sourceStatus.turso === 'error' && (
            <p className="error-hint">
              Turso: set <code>TURSO_URL</code> and <code>TURSO_AUTH_TOKEN</code> as Cloudflare Pages env vars.
            </p>
          )}
          {sourceStatus.firebase === 'error' && (
            <p className="error-hint">
              Firebase: set <code>FIREBASE_SERVICE_ACCOUNT</code> as a Cloudflare Pages env var.
            </p>
          )}
          {sourceStatus.redcap === 'error' && (
            <p className="error-hint">
              REDCap: set <code>REDCAP_TOKEN</code> and <code>REDCAP_API_URL</code> as Cloudflare Pages env vars.
            </p>
          )}
        </div>
      )}

      <div className="stats-grid">
        <StatCard icon={Activity}   label="Screening sessions (all time)" value={total}               color="var(--blue)" />
        <StatCard icon={Clock}      label="Screening sessions this week"   value={thisWeek}            color="var(--accent)" />
        <StatCard icon={FileCheck}  label="Pushed to REDCap"               value={redcapPushed}        color="var(--green)"
          sub={total > 0 ? `${pct}% of all sessions` : undefined} />
        <StatCard icon={Database}   label="Not yet in REDCap"              value={total - redcapPushed} color="var(--amber)" />
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
