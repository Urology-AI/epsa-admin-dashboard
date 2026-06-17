import React from 'react';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { InteractionStatus } from '@azure/msal-browser';
import { loginRequest } from './config/msal.js';
import UnifiedDashboard from './components/UnifiedDashboard.jsx';
import './components/MsalLogin.css';
import { ShieldCheck } from 'lucide-react';

function MsalLogin() {
  const { instance, inProgress } = useMsal();
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    instance.handleRedirectPromise().catch((err) => setError(err.message || 'Login failed'));
  }, [instance]);

  const loading =
    inProgress === InteractionStatus.Redirect ||
    inProgress === InteractionStatus.Login;

  function handleLogin() {
    setError('');
    instance.loginRedirect(loginRequest).catch((err) =>
      setError(err.message || 'Login failed')
    );
  }

  return (
    <div className="msal-login-root">
      <div className="msal-login-card">
        <div className="msal-login-icon"><ShieldCheck size={32} /></div>
        <h1 className="msal-login-title">ePSA Admin</h1>
        <p className="msal-login-sub">Unified Research Dashboard</p>
        {error && <p className="msal-login-error">{error}</p>}
        <button
          className="msal-login-btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Redirecting…' : (
            <>
              <svg className="ms-icon" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              Sign in with Microsoft
            </>
          )}
        </button>
        <p className="msal-login-note">Mount Sinai Microsoft account required</p>
      </div>
    </div>
  );
}

export default function App() {
  const isAuthenticated = useIsAuthenticated();
  const { instance } = useMsal();

  function handleLogout() {
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin + '/' });
  }

  return isAuthenticated
    ? <UnifiedDashboard onLogout={handleLogout} />
    : <MsalLogin />;
}
