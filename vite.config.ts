import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy for the built app: code only from the app itself, and network
 * requests only to the two price services. The browser blocks every other connection,
 * so no data can leave the device even by mistake.
 */
const csp = (android: boolean) =>
  [
    "default-src 'self'",
    // Android: on outdated system WebViews Capacitor falls back to an inline bridge script.
    android ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" : "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.gold-api.com https://api.frankfurter.dev https://api.frankfurter.app",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');

function securityHeaders(android: boolean): Plugin {
  return {
    name: 'finanzplaner-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp(android)}" />\n    <meta name="referrer" content="no-referrer" />`,
      ),
  };
}

/** Generates sw.js with the list of all built files, so the app works offline after the first visit. */
function serviceWorker(): Plugin {
  return {
    name: 'finanzplaner-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', ...Object.keys(bundle).map((f) => `./${f}`)];
      // Hashed file names change with every code change, so a hash over them versions the cache.
      let h = 0x811c9dc5;
      for (const ch of files.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
      const version = (h >>> 0).toString(36);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Generated at build time.
const CACHE = 'finanzplaner-${version}';
const FILES = ${JSON.stringify([...new Set(files)])};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Price requests to other hosts are not cached and go straight to the network.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    // Newest app version when online, cached version when offline.
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`,
      });
    },
  };
}

// base: './' lets the built app run from any sub-path (e.g. GitHub Pages).
// `vite build --mode android` builds the files for the APK: no offline cache needed there.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), securityHeaders(mode === 'android'), ...(mode === 'android' ? [] : [serviceWorker()])],
  build: { chunkSizeWarningLimit: 1500 },
}));
