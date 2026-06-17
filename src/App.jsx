import React, { useState } from 'react';
import AdminLogin       from './components/AdminLogin.jsx';
import UnifiedDashboard from './components/UnifiedDashboard.jsx';

const SESSION_KEY = 'epsa_dash_auth';

function isLoggedIn() {
  try { return sessionStorage.getItem(SESSION_KEY) === '1'; } catch { return false; }
}

export default function App() {
  const [authed, setAuthed] = useState(isLoggedIn);

  function handleLogin() {
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch {}
    setAuthed(true);
  }

  function handleLogout() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    setAuthed(false);
  }

  return authed
    ? <UnifiedDashboard onLogout={handleLogout} />
    : <AdminLogin onLogin={handleLogin} />;
}
