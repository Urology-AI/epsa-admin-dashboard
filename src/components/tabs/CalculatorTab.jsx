import React, { useState } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, DatabaseZap } from 'lucide-react';
import { getAuthHeader } from '../../services/auth.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function fmtVal(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.map(x => x ?? '—').join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const STEP1_LABELS = {
  age:              'Age',
  race:             'Race/Ethnicity',
  familyHistory:    'Family History',
  brcaStatus:       'BRCA Status',
  bmi:              'BMI',
  weight:           'Weight',
  heightFt:         'Height (ft)',
  heightIn:         'Height (in)',
  ipss:             'IPSS scores',
  shim:             'SHIM scores',
  exercise:         'Exercise',
  smoking:          'Smoking',
  chemicalExposure: 'Chemical Exposure',
  dietPattern:      'Diet Pattern',
  comorbidityScore: 'Comorbidity Score',
  hypertension:     'Hypertension',
  hyperlipidemia:   'Hyperlipidemia',
  coronaryArteryDisease: 'CAD',
  diabetes:         'Diabetes',
};

const STEP2_LABELS = {
  psa:                 'PSA (ng/mL)',
  knowPsa:             'Knows PSA',
  onHormonalTherapy:   'On Hormonal Therapy',
  hormonalTherapyType: 'Therapy Type',
  knowPirads:          'Has PI-RADS',
  pirads:              'PI-RADS Score',
};

function DataGrid({ data, labels }) {
  if (!data) return <span className="field-val">—</span>;
  const keys = Object.keys(labels).filter(k => data[k] !== undefined && data[k] !== '');
  if (!keys.length) return <span className="field-val">No data fields found</span>;
  return (
    <div className="record-fields">
      {keys.map(k => (
        <div key={k} className="record-field">
          <span className="field-key">{labels[k]}</span>
          <span className="field-val">{fmtVal(data[k])}</span>
        </div>
      ))}
    </div>
  );
}

function ResultBadge({ tierKey, score }) {
  if (!tierKey && score === undefined) return '—';
  const colour = tierKey === 'low' ? 'badge-green'
               : tierKey === 'high' ? 'badge-red'
               : 'badge-amber';
  return (
    <span className={`badge ${colour}`}>
      {tierKey ?? '—'}{score !== undefined ? ` (${Math.round(score)}%)` : ''}
    </span>
  );
}

