import { createApp } from "vue";
import App from "./App.vue";
import "./theme.css";
import { initTheme } from "./stores/theme";

initTheme();

declare global {
  // Exposed for console debugging — an object with an optional app reference.
  interface Window {
    NW?: Record<string, unknown>;
  }
}

window.NW = window.NW ?? {};
(window.NW as Record<string, unknown>).app = createApp(App).mount("#app");
