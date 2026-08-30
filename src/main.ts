import { createApp } from "vue";
import App from "./App.vue";
import "./base.css";
import { initTheme } from "./stores/theme";
import { hydrate } from "./stores/bootstrap";
import { registerServiceWorker } from "./lib/service-worker";

initTheme();

declare global {
  interface Window {
    NW?: Record<string, unknown>;
  }
}

async function main() {
  await hydrate();

  window.NW = window.NW ?? {};
  (window.NW as Record<string, unknown>).app = createApp(App).mount("#app");

  // After mount: the worker's install primes its cache, which should not compete with the
  // page's own first paint.
  registerServiceWorker();
}

main();
