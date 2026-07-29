import { createApp } from 'vue';
import App from './App.vue';
import './theme.css';
// TODO(tailwind-migration): dropped once every component's scoped CSS is converted.
// import './base.css';
import { initTheme } from './stores/theme';

initTheme();

declare global {
  interface Window {
    NW: any;
  }
}

window.NW = window.NW ?? {};
window.NW.app = createApp(App).mount('#app');
