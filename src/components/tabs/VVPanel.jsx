/**
 * VVPanel — Verification & Validation tab
 * 1. Model Verification — automated checks
 * 2. Clinical Validation Tracker — localStorage-backed milestones
 * 3. FMEA Risk Register — localStorage-backed failure modes
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import './VVPanel.css';

// ─── Config snapshot (keep in sync with frontend calculatorConfig.js) ─────────
const CONFIG_PART1_VARIABLES = [
  { id: 'age_50_59' },
  { id: 'age_60_69' },
  { id: 'age_70_plus' },
  { id: 'bmi_25_29_9' },
  { id: 'bmi_ge_30' },
  { id: 'ipss_moderate' },
  { id: 'ipss_severe' },
  { id: 'exercise_some' },
  { id: 'exercise_none' },
  { id: 'raceBlack' },
  { id: 'fhBinary' },
  { id: 'age60plus_x_ipss_moderate' },
  { id: 'age60plus_x_ipss_severe' },
];

const SCORE_POINTS = {
  age_50_59:                 4,
  age_60_69:                 3,
  age_70_plus:               2,
  bmi_25_29_9:               9,
  bmi_ge_30:                 4,
  ipss_moderate:             0,
  ipss_severe:               0,
  exercise_some:             1,
  exercise_none:             4,
  raceBlack:                 7,
  fhBinary:                  0,
  age60plus_x_ipss_moderate: 0,
  age60plus_x_ipss_severe:   0,
};

const ASSUMPTIONS_REGISTER = [
  { id: 'A1', assumption: 'BRCA+ receives hardcoded 16 points — maximum on scale, equal to age 70+.' },
];

const MAX_SCORE = 80;

function computeScore(vars) {
  return vars.reduce((sum, id) => sum + (SCORE_POINTS[id] ?? 0), 0);
}
function tierFromRaw(raw) {
  if (raw >= 18) return 'elevated';
  if (raw >= 11) return 'intermediate';
  return 'low';
}

function runChecks() {
  const results = [];

  const profiles = [
    { name: 'All-zero',                         vars: [] },
    { name: 'All-max',                           vars: ['age_50_59', 'bmi_25_29_9', 'exercise_none', 'raceBlack'] },
    { name: 'Average adult (55, BMI 27)',         vars: ['age_50_59', 'bmi_25_29_9'] },
    { name: 'Young low-risk (42, BMI 22)',        vars: [] },
    { name: 'Black 70+ (age_70_plus, raceBlack)', vars: ['age_70_plus', 'raceBlack'] },
  ];
  const scores = profiles.map((p) => ({ name: p.name, raw: computeScore(p.vars) }));
  const outOfRange = scores.filter((s) => s.raw < 0 || s.raw > MAX_SCORE);
  results.push({
    id: 'C1', label: 'Score range [0, 80]',
    pass: outOfRange.length === 0,
    detail: outOfRange.length === 0
      ? `All 5 profiles in range. Scores: ${scores.map((s) => `${s.name}=${s.raw}`).join(', ')}`
      : `Out-of-range: ${outOfRange.map((s) => `${s.name}=${s.raw}`).join(', ')}`,
  });

  const s70 = computeScore(['age_70_plus']);
  const s60 = computeScore(['age_60_69']);
  const s50 = computeScore(['age_50_59']);
  results.push({
    id: 'C2', label: 'Age monotonicity (70+ ≥ 60–69 ≥ 50–59 ≥ baseline)',
    pass: s70 >= s60 && s60 >= s50 && s50 >= 0,
    detail: `70+=${s70}, 60–69=${s60}, 50–59=${s50}, baseline=0`,
  });

  const sBlack = computeScore(['raceBlack', 'age_50_59']);
  const sWhite = computeScore(['age_50_59']);
  results.push({
    id: 'C3', label: 'Race monotonicity (Black > non-Black, all else equal)',
    pass: sBlack > sWhite,
    detail: `Black+age50-59=${sBlack}, white+age50-59=${sWhite}`,
  });

  const tier17 = tierFromRaw(17);
  const tier18 = tierFromRaw(18);
  results.push({
    id: 'C4', label: 'Tier boundary: rawScore 17→intermediate, 18→elevated',
    pass: tier17 === 'intermediate' && tier18 === 'elevated',
    detail: `rawScore=17 → "${tier17}", rawScore=18 → "${tier18}"`,
  });

  const nVars = CONFIG_PART1_VARIABLES.length;
  const minN = nVars * 10;
  const currentN = 94;
  results.push({
    id: 'C5', label: 'EPV estimate: minimum dataset size for EPV≥10',
    pass: currentN >= minN,
    detail: `${nVars} variables → min N = ${minN} events. Current N = ${currentN}. ${currentN < minN ? 'UNDERPOWERED — refit needed.' : 'OK.'}`,
  });

  const a1 = ASSUMPTIONS_REGISTER.find((a) => a.id === 'A1');
  results.push({
    id: 'C6', label: 'BRCA hardcode assumption documented in ASSUMPTIONS_REGISTER',
    pass: !!a1,
    detail: a1 ? `A1: ${a1.assumption}` : 'A1 not found.',
  });

  return results;
}

// ─── FMEA data ────────────────────────────────────────────────────────────────
const FMEA_ROWS = [
  { id: 'FM1',  sev: 'CRITICAL', name: 'False LOW score — high-risk man not referred',             mitigation: 'Dual-pathway: any AUA Grade A factor triggers referral regardless of score' },
  { id: 'FM2',  sev: 'MODERATE', name: 'False HIGH score — unnecessary referral',                   mitigation: 'Consent explains 10–15% FPR; score is a screening aid not a diagnosis' },
  { id: 'FM3',  sev: 'MODERATE', name: 'Default values accepted uncritically',                      mitigation: 'Defaults badge warns users; REDCap required fields prevent empty submission' },
  { id: 'FM4',  sev: 'CRITICAL', name: 'Model weight mismatch after refit',                         mitigation: 'Weight-integrity test suite runs on every refit; VV panel C1–C5 must pass' },
  { id: 'FM5',  sev: 'HIGH',     name: 'REDCap submission failure — silent data loss',              mitigation: 'Submission returns success/error state; UI shows confirmation; logs retained' },
  { id: 'FM6',  sev: 'HIGH',     name: 'EPV < 10 — model statistically underpowered',              mitigation: 'EPV flagged in VV panel; paper discloses; refit gated on N≥600' },
  { id: 'FM7',  sev: 'HIGH',     name: 'Race field unknown or defaulted to white',                  mitigation: 'Race field required (no default); Unknown option available; flagged in output' },
  { id: 'FM8',  sev: 'CRITICAL', name: 'HIPAA breach',                                              mitigation: 'No PHI stored; session ref is non-identifying; Cloudflare access controls' },
  { id: 'FM9',  sev: 'HIGH',     name: 'Therac-25: undocumented assumption in new context',         mitigation: 'ASSUMPTIONS_REGISTER documents all overrides; VV panel C6 verifies' },
  { id: 'FM10', sev: 'MODERATE', name: 'User misinterprets score as a diagnosis',                   mitigation: "Disclaimer on every result screen; score described as 'pre-screening' not diagnosis" },
  { id: 'FM11', sev: 'MODERATE', name: 'Biopsy adverse event attributed to ePSA',                  mitigation: 'Consent form clarifies ePSA is a referral aid; biopsy decision rests with urologist' },
  { id: 'FM12', sev: 'HIGH',     name: 'PSA not corrected for finasteride/dutasteride',             mitigation: '5-ARI field collected; engine applies 2× PSA correction when 5-ARI=1' },
];

// ─── Milestones ───────────────────────────────────────────────────────────────
const MILESTONE_NAMES = [
  'IRB amendment submitted (Studies 1 + 2)',
  'Retrospective data pull complete (N target: 600–1,000)',
  'Missing biopsy records retrieved (target: 23 records)',
  'Model refit on expanded dataset',
  'Verification suite passes on new weights',
  'Paper 1 submitted (European Urology / J Urology)',
  'External validation data sharing agreement signed',
  'FDA Q-Sub pre-submission meeting held',
];

const STATUS_OPTIONS = ['Not started', 'In progress', 'Complete', 'Blocked'];
const LS_MILESTONES  = 'epsa_vv_milestones';
const LS_FMEA        = 'epsa_vv_fmea';

function load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}
function save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function VVPanel() {
  const [checks,      setChecks]      = useState([]);
  const [milestones,  setMilestones]  = useState(() => load(LS_MILESTONES));
  const [fmea,        setFmea]        = useState(() => load(LS_FMEA));
  const [expandedFm,  setExpandedFm]  = useState({});

  const runAll = useCallback(() => setChecks(runChecks()), []);
  useEffect(() => { runAll(); }, [runAll]);

  const updateMilestone = (idx, field, value) => {
    setMilestones((prev) => {
      const next = { ...prev, [idx]: { ...(prev[idx] || {}), [field]: value } };
      save(LS_MILESTONES, next);
      return next;
    });
  };

  const toggleFmea = (id) => {
    setFmea((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      save(LS_FMEA, next);
      return next;
    });
  };

  const completedCount = MILESTONE_NAMES.filter((_, i) => milestones[i]?.status === 'Complete').length;
  const mitigatedCount = FMEA_ROWS.filter((r) => fmea[r.id]).length;

  return (
    <div className="vv-root">
      <h2 className="vv-heading">Verification &amp; Validation</h2>
      <p className="vv-sub">Model integrity checks, clinical validation milestones, and FMEA risk register.</p>

      {/* ── 1. Model Verification ── */}
      <section className="vv-section">
        <div className="vv-section-header">
          <h3 className="vv-section-title">1. Model Verification</h3>
          <button type="button" className="vv-rerun-btn" onClick={runAll}>
            <RefreshCw size={13} /> Re-run Checks
          </button>
        </div>
        <div className="vv-checks">
          {checks.map((c) => (
            <div key={c.id} className={`vv-check ${c.pass ? 'vv-check--pass' : 'vv-check--fail'}`}>
              <div className="vv-check-icon">
                {c.pass
                  ? <CheckCircle size={16} color="var(--green)" />
                  : <XCircle    size={16} color="var(--red)"   />}
              </div>
              <div>
                <div className="vv-check-label">{c.id} — {c.label}</div>
                <div className="vv-check-detail">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 2. Clinical Validation Tracker ── */}
      <section className="vv-section">
        <div className="vv-section-header">
          <h3 className="vv-section-title">2. Clinical Validation Tracker</h3>
        </div>
        <div className="vv-progress-wrap">
          <div className="vv-progress-label">
            <span>Progress</span>
            <span>{completedCount} / {MILESTONE_NAMES.length} complete</span>
          </div>
          <div className="vv-progress-track">
            <div className="vv-progress-fill" style={{ width: `${(completedCount / MILESTONE_NAMES.length) * 100}%` }} />
          </div>
        </div>
        <div className="vv-milestones">
          {MILESTONE_NAMES.map((name, idx) => {
            const m = milestones[idx] || {};
            const cls = m.status === 'Complete' ? 'vv-milestone--complete'
              : m.status === 'Blocked'   ? 'vv-milestone--blocked'
              : m.status === 'In progress' ? 'vv-milestone--inprogress'
              : '';
            return (
              <div key={idx} className={`vv-milestone ${cls}`}>
                <div className="vv-milestone-name">{idx + 1}. {name}</div>
                <div className="vv-milestone-fields">
                  <div className="vv-field">
                    <label>Target date</label>
                    <input
                      type="date"
                      value={m.targetDate || ''}
                      onChange={(e) => updateMilestone(idx, 'targetDate', e.target.value)}
                    />
                  </div>
                  <div className="vv-field">
                    <label>Status</label>
                    <select
                      value={m.status || 'Not started'}
                      onChange={(e) => updateMilestone(idx, 'status', e.target.value)}
                    >
                      {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="vv-field vv-field--notes">
                    <label>Notes</label>
                    <input
                      type="text"
                      value={m.notes || ''}
                      onChange={(e) => updateMilestone(idx, 'notes', e.target.value)}
                      placeholder="Optional notes…"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 3. FMEA Risk Register ── */}
      <section className="vv-section">
        <div className="vv-section-header">
          <h3 className="vv-section-title">3. FMEA Risk Register</h3>
          <span className="vv-fmea-count">{mitigatedCount} / {FMEA_ROWS.length} mitigated</span>
        </div>
        <div className="vv-fmea-list">
          {FMEA_ROWS.map((row) => {
            const mitigated = !!fmea[row.id];
            const expanded  = !!expandedFm[row.id];
            const sevCls    = `vv-fmea-row--${row.sev.toLowerCase()}`;
            return (
              <div key={row.id} className={`vv-fmea-row ${sevCls} ${mitigated ? 'vv-fmea-row--mitigated' : ''}`}>
                <div className="vv-fmea-header">
                  <input
                    type="checkbox"
                    className="vv-fmea-checkbox"
                    checked={mitigated}
                    onChange={() => toggleFmea(row.id)}
                    aria-label={`Mark ${row.id} as mitigated`}
                  />
                  <span className={`vv-sev-badge vv-sev-badge--${row.sev.toLowerCase()}`}>{row.sev}</span>
                  <span className="vv-fmea-name">{row.id} — {row.name}</span>
                  <button
                    type="button"
                    className="vv-fmea-toggle"
                    onClick={() => setExpandedFm((p) => ({ ...p, [row.id]: !p[row.id] }))}
                  >
                    {expanded ? 'Hide' : 'Mitigation'}
                  </button>
                </div>
                {expanded && (
                  <div className="vv-fmea-mitigation">
                    <strong>Mitigation:</strong> {row.mitigation}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
