import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, ClipboardList, ListChecks, Lock, Sparkles, Download } from 'lucide-react';
import { calculateDynamicEPsa, calculateDynamicEPsaPost } from '@epsa/engine';
import { TEST_CASES, DECISION_OPTIONS } from '../../data/testCases.js';
import { TEST_CASES_MODEL2, DECISION_OPTIONS_MODEL2 } from '../../data/testCasesModel2.js';
import { fetchTestResponses, submitTestResponse } from '../../services/testingService.js';
import { msalInstance } from '../../config/msal.js';
import './TestingTab.css';

// Model registry — everything that differs between the pre-PSA (Model 1) and
// post-PSA/imaging (Model 2) test sequences lives here, keyed by model id, so
// the rest of the component doesn't need to branch on which model is active.
const MODELS = {
  model1: {
    label: 'Model 1 — Pre-PSA',
    cases: TEST_CASES,
    decisionOptions: DECISION_OPTIONS,
  },
  model2: {
    label: 'Model 2 — Post-PSA',
    cases: TEST_CASES_MODEL2,
    decisionOptions: DECISION_OPTIONS_MODEL2,
  },
};

// Live engine result per case — computed once, not stored as a static snapshot,
// so the wizard always reflects the current @epsa/engine logic.
const ENGINE_RESULTS_MODEL1 = Object.fromEntries(
  TEST_CASES.map((c) => [c.id, calculateDynamicEPsa(c.formData)])
);
const ENGINE_RESULTS_MODEL2 = Object.fromEntries(
  TEST_CASES_MODEL2.map((c) => {
    const preResult = calculateDynamicEPsa(c.preFormData);
    return [c.id, calculateDynamicEPsaPost(preResult, c.postData)];
  })
);
const ENGINE_RESULTS = { model1: ENGINE_RESULTS_MODEL1, model2: ENGINE_RESULTS_MODEL2 };

// The engine has no standalone "recommend genetic counseling" flag — this reads the same
// hereditary-risk item impacts (BRCA/germline panel, hereditary-cancer family history,
// Ashkenazi ancestry) the engine itself scores, rather than inventing a field it doesn't emit.
const HEREDITARY_RISK_ITEMS = new Set([
  'Genetic mutation',
  'Expanded germline panel',
  'Family history (breast/ovarian/pancreatic)',
  'Ashkenazi Jewish ancestry',
]);
function hasHereditaryRiskFlag(result) {
  return (result?.itemImpacts || []).some((i) => HEREDITARY_RISK_ITEMS.has(i.item) && i.points > 0);
}

function engineSummaryModel1(result) {
  if (!result) return { label: 'Engine error', tier: null, tone: 'error', recommendation: 'Could not compute — check formData', hereditaryRisk: false };
  const hereditaryRisk = hasHereditaryRiskFlag(result);
  if (result.belowMinAge) return { label: 'Below model age range (<40)', tier: null, tone: 'neutral', recommendation: 'No score — model not validated under age 40', hereditaryRisk };
  if (result.aboveMaxScreeningAge) return { label: 'Above model age range (>75)', tier: null, tone: 'neutral', recommendation: 'No score — model not validated above age 75; individualize', hereditaryRisk };
  return {
    label: `Raw score ${result.calculationDetails?.rawScore ?? '?'} / ${result.calculationDetails?.maxScore ?? 80}`,
    tier: result.epsaTierLabel,
    tone: result.epsaTierKey || 'neutral',
    recommendation: result.psaRecommendMessage || (result.recommendPSA ? 'PSA recommended' : 'PSA not recommended by score alone'),
    hereditaryRisk,
  };
}

// part2Tier.key values map onto the same tone classes calculateDynamicEPsa's
// epsaTierKey already uses in TestingTab.css (testing-engine-box--low/
// --intermediate/--elevated/--neutral/--error) — reused for consistent
// styling, not a 1:1 semantic match to Model 1's risk tiers.
const MODEL2_TIER_TONE = {
  normal_routine_interval: 'low',
  unconfirmed_repeat_advised: 'neutral',
  borderline_repeat_advised: 'intermediate',
  gray_zone_confounder_reassess: 'intermediate',
  elevated_imaging_advised: 'elevated',
  urology_red_flag_referral: 'error',
  markedly_elevated_prompt_referral: 'error',
};

