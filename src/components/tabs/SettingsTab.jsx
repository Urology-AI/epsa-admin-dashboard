import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchFeatureFlags, updateFeatureFlags } from '../../services/featureFlagsService.js';

const FLAG_DEFS = [
  {
    key: 'biomarkersEnabled',
    label: 'Advanced Biomarkers step',
    description:
      'When off, the ePSA app skips the Biomarkers step entirely (PSA goes straight to MRI) and hides biomarker content from results. All biomarker code stays in place — this only controls whether patients see it.',
  },
];

export default function SettingsTab() {
  const [flags, setFlags] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFlags(await fetchFeatureFlags());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(key) {
    if (!flags) return;
    const nextValue = !flags[key];
    setSavingKey(key);
    setSaveError(null);
    // Optimistic update
    setFlags((f) => ({ ...f, [key]: nextValue }));
    try {
      const updated = await updateFeatureFlags({ [key]: nextValue });
      setFlags(updated);
    } catch (e) {
      // Roll back on failure
      setFlags((f) => ({ ...f, [key]: !nextValue }));
      setSaveError(e.message);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="tab-content">
      <div className="tab-header-row">
        <h2 className="tab-heading">Settings — Feature Flags</h2>
        <button className="icon-btn" onClick={load} title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading flags…</div>
      ) : error ? (
        <div className="error-block">
          <p>Could not load feature flags: {error}</p>
          <p className="error-hint">Make sure <code>FIREBASE_SERVICE_ACCOUNT</code> is set as a Cloudflare Pages environment variable.</p>
        </div>
      ) : (
        <div className="settings-list">
          {saveError && (
            <div className="error-block">
              <p>Failed to save: {saveError}</p>
            </div>
          )}
          {FLAG_DEFS.map(({ key, label, description }) => (
            <div className="settings-row" key={key}>
              <div className="settings-row-body">
                <div className="settings-row-label">{label}</div>
                <div className="settings-row-desc">{description}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!flags[key]}
                disabled={savingKey === key}
                className={`settings-toggle${flags[key] ? ' settings-toggle--on' : ''}`}
                onClick={() => handleToggle(key)}
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
