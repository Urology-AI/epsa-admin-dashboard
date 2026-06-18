/**
 * VVPanel — Verification & Validation tab for the ePSA Admin Dashboard.
 * Contains three sections:
 *   1. Model Verification (automated checks run on mount)
 *   2. Clinical Validation Tracker (localStorage-backed milestone table)
 *   3. FMEA Risk Register (localStorage-backed failure-mode table)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';

// ─── Inline config snapshot (avoids cross-package import issues) ──────────────
// Keep in sync with frontend/src/config/calculatorConfig.js DEFAULT_CALCULATOR_CONFIG
const CONFIG_PART1_VARIABLES = [
  { id: 'age_50_59',                 weight:  0.515273 },
  { id: 'age_60_69',                 weight:  0.267338 },
  { id: 'age_70_plus',               weight:  0.112174 },
  { id: 'bmi_25_29_9',               weight:  1.109121 },
  { id: 'bmi_ge_30',                 weight:  0.479419 },
  { id: 'ipss_moderate',             weight: -0.572095 },
  { id: 'ipss_severe',               weight: -0.054009 },
  { id: 'exercise_some',             weight:  0.040351 },
  { id: 'exercise_none',             weight:  0.419234 },
  { id: 'raceBlack',                 weight:  0.744867 },
  { id: 'fhBinary',                  weight: -0.647446 },
  { id: 'age60plus_x_ipss_moderate', weight: -0.105186 },
  { id: 'age60plus_x_ipss_severe',   weight: -0.129447 },
];

const ASSUMPTIONS_REGISTER = {
  assumptions: [
    { id: 'A1', variable: 'brcaStatus', assumption: 'BRCA+ receives hardcoded 16 points — maximum on scale, equal to age 70+.', risk: 'CRITICAL' },
    { id: 'A2', variable: 'fhBinary', assumption: 'Family history weight is negative (−0.647) in current fit — clinically counterintuitive.', risk: 'HIGH' },
    { id: 'A3', variable: 'ipss_moderate / ipss_severe', assumption: 'IPSS moderate and severe weights are negative in current fit.', risk: 'MODERATE' },
    { id: 'A4', variable: 'chemicalExposure', assumption: 'Chemical/occupational exposure is collected but has no model weight (0 contribution to score).', risk: 'LOW' },
    { id: 'A5', variable: 'Part 2 base model (logPSA only)', assumption: 'Base model (no MRI) uses intercept −1.439 and logPSA +0.188 trained on GG≥3 outcome. AUC 0.378 on GG≥2 — below chance.', risk: 'CRITICAL' },
  ],
};

// ─── Score computation helper ─────────────────────────────────────────────────
const SCORE_POINTS = {
  age_50_59:                 { pts: 4, label: 'Age 50–59' },
  age_60_69:                 { pts: 3, label: 'Age 60–69' },
  age_70_plus:               { pts: 2, label: 'Age 70+' },
  bmi_25_29_9:               { pts: 9, label: 'BMI 25–29.9' },
  bmi_ge_30:                 { pts: 4, label: 'BMI ≥30' },
  ipss_moderate:             { pts: 0, label: 'IPSS moderate' },
  ipss_severe:               { pts: 0, label: 'IPSS severe' },
  exercise_some:             { pts: 1, label: 'Exercise some' },
  exercise_none:             { pts: 4, label: 'Exercise none' },
  raceBlack:                 { pts: 7, label: 'Black race' },
  fhBinary:                  { pts: 0, label: 'Family history' },
  age60plus_x_ipss_moderate: { pts: 0, label: 'Age60+ × IPSS mod' },
  age60plus_x_ipss_severe:   { pts: 0, label: 'Age60+ × IPSS sev' },
};

const MAX_SCORE = 80;

function computeScore(activeVarIds) {
  return activeVarIds.reduce((sum, id) => sum + (SCORE_POINTS[id]?.pts ?? 0), 0);
}

function tierFromRaw(raw) {
  if (raw >= 18) return 'elevated';
  if (raw >= 11) return 'intermediate';
  return 'low';
}

// ─── Check runner ─────────────────────────────────────────────────────────────
function runChecks() {
  const results = [];

  // Check 1 — Score range
  const profiles = [
    { name: 'All-zero', vars: [] },
    { name: 'All-max', vars: ['age_50_59', 'bmi_25_29_9', 'exercise_none', 'raceBlack'] },
    { name: 'Average adult (55, BMI 27)', vars: ['age_50_59', 'bmi_25_29_9'] },
    { name: 'Young low-risk (42, BMI 22)', vars: [] },
    { name: 'Black 70+ (age_70_plus, raceBlack)', vars: ['age_70_plus', 'raceBlack'] },
  ];
  const scores = profiles.map(p => ({ name: p.name, raw: computeScore(p.vars) }));
  const outOfRange = scores.filter(s => s.raw < 0 || s.raw > MAX_SCORE);
  results.push({
    id: 'C1',
    label: 'Score range [0, 80]',
    pass: outOfRange.length === 0,
    detail: outOfRange.length === 0
      ? `All 5 profiles in range. Scores: ${scores.map(s => `${s.name}=${s.raw}`).join(', ')}`
      : `Out-of-range: ${outOfRange.map(s => `${s.name}=${s.raw}`).join(', ')}`,
  });

  // Check 2 — Age monotonicity
  const s70 = computeScore(['age_70_plus']);
  const s60 = computeScore(['age_60_69']);
  const s50 = computeScore(['age_50_59']);
  const s0  = computeScore([]);
  const ageMono = s70 >= s60 && s60 >= s50 && s50 >= s0;
  results.push({
    id: 'C2',
    label: 'Age monotonicity (70+ ≥ 60–69 ≥ 50–59 ≥ baseline)',
    pass: ageMono,
    detail: `70+=${s70}, 60–69=${s60}, 50–59=${s50}, baseline=${s0}`,
  });

  // Check 3 — Race monotonicity
  const sBlack = computeScore(['raceBlack', 'age_50_59']);
  const sWhite = computeScore(['age_50_59']);
  results.push({
    id: 'C3',
    label: 'Race monotonicity (Black > non-Black, all else equal)',
    pass: sBlack > sWhite,
    detail: `Black+age50-59=${sBlack}, white+age50-59=${sWhite}`,
  });

  // Check 4 — Tier boundary
  const raw17 = 17;
  const raw18 = 18;
  const tier17 = tierFromRaw(raw17);
  const tier18 = tierFromRaw(raw18);
  results.push({
    id: 'C4',
    label: 'Tier boundary: rawScore 17→intermediate, 18→elevated',
    pass: tier17 === 'intermediate' && tier18 === 'elevated',
    detail: `rawScore=17 → "${tier17}" (expected "intermediate"), rawScore=18 → "${tier18}" (expected "elevated")`,
  });

  // Check 5 — EPV estimate
  const nVars = CONFIG_PART1_VARIABLES.length;
  const minN = nVars * 10;
  const currentN = 94;
  results.push({
    id: 'C5',
    label: `EPV estimate: minimum dataset size for EPV≥10`,
    pass: currentN >= minN,
    detail: `${nVars} variables → minimum N = ${minN} events. Current N = ${currentN}. ${currentN < minN ? 'UNDERPOWERED — refit needed.' : 'OK.'}`,
    flagRed: currentN < minN,
  });

  // Check 6 — BRCA override assumption documented
  const a1 = ASSUMPTIONS_REGISTER.assumptions.find(a => a.id === 'A1');
  results.push({
    id: 'C6',
    label: 'BRCA hardcode assumption documented in ASSUMPTIONS_REGISTER',
    pass: !!a1,
    detail: a1 ? `A1: ${a1.assumption}` : 'A1 not found in ASSUMPTIONS_REGISTER.',
  });

  return results;
}

// ─── FMEA data ─────────────────────────────────────────────────────────────────
const FMEA_ROWS = [
  { id: 'FM1',  name: 'False LOW score — high-risk man not referred',       sev: 'CRITICAL', mitigation: 'Dual-pathway: any AUA Grade A factor triggers referral regardless of score' },
  { id: 'FM2',  name: 'False HIGH score — unnecessary referral',             sev: 'MODERATE', mitigation: 'Consent explains 10–15% FPR; score is a screening aid not a diagnosis' },
  { id: 'FM3',  name: 'Default values accepted uncritically',                sev: 'MODERATE', mitigation: 'Defaults badge warns users; REDCap required fields prevent empty submission' },
  { id: 'FM4',  name: 'Model weight mismatch after refit',                   sev: 'CRITICAL', mitigation: 'Weight-integrity test suite runs on every refit; VV panel Check 1–5 must pass' },
  { id: 'FM5',  name: 'REDCap submission failure — silent data loss',        sev: 'HIGH',     mitigation: 'Submission returns success/error state; UI shows confirmation; logs retained' },
  { id: 'FM6',  name: 'EPV < 10 — model statistically underpowered',         sev: 'HIGH',     mitigation: 'EPV flagged in VV panel; paper discloses; refit gated on N≥600' },
  { id: 'FM7',  name: 'Race field unknown or defaulted to white',            sev: 'HIGH',     mitigation: 'Race field required (no default); Unknown option available; flagged in output' },
  { id: 'FM8',  name: 'HIPAA breach',                                        sev: 'CRITICAL', mitigation: 'No PHI stored; session ref is non-identifying; Cloudflare access controls' },
  { id: 'FM9',  name: 'Therac-25: undocumented assumption in new context',   sev: 'HIGH',     mitigation: 'ASSUMPTIONS_REGISTER documents all overrides; VV panel Check 6 verifies' },
  { id: 'FM10', name: 'User misinterprets score as a diagnosis',             sev: 'MODERATE', mitigation: 'Disclaimer on every result screen; score described as \'pre-screening\' not diagnosis' },
  { id: 'FM11', name: 'Biopsy adverse event attributed to ePSA',             sev: 'MODERATE', mitigation: 'Consent form clarifies ePSA is a referral aid; biopsy decision rests with urologist' },
  { id: 'FM12', name: 'PSA not corrected for finasteride/dutasteride',       sev: 'HIGH',     mitigation: '5-ARI field collected; engine applies 2x PSA correction when 5-ARI=1' },
];

const SEV_COLORS = {
  CRITICAL: { border: '#dc2626', bg: '#fef2f2', badge: '#dc2626', text: '#991b1b' },
  HIGH:     { border: '#d97706', bg: '#fffbeb', badge: '#d97706', text: '#92400e' },
  MODERATE: { border: '#2563eb', bg: '#eff6ff', badge: '#2563eb', text: '#1e40af' },
};

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

const LS_MILESTONES = 'epsa_vv_milestones';
const LS_FMEA = 'epsa_vv_fmea';

function loadMilestones() {
  try { return JSON.parse(localStorage.getItem(LS_MILESTONES)) || {}; } catch { return {}; }
}
function saveMilestones(data) {
  try { localStorage.setItem(LS_MILESTONES, JSON.stringify(data)); } catch {}
}
function loadFmea() {
  try { return JSON.parse(localStorage.getItem(LS_FMEA)) || {}; } catch { return {}; }
}
function saveFmea(data) {
  try { localStorage.setItem(LS_FMEA, JSON.stringify(data)); } catch {}
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function VVPanel() {
  const [checks, setChecks] = useState([]);
  const [milestones, setMilestones] = useState(loadMilestones);
  const [fmea, setFmea] = useState(loadFmea);
  const [expandedFmea, setExpandedFmea] = useState({});

  const runAllChecks = useCallback(() => {
    setChecks(runChecks());
  }, []);

  useEffect(() => { runAllChecks(); }, [runAllChecks]);

  const updateMilestone = (idx, field, value) => {
    setMilestones(prev => {
      const next = { ...prev, [idx]: { ...(prev[idx] || {}), [field]: value } };
      saveMilestones(next);
      return next;
    });
  };

  const toggleFmea = (id) => {
    setFmea(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveFmea(next);
      return next;
    });
  };

  const completedMilestones = MILESTONE_NAMES.filter((_, i) => milestones[i]?.status === 'Complete').length;
  const mitigatedFmea = FMEA_ROWS.filter(r => fmea[r.id]).length;

  return (
    <div style={{ padding: '24px', maxWidth: '960px', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '4px', color: '#111827' }}>Verification &amp; Validation</h2>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '28px' }}>Model integrity checks, clinical validation milestones, and FMEA risk register.</p>

      {/* ── Section 1: Model Verification ── */}
      <section style={{ marginBottom: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', margin: 0 }}>1. Model Verification</h3>
          <button
            type="button"
            onClick={runAllChecks}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
          >
            <RefreshCw size={13} /> Re-run Checks
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {checks.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', background: c.pass ? '#f0fdf4' : '#fef2f2', border: `1px solid ${c.pass ? '#86efac' : '#fca5a5'}`, borderLeft: `4px solid ${c.pass ? '#16a34a' : (c.flagRed ? '#dc2626' : '#dc2626')}`, borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ marginTop: '1px', flexShrink: 0 }}>
                {c.pass
                  ? <CheckCircle size={16} color="#16a34a" />
                  : <XCircle size={16} color="#dc2626" />}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: c.pass ? '#166534' : '#991b1b' }}>{c.id} — {c.label}</div>
                <div style={{ fontSize: '12px', color: '#374151', marginTop: '2px' }}>{c.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 2: Clinical Validation Tracker ── */}
      <section style={{ marginBottom: '36px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '14px' }}>2. Clinical Validation Tracker</h3>

        {/* Progress bar */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#374151', marginBottom: '6px' }}>
            <span>Progress</span>
            <span style={{ fontWeight: 600 }}>{completedMilestones} / 8 complete</span>
          </div>
          <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(completedMilestones / 8) * 100}%`, background: '#16a34a', borderRadius: '999px', transition: 'width 0.3s' }} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {MILESTONE_NAMES.map((name, idx) => {
            const m = milestones[idx] || {};
            const isComplete = m.status === 'Complete';
            const isBlocked = m.status === 'Blocked';
            return (
              <div key={idx} style={{ background: isComplete ? '#f0fdf4' : isBlocked ? '#fef2f2' : '#f9fafb', border: `1px solid ${isComplete ? '#86efac' : isBlocked ? '#fca5a5' : '#e5e7eb'}`, borderRadius: '8px', padding: '12px 14px' }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: '#111827', marginBottom: '8px' }}>{idx + 1}. {name}</div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>Target date</label>
                    <input
                      type="date"
                      value={m.targetDate || ''}
                      onChange={e => updateMilestone(idx, 'targetDate', e.target.value)}
                      style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '5px' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>Status</label>
                    <select
                      value={m.status || 'Not started'}
                      onChange={e => updateMilestone(idx, 'status', e.target.value)}
                      style={{ fontSize: '12px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '5px' }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ fontSize: '11px', color: '#6b7280', display: 'block', marginBottom: '3px' }}>Notes</label>
                    <input
                      type="text"
                      value={m.notes || ''}
                      onChange={e => updateMilestone(idx, 'notes', e.target.value)}
                      placeholder="Optional notes…"
                      style={{ width: '100%', fontSize: '12px', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: '5px', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Section 3: FMEA Risk Register ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', margin: 0 }}>3. FMEA Risk Register</h3>
          <span style={{ fontSize: '13px', color: '#374151', fontWeight: 600 }}>{mitigatedFmea} / 12 mitigated</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {FMEA_ROWS.map(row => {
            const sev = SEV_COLORS[row.sev] || SEV_COLORS.MODERATE;
            const mitigated = !!fmea[row.id];
            const expanded = !!expandedFmea[row.id];
            return (
              <div key={row.id} style={{ background: mitigated ? '#f0fdf4' : sev.bg, border: `1px solid ${mitigated ? '#86efac' : '#e5e7eb'}`, borderLeft: `4px solid ${mitigated ? '#16a34a' : sev.border}`, borderRadius: '8px', padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="checkbox"
                    checked={mitigated}
                    onChange={() => toggleFmea(row.id)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                    aria-label={`Mark ${row.id} as mitigated`}
                  />
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '999px', background: sev.badge, color: '#fff', flexShrink: 0 }}>{row.sev}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827', flex: 1 }}>{row.id} — {row.name}</span>
                  <button
                    type="button"
                    onClick={() => setExpandedFmea(prev => ({ ...prev, [row.id]: !prev[row.id] }))}
                    style={{ fontSize: '11px', color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px' }}
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Hide' : 'Mitigation'}
                  </button>
                </div>
                {expanded && (
                  <div style={{ marginTop: '8px', paddingLeft: '26px', fontSize: '12px', color: '#374151', lineHeight: 1.6 }}>
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
