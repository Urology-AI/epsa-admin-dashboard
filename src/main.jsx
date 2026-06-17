import React from 'react';
import ReactDOM from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { msalInstance } from './config/msal.js';
import App from './App.jsx';
import './index.css';

// MSAL must be initialized before any useIsAuthenticated / useMsal hook fires.
msalInstance.initialize().then(() => {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </React.StrictMode>
  );
});
