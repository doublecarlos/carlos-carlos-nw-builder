import { createVaporApp, type VaporComponent } from "vue";
import App from "./App.vue";
import "./base.css";
import { initTheme } from "./stores/theme";
import { initMaintainer } from "./stores/maintainer";
import { hydrate } from "./stores/bootstrap";
import { registerServiceWorker } from "./lib/service-worker";

initTheme();
initMaintainer();

declare global {
  interface Window {
    NW?: Record<string, unknown>;
  }
}

async function main() {
  await hydrate();

  window.NW = window.NW ?? {};
  // vue-tsc still types every SFC as a VDOM `DefineComponent`.
  (window.NW as Record<string, unknown>).app = createVaporApp(
    App as unknown as VaporComponent,
  ).mount("#app");

  // After mount: the worker's install primes its cache, which should not compete with the
  // page's own first paint.
  registerServiceWorker();
}

main();
