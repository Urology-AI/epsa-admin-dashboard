import React, { useState } from 'react';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { DASHBOARD_PASSWORD } from '../config/env.js';
import './AdminLogin.css';

export default function AdminLogin({ onLogin }) {
  const [pw, setPw]         = useState('');
  const [show, setShow]     = useState(false);
  const [error, setError]   = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (pw === DASHBOARD_PASSWORD) {
      onLogin();
    } else {
      setError('Incorrect password');
      setPw('');
    }
  }

  return (
    <div className="login-root">
      <div className="login-card">
        <div className="login-icon"><ShieldCheck size={32} /></div>
        <h1 className="login-title">ePSA Admin</h1>
        <p className="login-sub">Unified Research Dashboard</p>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <input
              type={show ? 'text' : 'password'}
              placeholder="Dashboard password"
              value={pw}
              onChange={(e) => { setPw(e.target.value); setError(''); }}
              autoFocus
            />
            <button type="button" className="login-eye" onClick={() => setShow((v) => !v)}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn" disabled={!pw}>Sign in</button>
        </form>
      </div>
    </div>
  );
}
