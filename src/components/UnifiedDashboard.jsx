import React, { useState, useEffect, useCallback } from 'react';
import { LogOut, LayoutDashboard, MonitorSmartphone, Calculator, Database, ShieldCheck, Settings } from 'lucide-react';
import { isTursoConfigured, fetchScreeningSessions, fetchScreeningStats } from '../services/tursoService.js';
import { fetchCalculatorSessions } from '../services/firebaseService.js';
import { isRedcapConfigured, fetchRedcapRecords } from '../services/redcapService.js';
import OverviewTab    from './tabs/OverviewTab.jsx';
import ScreeningTab   from './tabs/ScreeningTab.jsx';
import CalculatorTab  from './tabs/CalculatorTab.jsx';
import RedcapTab      from './tabs/RedcapTab.jsx';
import VVPanel        from './tabs/VVPanel.jsx';
import SettingsTab    from './tabs/SettingsTab.jsx';
import './UnifiedDashboard.css';

const TABS = [
  { id: 'overview',   label: 'Overview',                  Icon: LayoutDashboard },
  { id: 'screening',  label: 'Screening (Turso)',          Icon: MonitorSmartphone },
  { id: 'calculator', label: 'Calculator (Firebase)',       Icon: Calculator },
  { id: 'redcap',     label: 'REDCap Sinai',               Icon: Database },
  { id: 'vv',         label: 'Verification & Validation',  Icon: ShieldCheck },
  { id: 'settings',   label: 'Settings',                   Icon: Settings },
];

// status: 'loading' | 'ok' | 'error' | 'off'
function initStatus(configured) {
  return configured ? 'loading' : 'off';
}

export default function UnifiedDashboard({ onLogout }) {
  const [tab, setTab] = useState('overview');

  // Screening (Turso)
  const [screeningSessions, setScreeningSessions] = useState([]);
  const [screeningStats,    setScreeningStats]    = useState(null);
  const [screeningLoading,  setScreeningLoading]  = useState(false);
  const [screeningError,    setScreeningError]    = useState(null);

  // Calculator (Firebase)
  const [calcSessions, setCalcSessions] = useState([]);
  const [calcLoading,  setCalcLoading]  = useState(false);
  const [calcError,    setCalcError]    = useState(null);

  // REDCap
  const [redcapRecords, setRedcapRecords] = useState([]);
  const [redcapIds,     setRedcapIds]     = useState(null);
  const [redcapLoading, setRedcapLoading] = useState(false);
  const [redcapError,   setRedcapError]   = useState(null);

  // Source health: 'loading' | 'ok' | 'error' | 'off'
  const [sourceStatus, setSourceStatus] = useState({
    turso:    initStatus(isTursoConfigured()),
    firebase: 'loading',
    redcap:   initStatus(isRedcapConfigured()),
  });

  const loadScreening = useCallback(async () => {
    if (!isTursoConfigured()) {
      setSourceStatus((s) => ({ ...s, turso: 'off' }));
      return;
    }
    setScreeningLoading(true);
    setScreeningError(null);
    try {
      const [sessions, stats] = await Promise.all([
        fetchScreeningSessions(),
        fetchScreeningStats(),
      ]);
      setScreeningSessions(sessions);
      setScreeningStats(stats);
      setSourceStatus((s) => ({ ...s, turso: 'ok' }));
    } catch (e) {
      console.error('Screening load error:', e);
      setScreeningError(e.message);
      setSourceStatus((s) => ({ ...s, turso: 'error' }));
    } finally {
      setScreeningLoading(false);
    }
  }, []);

  const loadCalculator = useCallback(async () => {
    setCalcLoading(true);
    setCalcError(null);
    try {
      setCalcSessions(await fetchCalculatorSessions());
      setSourceStatus((s) => ({ ...s, firebase: 'ok' }));
    } catch (e) {
      setCalcError(e.message);
      setSourceStatus((s) => ({ ...s, firebase: 'error' }));
    } finally {
      setCalcLoading(false);
    }
  }, []);

  const loadRedcap = useCallback(async () => {
    if (!isRedcapConfigured()) {
      setSourceStatus((s) => ({ ...s, redcap: 'off' }));
      return;
    }
    setRedcapLoading(true);
    setRedcapError(null);
    try {
      const records = await fetchRedcapRecords();
      setRedcapRecords(records);
      setRedcapIds(new Set(records.map((r) => r.record_id)));
      setSourceStatus((s) => ({ ...s, redcap: 'ok' }));
    } catch (e) {
      setRedcapError(e.message);
      setSourceStatus((s) => ({ ...s, redcap: 'error' }));
    } finally {
      setRedcapLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScreening();
    loadCalculator();
    loadRedcap();
  }, [loadScreening, loadCalculator, loadRedcap]);

  return (
    <div className="dash-root">
      {/* ── Sidebar ── */}
      <aside className="dash-sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-logo-text">ePSA Admin</span>
          <span className="sidebar-logo-sub">Unified Dashboard</span>
        </div>
        <nav className="sidebar-nav">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`sidebar-tab${tab === id ? ' sidebar-tab--active' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <button className="sidebar-logout" onClick={onLogout}>
          <LogOut size={15} /> Sign out
        </button>
      </aside>

      {/* ── Main ── */}
      <main className="dash-main">
        {tab === 'overview' && (
          <OverviewTab
            screeningStats={screeningStats}
            calcSessions={calcSessions}
            sourceStatus={sourceStatus}
          />
        )}
        {tab === 'screening' && (
          <ScreeningTab
            sessions={screeningSessions}
            redcapIds={redcapIds}
            loading={screeningLoading}
            error={screeningError}
            onRefresh={loadScreening}
          />
        )}
        {tab === 'calculator' && (
          <CalculatorTab
            sessions={calcSessions}
            loading={calcLoading}
            error={calcError}
            onRefresh={loadCalculator}
          />
        )}
        {tab === 'redcap' && (
          <RedcapTab
            records={redcapRecords}
            loading={redcapLoading}
            error={redcapError}
            onRefresh={loadRedcap}
          />
        )}
        {tab === 'vv' && <VVPanel />}
        {tab === 'settings' && <SettingsTab />}
      </main>
    </div>
  );
}