function SessionDetail({ s }) {
  const pre  = s.step1 ?? s.step1Partial;
  const post = s.step2;
  const preRes  = s.step1?.preResult ?? s.preResult;
  const postRes = s.step2?.postResult ?? s.postResult;

  return (
    <div className="session-detail">
      {/* ── Identifiers ─────────────────────────────────────── */}
      <div className="record-fields" style={{ marginBottom: '0.75rem' }}>
        <div className="record-field">
          <span className="field-key">Session Code</span>
          <span className="field-val td-ref" style={{ fontFamily: 'monospace' }}>{s.id}</span>
        </div>
        <div className="record-field">
          <span className="field-key">User ID</span>
          <span className="field-val td-ref" style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{s.userId ?? '—'}</span>
        </div>
        <div className="record-field">
          <span className="field-key">Created</span>
          <span className="field-val">{fmtDate(s.createdAt)}</span>
        </div>
        <div className="record-field">
          <span className="field-key">Updated</span>
          <span className="field-val">{fmtDate(s.updatedAt)}</span>
        </div>
        <div className="record-field">
          <span className="field-key">Expires</span>
          <span className="field-val">{fmtDate(s.expiresAt)}</span>
        </div>
      </div>

      {/* ── Part 1 clinical inputs ───────────────────────────── */}
      <p className="field-key" style={{ marginBottom: '0.35rem' }}>
        PART 1 — Clinical Inputs {!pre && <em>(not stored)</em>}
      </p>
      <DataGrid data={pre} labels={STEP1_LABELS} />

      {/* ── Part 1 result ────────────────────────────────────── */}
      {preRes && (
        <div className="record-fields" style={{ marginTop: '0.5rem' }}>
          <div className="record-field">
            <span className="field-key">Pre-PSA Risk Tier</span>
            <span className="field-val">
              <ResultBadge tierKey={preRes.tierKey} score={preRes.score ?? preRes.riskScore} />
            </span>
          </div>
          {preRes.category && (
            <div className="record-field">
              <span className="field-key">Category</span>
              <span className="field-val">{preRes.category}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Part 2 clinical inputs ───────────────────────────── */}
      {post && (
        <>
          <p className="field-key" style={{ margin: '0.75rem 0 0.35rem' }}>PART 2 — PSA / Imaging Inputs</p>
          <DataGrid data={post} labels={STEP2_LABELS} />
        </>
      )}

      {/* ── Part 2 result ────────────────────────────────────── */}
      {postRes && (
        <div className="record-fields" style={{ marginTop: '0.5rem' }}>
          <div className="record-field">
            <span className="field-key">Post-PSA Risk Tier</span>
            <span className="field-val">
              <ResultBadge tierKey={postRes.tierKey} score={postRes.score ?? postRes.riskScore} />
            </span>
          </div>
          {(postRes.recommendation || postRes.action) && (
            <div className="record-field" style={{ maxWidth: '320px' }}>
              <span className="field-key">Recommendation</span>
              <span className="field-val">{postRes.recommendation ?? postRes.action}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Raw JSON fallback ────────────────────────────────── */}
      <details style={{ marginTop: '0.75rem' }}>
        <summary className="field-key" style={{ cursor: 'pointer' }}>Raw Firebase document</summary>
        <pre className="session-json">{JSON.stringify(s, null, 2)}</pre>
      </details>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

async function runBackfill() {
  const headers = await getAuthHeader();
  const res = await fetch('/firebase-backfill-expiry', { method: 'POST', headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json(); // { patched, skipped, errors }
}

export default function CalculatorTab({ sessions, loading, error, onRefresh }) {
  const [expanded,      setExpanded]      = useState(new Set());
  const [backfillState, setBackfillState] = useState('idle'); // idle | running | done | error
  const [backfillMsg,   setBackfillMsg]   = useState('');
  const list = sessions ?? [];

  async function handleBackfill() {
    setBackfillState('running');
    setBackfillMsg('');
    try {
      const result = await runBackfill();
      setBackfillState('done');
      setBackfillMsg(`Done — patched ${result.patched}, skipped ${result.skipped}${result.errors ? `, errors ${result.errors}` : ''}`);
    } catch (err) {
      setBackfillState('error');
      setBackfillMsg(err.message);
    }
  }

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">Calculator Sessions (ePSA Full Tool)</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {backfillMsg && (
            <span style={{ fontSize: '0.75rem', color: backfillState === 'error' ? 'var(--red, #ef5350)' : 'var(--text-muted)' }}>
              {backfillMsg}
            </span>
          )}
          <button
            className="icon-btn"
            onClick={handleBackfill}
            disabled={backfillState === 'running'}
            title="Backfill expiresAt (createdAt + 90 days) on sessions missing it"
          >
            <DatabaseZap size={15} />
          </button>
          <button className="icon-btn" onClick={onRefresh} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
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
                <th style={{ width: 28 }} />
                <th>Session Code</th>
                <th>Created</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Risk Tier</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const open = expanded.has(s.id);
                const preRes = s.step1?.preResult ?? s.preResult;
                const tierKey = preRes?.tierKey ?? s.step2?.postResult?.tierKey ?? s.finalCategory;
                return (
                  <React.Fragment key={s.id}>
                    <tr className="session-row" onClick={() => toggle(s.id)}>
                      <td className="td-expand">
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td className="td-ref">{s.id}</td>
                      <td>{fmtDate(s.createdAt)}</td>
                      <td>{s.status ?? '—'}</td>
                      <td>{s.step2 ? 'post-PSA' : s.step1 ? 'pre-PSA' : s.step1Partial ? 'in-progress' : '—'}</td>
                      <td>
                        {tierKey
                          ? <ResultBadge tierKey={tierKey} />
                          : '—'}
                      </td>
                    </tr>
                    {open && (
                      <tr className="session-detail-row">
                        <td colSpan={6}>
                          <SessionDetail s={s} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
