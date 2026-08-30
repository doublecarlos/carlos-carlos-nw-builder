// Registration for the offline worker in public/sw.js -- see that file for the caching rules.
//
// Production only: in dev, Vite serves unhashed modules that change on every edit, and a
// cache-first worker in front of them would hand back stale code and defeat HMR.

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;

  // Relative to BASE_URL so the worker's scope covers the app wherever it is deployed.
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .catch((error: unknown) => {
      // Offline support is an enhancement. A refused registration -- private browsing, an
      // insecure origin, a host serving sw.js with the wrong MIME type -- must not take the
      // rest of the app down with it.
      console.warn("Offline support is unavailable:", error);
    });
}
