import { PublicClientApplication } from '@azure/msal-browser';

export const msalConfig = {
  auth: {
    clientId:             import.meta.env.VITE_AZURE_CLIENT_ID  || '',
    authority:            `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_TENANT_ID || 'common'}`,
    redirectUri:          window.location.origin + import.meta.env.BASE_URL,
    postLogoutRedirectUri: window.location.origin + import.meta.env.BASE_URL,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = { scopes: ['User.Read'] };

export const msalInstance = new PublicClientApplication(msalConfig);
// Must be awaited before rendering — call msalInstance.initialize() in main.jsx
