import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isNativeApp } from './lib/fileExport';
import './styles.css';

const theme = localStorage.getItem('finanzplaner-theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;

// The Android app ships its files inside the APK; only the web version needs the offline cache.
if (import.meta.env.PROD && !isNativeApp() && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
// Ask the browser not to clear the app's data when the device runs low on space.
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
