import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Plus } from 'lucide-react';
import { fetchFeatureFlags, updateFeatureFlags } from '../../services/featureFlagsService.js';
import { fetchVoiceServers, updateVoiceServers } from '../../services/voiceServersService.js';

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

      <VoiceServersSection />
    </div>
  );
}

// ── Voice Servers ────────────────────────────────────────────────────────
// Publishes the list of Dr. Tewari voice servers the ePSA app can pick from
// in its narration settings (name shown to the user, URL it POSTs to for
// synthesis). Stored in Firestore at appConfig/voiceServers.
function VoiceServersSection() {
  const [servers, setServers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchVoiceServers();
      setServers(data.servers || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function updateRow(index, field, value) {
    setServers((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setServers((rows) => [...rows, { name: '', url: '' }]);
  }

  function removeRow(index) {
    setServers((rows) => rows.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const cleaned = servers
      .map((s) => ({ name: s.name.trim(), url: s.url.trim() }))
      .filter((s) => s.name && s.url);
    try {
      const updated = await updateVoiceServers(cleaned);
      setServers(updated.servers);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <div className="tab-header-row">
        <h2 className="tab-heading">Voice Servers</h2>
        <button className="icon-btn" onClick={load} title="Refresh">
          <RefreshCw size={15} />
        </button>
      </div>
      <p className="settings-row-desc" style={{ marginBottom: '1rem' }}>
        Servers the ePSA app can choose between for Dr. Tewari's AI voice narration.
        Patients pick one from a dropdown in the narration settings; this list controls
        what shows up there.
      </p>

      {loading ? (
        <div className="loading">Loading voice servers…</div>
      ) : error ? (
        <div className="error-block">
          <p>Could not load voice servers: {error}</p>
          <p className="error-hint">Make sure <code>FIREBASE_SERVICE_ACCOUNT</code> is set as a Cloudflare Pages environment variable.</p>
        </div>
      ) : (
        <>
          {saveError && (
            <div className="error-block">
              <p>Failed to save: {saveError}</p>
            </div>
          )}
          <div className="settings-list">
            {servers.map((s, i) => (
              <div className="settings-row" key={i} style={{ gap: '0.75rem' }}>
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => updateRow(i, 'name', e.target.value)}
                  placeholder="Name (e.g. Production)"
                  style={{ flex: '1 1 160px', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
                />
                <input
                  type="text"
                  value={s.url}
                  onChange={(e) => updateRow(i, 'url', e.target.value)}
                  placeholder="https://voice.example.com"
                  style={{ flex: '2 1 260px', padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
                />
                <button type="button" className="icon-btn" onClick={() => removeRow(i)} title="Remove">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div className="settings-row">
              <button type="button" className="icon-btn" onClick={addRow} title="Add server" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <Plus size={15} /> Add server
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '6px', border: 'none',
              background: 'var(--accent)', color: '#fff', fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save voice servers'}
          </button>
        </>
      )}
    </div>
  );
}
