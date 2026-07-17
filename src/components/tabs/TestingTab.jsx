import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight, CheckCircle2, ClipboardList, ListChecks, Lock, Sparkles } from 'lucide-react';
import { calculateDynamicEPsa } from '@epsa/engine';
import { TEST_CASES, DECISION_OPTIONS } from '../../data/testCases.js';
import { fetchTestResponses, submitTestResponse } from '../../services/testingService.js';
import { msalInstance } from '../../config/msal.js';
import './TestingTab.css';

// Live engine result per case — computed once, not stored as a static snapshot,
// so the wizard always reflects the current @epsa/engine logic.
const ENGINE_RESULTS = Object.fromEntries(
  TEST_CASES.map((c) => [c.id, calculateDynamicEPsa(c.formData)])
);

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

function engineSummary(result) {
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

export default function TestingTab() {
  const myEmail = (
    msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0]
  )?.username || '';

  const [view, setView] = useState('test'); // 'test' | 'results'
  const [index, setIndex] = useState(0);
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const currentCase = TEST_CASES[index];
  const engineResult = ENGINE_RESULTS[currentCase.id];
  const engine = engineSummary(engineResult);
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
        decision,
        notes,
        engineScore: engineResult?.calculationDetails?.rawScore ?? null,
        engineTier: engineResult?.epsaTierKey ?? null,
        engineRecommendPSA: engineResult?.recommendPSA ?? null,
      });
      setRevealed(true);
      await load();
      if (index < TEST_CASES.length - 1) setIndex((i) => i + 1);
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const progress = Math.round((answeredCaseIds.size / TEST_CASES.length) * 100);

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
              {answeredCaseIds.size} / {TEST_CASES.length} cases answered
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
              {DECISION_OPTIONS.map((opt) => (
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
                disabled={index === TEST_CASES.length - 1}
                onClick={() => setIndex((i) => Math.min(TEST_CASES.length - 1, i + 1))}
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

const CASE_BY_ID = Object.fromEntries(TEST_CASES.map((c) => [c.id, c]));

function ResultsView({ responses }) {
  if (responses.length === 0) {
    return <div className="loading">No physician responses submitted yet.</div>;
  }

  const sorted = [...responses].sort((a, b) => {
    if (a.caseId !== b.caseId) return a.caseId.localeCompare(b.caseId);
    return (a.physicianName || '').localeCompare(b.physicianName || '');
  });

  return (
    <div className="testing-results-table-wrap">
      <table className="testing-results-table">
        <thead>
          <tr>
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
              <td>{r.caseId}</td>
              <td>{r.physicianName || r.physicianEmail}</td>
              <td>{r.decision}</td>
              <td>{r.engineTier || '—'}</td>
              <td className="testing-results-truth">{CASE_BY_ID[r.caseId]?.groundTruth || '—'}</td>
              <td>{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