function engineSummaryModel2(result) {
  if (!result?.part2Tier) return { label: 'Engine error', tier: null, tone: 'error', recommendation: 'Could not compute — check preFormData/postData', hereditaryRisk: false };
  const tier = result.part2Tier;
  return {
    label: `${tier.label} (${result.totalPoints ?? '?'} pts)`,
    tier: tier.label,
    tone: MODEL2_TIER_TONE[tier.key] || 'neutral',
    recommendation: tier.description,
    hereditaryRisk: false,
  };
}

function engineSummary(model, result) {
  return model === 'model2' ? engineSummaryModel2(result) : engineSummaryModel1(result);
}

export default function TestingTab() {
  const myEmail = (
    msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0]
  )?.username || '';

  const [model, setModel] = useState('model1'); // 'model1' | 'model2'
  const [view, setView] = useState('test'); // 'test' | 'results'
  const [index, setIndex] = useState(0);
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const activeModel = MODELS[model];
  const cases = activeModel.cases;
  const currentCase = cases[index];
  const engineResult = ENGINE_RESULTS[model][currentCase.id];
  const engine = engineSummary(model, engineResult);
  const [revealed, setRevealed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setResponses(await fetchTestResponses());
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Switching models resets to the first case of that sequence — the two
  // sets use disjoint id prefixes (C0x / P0x) so `index` alone can't carry
  // over meaningfully between them.
  function switchModel(next) {
    if (next === model) return;
    setModel(next);
    setIndex(0);
  }

  // Restore this case's own prior answer (if the signed-in physician already submitted one)
  useEffect(() => {
    setSubmitError(null);
    const mine = responses.find((r) => r.caseId === currentCase.id && r.physicianEmail === myEmail);
    setDecision(mine?.decision || '');
    setNotes(mine?.notes || '');
    setRevealed(!!mine);
  }, [index, currentCase.id, responses, myEmail]);

  const answeredCaseIds = useMemo(
    () => new Set(responses.filter((r) => r.physicianEmail === myEmail).map((r) => r.caseId)),
    [responses, myEmail]
  );

  async function handleSubmit() {
    if (!decision) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitTestResponse({
        caseId: currentCase.id,
        model,
        decision,
        notes,
        engineScore: model === 'model2' ? (engineResult?.totalPoints ?? null) : (engineResult?.calculationDetails?.rawScore ?? null),
        engineTier: model === 'model2' ? (engineResult?.part2Tier?.key ?? null) : (engineResult?.epsaTierKey ?? null),
        engineTierLabel: model === 'model2' ? (engineResult?.part2Tier?.label ?? null) : (engineResult?.epsaTierLabel ?? null),
        engineRecommendPSA: model === 'model2' ? null : (engineResult?.recommendPSA ?? null),
      });
      setRevealed(true);
      await load();
      if (index < cases.length - 1) setIndex((i) => i + 1);
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const progress = Math.round((answeredCaseIds.size / cases.length) * 100);

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">ePSA Test Sequence</h2>
        <div className="testing-view-toggle">
          <button
            type="button"
            className={`testing-view-btn${view === 'test' ? ' testing-view-btn--active' : ''}`}
            onClick={() => setView('test')}
          >
            <ClipboardList size={14} /> Take test
          </button>
          <button
            type="button"
            className={`testing-view-btn${view === 'results' ? ' testing-view-btn--active' : ''}`}
            onClick={() => setView('results')}
          >
            <ListChecks size={14} /> All results ({responses.length})
          </button>
          <button className="icon-btn" onClick={load} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {view === 'test' && (
        <div className="testing-model-toggle">
          {Object.entries(MODELS).map(([key, m]) => (
            <button
              key={key}
              type="button"
              className={`testing-view-btn${model === key ? ' testing-view-btn--active' : ''}`}
              onClick={() => switchModel(key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="loading">Loading test sequence…</div>
      ) : loadError ? (
        <div className="error-block">
          <p>Could not load responses: {loadError}</p>
          <p className="error-hint">Make sure <code>FIREBASE_SERVICE_ACCOUNT</code> is set as a Cloudflare Pages environment variable.</p>
        </div>
      ) : view === 'results' ? (
        <ResultsView responses={responses} />
      ) : (
        <>
          <div className="testing-progress">
            <div className="testing-progress-bar">
              <div className="testing-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="testing-progress-label">
              {answeredCaseIds.size} / {cases.length} cases answered
            </span>
          </div>

          <div className="testing-card">
            <div className="testing-card-head">
              <span className="testing-case-id">{currentCase.id}</span>
              {answeredCaseIds.has(currentCase.id) && (
                <span className="testing-answered-badge"><CheckCircle2 size={13} /> Answered</span>
              )}
            </div>
            <p className="testing-case-desc">{currentCase.description}</p>

            {revealed ? (
              <div className={`testing-engine-box testing-engine-box--${engine.tone}`}>
                <div className="testing-engine-label">
                  <Sparkles size={12} /> Live @epsa/engine output
                </div>
                <div className="testing-engine-row testing-engine-row--headline">
                  {engine.tier && <span className="testing-engine-tier-badge">{engine.tier}</span>}
                  {engine.label}
                </div>
                <div className="testing-engine-row testing-engine-row--muted">{engine.recommendation}</div>
                {engine.hereditaryRisk && (
                  <div className="testing-engine-row testing-engine-counseling">Hereditary risk factor scored (germline mutation / hereditary-cancer family history / Ashkenazi ancestry)</div>
                )}
              </div>
            ) : (
              <div className="testing-engine-box testing-engine-box--hidden">
                <div className="testing-engine-label">
                  <Lock size={12} /> Engine result hidden
                </div>
                <div className="testing-engine-row testing-engine-row--muted">
                  Make your decision first — the @epsa/engine result reveals once you submit, so it doesn't bias your read of the case.
                </div>
              </div>
            )}

            <div className="testing-decision-group">
              {activeModel.decisionOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`testing-decision-btn${decision === opt ? ' testing-decision-btn--active' : ''}`}
                  onClick={() => setDecision(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>

            <textarea
              className="testing-notes"
              placeholder="Optional notes / rationale…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />

            {submitError && (
              <div className="error-block">
                <p>Failed to submit: {submitError}</p>
              </div>
            )}

            <div className="testing-nav-row">
              <button
                type="button"
                className="testing-nav-btn"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft size={15} /> Previous
              </button>

              <button
                type="button"
                className="testing-submit-btn"
                disabled={!decision || submitting}
                onClick={handleSubmit}
              >
                {submitting ? 'Saving…' : 'Submit & Next'}
              </button>

              <button
                type="button"
                className="testing-nav-btn"
                disabled={index === cases.length - 1}
                onClick={() => setIndex((i) => Math.min(cases.length - 1, i + 1))}
              >
                Next <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Merged lookup across both models — case ids are disjoint (C0x / P0x), so a
// single map is safe and lets the results view work across both without
// needing every response row to already carry a reliable `model` field.
const CASE_BY_ID = Object.fromEntries([...TEST_CASES, ...TEST_CASES_MODEL2].map((c) => [c.id, c]));

// Responses submitted before the `model` field existed have no way to say
// which sequence they belong to — fall back to the id prefix, which has
// been the one reliable distinguisher between the two sets from the start.
function responseModel(r) {
  return r.model || (r.caseId?.startsWith('P') ? 'model2' : 'model1');
}

function ResultsView({ responses }) {
  if (responses.length === 0) {
    return <div className="loading">No physician responses submitted yet.</div>;
  }

  const sorted = [...responses].sort((a, b) => {
    const modelCmp = responseModel(a).localeCompare(responseModel(b));
    if (modelCmp !== 0) return modelCmp;
    if (a.caseId !== b.caseId) return a.caseId.localeCompare(b.caseId);
    return (a.physicianName || '').localeCompare(b.physicianName || '');
  });

  const downloadCsv = () => {
    const headers = [
      'Model',
      'Case',
      'Physician',
      'Physician decision',
      'Engine tier @ submission',
      'Panel ground truth',
      'Submitted',
    ];
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = sorted.map((r) => [
      MODELS[responseModel(r)]?.label || responseModel(r),
      r.caseId,
      r.physicianName || r.physicianEmail,
      r.decision,
      r.engineTierLabel || r.engineTier || '',
      CASE_BY_ID[r.caseId]?.groundTruth || '',
      r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '',
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `physician-testing-results-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="testing-results-table-wrap">
      <div className="testing-results-actions">
        <button type="button" className="testing-nav-btn" onClick={downloadCsv}>
          <Download size={15} /> Download CSV
        </button>
      </div>
      <table className="testing-results-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Case</th>
            <th>Physician</th>
            <th>Physician decision</th>
            <th>Engine tier @ submission</th>
            <th>Panel ground truth</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>{MODELS[responseModel(r)]?.label || responseModel(r)}</td>
              <td>{r.caseId}</td>
              <td>{r.physicianName || r.physicianEmail}</td>
              <td>{r.decision}</td>
              <td>{r.engineTierLabel || r.engineTier || '—'}</td>
              <td className="testing-results-truth">{CASE_BY_ID[r.caseId]?.groundTruth || '—'}</td>
              <td>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
