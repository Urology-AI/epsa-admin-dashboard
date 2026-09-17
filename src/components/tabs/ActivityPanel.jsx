import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Users, Activity, RotateCcw, MapPin, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchCalculatorActivity } from '../../services/firebaseService.js';

// Calculator usage by day, from Cloud Functions logs (+ GA4 for locations).

const pad = (n) => String(n).padStart(2, '0');
const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDay(d); };

function fmtDayLabel(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function eachDay(from, to) {
  const out = [];
  const [y, m, d] = from.split('-').map(Number);
  for (let cur = new Date(y, m - 1, d); toDay(cur) <= to; cur.setDate(cur.getDate() + 1)) out.push(toDay(cur));
  return out;
}

const PRESETS = [
  { label: 'Yesterday', from: () => daysAgo(1), to: () => daysAgo(1) },
  { label: 'Today',     from: () => daysAgo(0), to: () => daysAgo(0) },
  { label: '7 days',    from: () => daysAgo(6), to: () => daysAgo(0) },
  { label: '30 days',   from: () => daysAgo(29), to: () => daysAgo(0) },
];

function Stat({ icon: Icon, color, value, label, sub }) {
  return (
    <div className="stat-card">
      <Icon size={20} className="stat-icon" style={{ color }} />
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function BarList({ rows, color }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="activity-bars">
      {rows.map((r) => (
        <div key={r.key} className="activity-bar-row">
          <span className="activity-bar-label" title={r.label}>{r.label}</span>
          <div className="progress-track activity-bar-track">
            <div className="progress-fill" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          <span className="activity-bar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function ActivityPanel() {
  const [from, setFrom] = useState(daysAgo(1));
  const [to, setTo]     = useState(daysAgo(1));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [collapsed, setCollapsed] = useState(new Set());

  const load = useCallback(async () => {
    if (!from || !to || from > to) return;
    setLoading(true);
    setError(null);
    try { setData(await fetchCalculatorActivity(from, to)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const days = from && to && from <= to ? eachDay(from, to) : [];

  // Group everything by the viewer's local calendar day.
  const byDay = Object.fromEntries(days.map((d) => [d, { calls: 0, sessions: [], users: new Set() }]));
  if (data) {
    for (const [hour, n] of Object.entries(data.hourly)) {
      const day = toDay(new Date(hour));
      if (byDay[day]) byDay[day].calls += n;
    }
    for (const s of data.sessions) {
      const day = toDay(new Date(s.first));
      if (!byDay[day]) continue;
      byDay[day].sessions.push(s);
      s.users.forEach((u) => byDay[day].users.add(u));
    }
  }
  const activeDays = days.filter((d) => byDay[d].calls || byDay[d].sessions.length).reverse();

  const cityRows = {};
  const countryRows = {};
  for (const l of data?.locations ?? []) {
    const city = `${l.city === '(not set)' ? 'Unknown city' : l.city}, ${l.country}`;
    cityRows[city] = (cityRows[city] || 0) + l.users;
    countryRows[l.country] = (countryRows[l.country] || 0) + l.users;
  }
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => ({ key: k, label: k, value: v }));
  const totalVisitors = Object.values(countryRows).reduce((a, b) => a + b, 0);

  function toggleDay(day) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  }

  return (
    <section className="activity-panel">
      <div className="tab-header-row">
        <h2 className="tab-heading">Calculator Activity</h2>
        <div className="activity-controls">
          {PRESETS.map((p) => {
            const active = from === p.from() && to === p.to();
            return (
              <button
                key={p.label}
                className={`activity-preset${active ? ' active' : ''}`}
                onClick={() => { setFrom(p.from()); setTo(p.to()); }}
              >
                {p.label}
              </button>
            );
          })}
          <input type="date" className="filter-select" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <span className="activity-sep">→</span>
          <input type="date" className="filter-select" value={to} min={from} max={daysAgo(0)} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          <button className="icon-btn" onClick={load} title="Refresh" disabled={loading}>
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="error-block">
          <p>Could not load activity: {error}</p>
          <p className="error-hint">The Firebase service account needs the <code>Logs Viewer</code> role on the project.</p>
        </div>
      ) : !data || loading ? (
        <div className="loading">Loading activity…</div>
      ) : (
        <>
          <div className="stats-grid">
            <Stat icon={Activity}  color="var(--accent)" value={data.sessions.length} label="Sessions" sub="Seen in session sync logs" />
            <Stat icon={Users}     color="var(--green)"  value={data.users.length} label="Anonymous users" />
            <Stat icon={MapPin}    color="var(--blue)"   value={data.locations ? totalVisitors : '—'} label="Site visitors" sub={data.locations ? 'Google Analytics' : 'GA4 not connected'} />
            <Stat icon={RotateCcw} color="var(--amber)"  value={data.calls.loginAnonymousBySessionId ?? 0} label="Session restores" sub={`${data.calls.calculatePsaRecommendation ?? 0} risk calculations`} />
          </div>
          {data.truncated && <p className="error-hint">Range too busy — results are partial. Pick a shorter range.</p>}

          <div className="activity-grid">
            <div className="activity-card">
              <h3 className="activity-card-title">Sessions per day</h3>
              {days.length === 0 ? <div className="empty">Pick a date range.</div> : (
                <BarList
                  color="var(--accent)"
                  rows={days.slice(-31).map((d) => ({ key: d, label: fmtDayLabel(d), value: byDay[d].sessions.length }))}
                />
              )}
            </div>

            <div className="activity-card">
              <h3 className="activity-card-title">Visitor locations</h3>
              {data.locations === null ? (
                <div className="empty">
                  {data.locationsError
                    ? <>Google Analytics error: {data.locationsError}</>
                    : <>Set <code>GA4_PROPERTY_ID</code> on Cloudflare Pages and add the service account as a Viewer on the GA4 property to show locations.</>}
                </div>
              ) : cityRows && Object.keys(cityRows).length === 0 ? (
                <div className="empty">No visitors recorded by Google Analytics.</div>
              ) : (
                <>
                  <BarList color="var(--blue)" rows={top(cityRows, 8)} />
                  <p className="activity-countries">
                    {top(countryRows, 6).map((c) => `${c.label} ${c.value}`).join(' · ')}
                  </p>
                </>
              )}
            </div>
          </div>

          <h3 className="activity-card-title" style={{ marginTop: '1.25rem' }}>Sessions by date</h3>
          {activeDays.length === 0 ? (
            <div className="empty">No sessions in this range.</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>Session</th>
                    <th>Started</th>
                    <th>Last seen</th>
                    <th>Users</th>
                  </tr>
                </thead>
                <tbody>
                  {activeDays.map((day) => {
                    const { sessions, users, calls } = byDay[day];
                    const open = !collapsed.has(day);
                    return (
                      <React.Fragment key={day}>
                        <tr className="session-row date-group-row" onClick={() => toggleDay(day)}>
                          <td className="td-expand">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                          <td colSpan={4}>
                            <strong>{fmtDayLabel(day)}</strong>
                            <span className="date-group-meta">
                              {sessions.length} session{sessions.length === 1 ? '' : 's'} · {users.size} user{users.size === 1 ? '' : 's'} · {calls} calculations
                            </span>
                          </td>
                        </tr>
                        {open && sessions.map((s) => (
                          <tr key={s.id}>
                            <td />
                            <td className="td-ref">{s.id}</td>
                            <td>{fmtTime(s.first)}</td>
                            <td>{fmtTime(s.last)}</td>
                            <td title={s.users.join('\n')}>{s.users.length}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
