import React from 'react';
import { FlaskConical, AlertTriangle } from 'lucide-react';

/**
 * Research — journal-supplement-style model performance summary for staff
 * (AUC, sensitivity/specificity/PPV/NPV, cohort size, limitations). Moved
 * here from the patient-facing e-psa app's "Research" view mode, which was
 * dropped back to Patient/Clinical only — this content doesn't belong in
 * front of patients.
 *
 * All numbers below are the real validation output already used by e-psa's
 * ValidationStudyModal.jsx (frontend/src/components/ValidationStudyModal.jsx),
 * ported verbatim rather than re-derived. Fields the project doesn't have committed
 * data for yet (model version string, training cohort N, calibration,
 * bootstrap CI, decision-curve analysis, publications) are shown as
 * "Not yet available" instead of invented — see VVPanel's Clinical Validation
 * Tracker for what's still in progress toward those.
 */
const VALIDATION = {
  datasetN: 94,
  positive: 23,
  aucBayes: 0.593,
  aucPsa: 0.579,
  aucDiff: 0.012,
  aucDiffCiLow: -0.146,
  aucDiffCiHigh: 0.173,
  pVal: 0.878,
  youden: {
    bayes: { thr: -1.3470, j: 0.2486, sens: 0.826, spec: 0.423, ppv: 0.317, npv: 0.882, tp: 19, fn: 4, fp: 41, tn: 30 },
    psa:   { thr: 5.500,   j: 0.1898, sens: 0.739, spec: 0.451, ppv: 0.304, npv: 0.842, tp: 17, fn: 6, fp: 39, tn: 32 },
  },
};

const LIMITATIONS = [
  'Not diagnostic; does not detect or rule out cancer.',
  'Based on population-level associations; individual risk may vary.',
  'Does not replace DRE, PSA, MRI, or biopsy when indicated by a clinician.',
  'In-sample evaluation only (N=94, csPCa+ n=23) — no external validation cohort yet.',
  `EPV underpowered for the current 13-variable model (needs N≥130 events; VVPanel check C5).`,
];

const NOT_YET_AVAILABLE = [
  { label: 'Model version', note: 'No formal version tag committed yet.' },
  { label: 'Training cohort', note: 'Retrospective data pull target N=600–1,000 not yet complete — see VVPanel milestone 2.' },
  { label: 'Calibration plot', note: 'Requires larger cohort; blocked on refit (VVPanel milestone 4).' },
  { label: 'Bootstrap confidence intervals', note: 'AUC-difference CI shown below is analytic, not bootstrapped.' },
  { label: 'Decision curve analysis', note: 'Not yet run.' },
  { label: 'Publications', note: 'Paper 1 not yet submitted — see VVPanel milestone 6.' },
];

const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;
const fmtSigned = (x, digits = 3) => (x >= 0 ? `+${x.toFixed(digits)}` : x.toFixed(digits));

function YoudenTable({ title, data }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th colSpan={2}>{title} (threshold {data.thr})</th></tr>
        </thead>
        <tbody>
          <tr><td>Youden's J</td><td>{data.j.toFixed(4)}</td></tr>
          <tr><td>Sensitivity</td><td>{fmtPct(data.sens)}</td></tr>
          <tr><td>Specificity</td><td>{fmtPct(data.spec)}</td></tr>
          <tr><td>PPV</td><td>{fmtPct(data.ppv)}</td></tr>
          <tr><td>NPV</td><td>{fmtPct(data.npv)}</td></tr>
          <tr><td>TP / FN / FP / TN</td><td>{data.tp} / {data.fn} / {data.fp} / {data.tn}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export default function ResearchTab() {
  return (
    <div className="tab-content">
      <h2 className="tab-heading">Research — Model Performance</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '-0.75rem', marginBottom: '1.5rem' }}>
        Journal-supplement-style validation summary for staff/research use. Not shown to patients.
      </p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon" style={{ color: 'var(--accent)' }}><FlaskConical size={20} /></div>
          <div className="stat-body">
            <div className="stat-value">N={VALIDATION.datasetN}</div>
            <div className="stat-label">Validation cohort</div>
            <div className="stat-sub">csPCa+ n={VALIDATION.positive}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-body">
            <div className="stat-value">{VALIDATION.aucBayes.toFixed(3)}</div>
            <div className="stat-label">AUC (Bayesian ePSA)</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-body">
            <div className="stat-value">{VALIDATION.aucPsa.toFixed(3)}</div>
            <div className="stat-label">AUC (PSA)</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-body">
            <div className="stat-value">{fmtSigned(VALIDATION.aucDiff)}</div>
            <div className="stat-label">AUC difference (Bayesian &minus; PSA)</div>
            <div className="stat-sub">95% CI {fmtSigned(VALIDATION.aucDiffCiLow)} to {fmtSigned(VALIDATION.aucDiffCiHigh)}, p={VALIDATION.pVal}</div>
          </div>
        </div>
      </div>

      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        AUC for Bayesian recalibrated ePSA vs. PSA is statistically equivalent in this sample. Main practical
        advantage at Youden-optimal cutoffs is the higher NPV.
      </p>

      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Youden-optimal performance</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <YoudenTable title="Bayesian ePSA" data={VALIDATION.youden.bayes} />
        <YoudenTable title="PSA" data={VALIDATION.youden.psa} />
      </div>

      <div className="error-block" style={{ background: 'rgba(255,152,0,0.08)', borderColor: 'rgba(255,152,0,0.3)', color: 'var(--amber, #ff9800)', marginBottom: '1.5rem' }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}>
          <AlertTriangle size={15} /> Interpretation note
        </p>
        <p className="error-hint" style={{ color: 'inherit', opacity: 0.9 }}>
          This is an in-sample evaluation on N={VALIDATION.datasetN} with csPCa+ n={VALIDATION.positive}. A larger
          dataset is needed to demonstrate separation beyond statistical equivalence.
        </p>
      </div>

      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Limitations</h3>
      <ul style={{ fontSize: '0.85rem', color: 'var(--text)', lineHeight: 1.7, marginBottom: '1.5rem', paddingLeft: '1.25rem' }}>
        {LIMITATIONS.map((l) => <li key={l}>{l}</li>)}
      </ul>

      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>Not yet available</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Item</th><th>Status</th></tr></thead>
          <tbody>
            {NOT_YET_AVAILABLE.map((item) => (
              <tr key={item.label}>
                <td>{item.label}</td>
                <td style={{ color: 'var(--text-muted)' }}>{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="row-count">Track progress on these in the Verification &amp; Validation tab's Clinical Validation Tracker.</p>
    </div>
  );
}
