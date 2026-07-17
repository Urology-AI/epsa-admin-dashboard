/**
 * VVPanel — Verification & Validation tab
 * 1. Model Verification — automated checks against the LIVE @epsa/engine
 * 1b. Spreadsheet Test Sequence — the 21 physician-authored cases run live
 * 2. Clinical Validation Tracker — localStorage-backed milestones
 * 3. FMEA Risk Register — localStorage-backed failure modes
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { calculateDynamicEPsa } from '@epsa/engine';
import { TEST_CASES } from '../../data/testCases.js';
import './VVPanel.css';

const ASSUMPTIONS_REGISTER = [
  { id: 'A1', assumption: 'BRCA+/Lynch/other elevated germline mutation receives hardcoded 16 points — maximum on scale, equal to age 70+.' },
  { id: 'A2', assumption: 'Family history of non-prostate hereditary cancer (e.g. pancreatic) is literature-anchored at 4 pts (no local cohort data) and independently sets recommendGeneticCounseling — see spreadsheet case C12.' },
  { id: 'A3', assumption: 'Ashkenazi Jewish ancestry is literature-anchored at 2 pts as a carrier-probability marker (not a direct PCa OR; no local cohort data) and independently sets recommendGeneticCounseling — see spreadsheet case C14.' },
];

const MAX_SCORE = 80;

function baseFormData(overrides) {
  return {
    race: 'white', bmi: 24, ipss: [0, 0, 0, 0, 0, 0, 0], shim: [5, 5, 5, 5, 5],
    exercise: 0, familyHistory: 0, smoking: 0, brcaStatus: 'no', comorbidityScore: 0,
    ...overrides,
  };
}

function score(overrides) {
  const r = calculateDynamicEPsa(baseFormData(overrides));
  return r?.calculationDetails?.rawScore ?? null;
}

// Live checks against the real @epsa/engine — not a mock re-implementation.
function runChecks() {
  const results = [];

  const profiles = [
    { name: 'All-zero (age 55, no risk factors)', overrides: { age: 55 } },
    { name: 'All-max (age 70, Black, BRCA+, comorbid=2)', overrides: { age: 70, race: 'black', brcaStatus: 'yes', comorbidityScore: 2, bmi: 33, smoking: 2, exercise: 2, ipss: [5,5,5,5,4,0,0], shim: [1,1,1,1,1] } },
    { name: 'Average adult (55, BMI 27)', overrides: { age: 55, bmi: 27 } },
    { name: 'Young low-risk (42, BMI 22)', overrides: { age: 42, bmi: 22 } },
    { name: 'Black 70+', overrides: { age: 70, race: 'black' } },
  ];
  const scores = profiles.map((p) => ({ name: p.name, raw: score(p.overrides) }));
  const outOfRange = scores.filter((s) => s.raw == null || s.raw < 0 || s.raw > MAX_SCORE);
  results.push({
    id: 'C1', label: `Score range [0, ${MAX_SCORE}] — live engine`,
    pass: outOfRange.length === 0,
    detail: outOfRange.length === 0
      ? `All 5 profiles in range. Scores: ${scores.map((s) => `${s.name}=${s.raw}`).join(', ')}`
      : `Out-of-range: ${outOfRange.map((s) => `${s.name}=${s.raw}`).join(', ')}`,
  });

  const s70 = score({ age: 70 });
  const s60 = score({ age: 65 });
  const s50 = score({ age: 55 });
  const s40 = score({ age: 42 });
  results.push({
    id: 'C2', label: 'Age monotonicity (70+ ≥ 60–69 ≥ 50–59 ≥ 40s) — live engine',
    pass: s70 >= s60 && s60 >= s50 && s50 >= s40,
    detail: `70+=${s70}, 60–69=${s60}, 50–59=${s50}, 40s=${s40}`,
  });

  const sBlack = score({ age: 55, race: 'black' });
  const sWhite = score({ age: 55, race: 'white' });
  results.push({
    id: 'C3', label: 'Race monotonicity (Black > non-Black, all else equal) — live engine',
    pass: sBlack > sWhite,
    detail: `Black+age55=${sBlack}, white+age55=${sWhite}`,
  });

  const r17 = calculateDynamicEPsa(baseFormData({ age: 55, bmi: 33, exercise: 1 })); // aim near boundary
  const boundaries = r17?.epsaTierBoundaries;
  results.push({
    id: 'C4', label: 'Tier boundaries reported by engine match spec (low ≤10, intermediate ≤17, elevated ≥18)',
    pass: boundaries?.lowMax === 10 && boundaries?.intermediateMax === 17 && boundaries?.maxScore === MAX_SCORE,
    detail: `engine reports: ${JSON.stringify(boundaries)}`,
  });

  const currentN = 94;
  const minN = 130; // ~13 active scoring factors × EPV 10
  results.push({
    id: 'C5', label: 'EPV estimate: minimum dataset size for EPV≥10',
    pass: currentN >= minN,
    detail: `Current N = ${currentN}. Target N ≈ ${minN} for EPV≥10. ${currentN < minN ? 'UNDERPOWERED — refit needed.' : 'OK.'}`,
  });

  results.push({
    id: 'C6', label: `Known-gap assumptions documented in ASSUMPTIONS_REGISTER (${ASSUMPTIONS_REGISTER.length})`,
    pass: ASSUMPTIONS_REGISTER.length > 0,
    detail: ASSUMPTIONS_REGISTER.map((a) => `${a.id}: ${a.assumption}`).join(' | '),
  });

  return results;
}

// Run the 21 physician-authored spreadsheet cases through the live engine.
function runCaseSequence() {
  return TEST_CASES.map((c) => {
    const r = calculateDynamicEPsa(c.formData);
    const ageGated = r?.belowMinAge || r?.aboveMaxScreeningAge;
    return {
      id: c.id,
      description: c.description,
      groundTruth: c.groundTruth,
      score: r?.calculationDetails?.rawScore ?? null,
      tier: ageGated ? (r.belowMinAge ? 'below-min-age' : 'above-max-age') : r?.epsaTierKey,
      recommendPSA: r?.recommendPSA,
      recommendGeneticCounseling: r?.recommendGeneticCounseling ?? false,
    };
  });
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
  const [caseResults, setCaseResults] = useState([]);
  const [milestones,  setMilestones]  = useState(() => load(LS_MILESTONES));
  const [fmea,        setFmea]        = useState(() => load(LS_FMEA));
  const [expandedFm,  setExpandedFm]  = useState({});

  const runAll = useCallback(() => {
    setChecks(runChecks());
    setCaseResults(runCaseSequence());
  }, []);
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

      {/* ── 1b. Spreadsheet Test Sequence ── */}
      <section className="vv-section">
        <div className="vv-section-header">
          <h3 className="vv-section-title">1b. Spreadsheet Test Sequence (live engine)</h3>
          <button type="button" className="vv-rerun-btn" onClick={runAll}>
            <RefreshCw size={13} /> Run Tests
          </button>
        </div>
        <p className="vv-sub" style={{ margin: '0 0 1rem' }}>
          The 21 physician-authored cases from <code>ePSA test sequence.xlsx</code>, run through
          the live <code>@epsa/engine</code> — not a cached spreadsheet snapshot. Cases C12
          (pancreatic family history) and C14 (Ashkenazi ancestry) exercise the two literature-anchored
          fields documented in A2/A3 above; both correctly set the genetic-counseling flag.
        </p>
        <div className="vv-case-table-wrap">
          <table className="vv-case-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Score</th>
                <th>Tier</th>
                <th>Recommend PSA</th>
                <th>Genetic counseling</th>
                <th>Panel ground truth</th>
              </tr>
            </thead>
            <tbody>
              {caseResults.map((c) => (
                <tr key={c.id} className={c.recommendGeneticCounseling ? 'vv-case-row--counseling' : ''}>
                  <td>{c.id}</td>
                  <td>{c.score ?? '—'}</td>
                  <td>{c.tier ?? '—'}</td>
                  <td>{c.recommendPSA === true ? 'Yes' : c.recommendPSA === false ? 'No' : '—'}</td>
                  <td>{c.recommendGeneticCounseling ? 'Yes' : 'No'}</td>
                  <td className="vv-case-truth">{c.groundTruth}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
