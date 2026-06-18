import React, { useState, useEffect, useCallback } from 'react';
import { LogOut, LayoutDashboard, MonitorSmartphone, Calculator, Database, ShieldCheck } from 'lucide-react';
import { isTursoConfigured, fetchScreeningSessions, fetchScreeningStats } from '../services/tursoService.js';
import { fetchCalculatorSessions } from '../services/firebaseService.js';
import { isRedcapConfigured, fetchRedcapRecords, fetchRedcapRecordIdSet } from '../services/redcapService.js';
import OverviewTab    from './tabs/OverviewTab.jsx';
import ScreeningTab   from './tabs/ScreeningTab.jsx';
import CalculatorTab  from './tabs/CalculatorTab.jsx';
import RedcapTab      from './tabs/RedcapTab.jsx';
import VVPanel        from './tabs/VVPanel.jsx';
import './UnifiedDashboard.css';

const TABS = [
  { id: 'overview',   label: 'Overview',             Icon: LayoutDashboard },
  { id: 'screening',  label: 'Screening (Bus)',       Icon: MonitorSmartphone },
  { id: 'calculator', label: 'Calculator (Full Tool)', Icon: Calculator },
  { id: 'redcap',     label: 'REDCap Sinai',          Icon: Database },
  { id: 'vv',         label: 'Verification & Validation', Icon: ShieldCheck },
];

export default function UnifiedDashboard({ onLogout }) {
  const [tab, setTab] = useState('overview');

  // Screening (Turso)
  const [screeningSessions, setScreeningSessions]   = useState([]);
  const [screeningStats,    setScreeningStats]      = useState(null);
  const [screeningLoading,  setScreeningLoading]    = useState(false);

  // Calculator (Firebase)
  const [calcSessions,   setCalcSessions]   = useState([]);
  const [calcLoading,    setCalcLoading]    = useState(false);
  const [calcError,      setCalcError]      = useState(null);

  // REDCap
  const [redcapRecords,  setRedcapRecords]  = useState([]);
  const [redcapIds,      setRedcapIds]      = useState(null);
  const [redcapLoading,  setRedcapLoading]  = useState(false);
  const [redcapError,    setRedcapError]    = useState(null);

  const sources = {
    turso:    isTursoConfigured(),
    firebase: true,
    redcap:   isRedcapConfigured(),
  };

  const loadScreening = useCallback(async () => {
    if (!isTursoConfigured()) return;
    setScreeningLoading(true);
    try {
      const [sessions, stats] = await Promise.all([
        fetchScreeningSessions(),
        fetchScreeningStats(),
      ]);
      setScreeningSessions(sessions);
      setScreeningStats(stats);
    } catch (e) {
      console.error('Screening load error:', e);
    } finally {
      setScreeningLoading(false);
    }
  }, []);

  const loadCalculator = useCallback(async () => {
    setCalcLoading(true);
    setCalcError(null);
    try {
      setCalcSessions(await fetchCalculatorSessions());
    } catch (e) {
      setCalcError(e.message);
    } finally {
      setCalcLoading(false);
    }
  }, []);

  const loadRedcap = useCallback(async () => {
    if (!isRedcapConfigured()) return;
    setRedcapLoading(true);
    setRedcapError(null);
    try {
      const records = await fetchRedcapRecords();
      setRedcapRecords(records);
      setRedcapIds(new Set(records.map((r) => r.record_id)));
    } catch (e) {
      setRedcapError(e.message);
    } finally {
      setRedcapLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScreening();
    loadCalculator();
    loadRedcap();
  }, [loadScreening, loadCalculator, loadRedcap]);

  const activeTab = TABS.find((t) => t.id === tab);

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
            sources={sources}
          />
        )}
        {tab === 'screening' && (
          <ScreeningTab
            sessions={screeningSessions}
            redcapIds={redcapIds}
            loading={screeningLoading}
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
      </main>
    </div>
  );
}
