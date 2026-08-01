import { createApp } from "vue";
import App from "./App.vue";
import "./theme.css";
import { initTheme } from "./stores/theme";
import { hydrate } from "./stores/bootstrap";

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
}

main();
