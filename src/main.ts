import { createApp } from 'vue';
import App from './App.vue';
import './theme.css';
import { initTheme } from './stores/theme';

initTheme();

declare global {
  interface Window {
    NW: any;
  }
}

window.NW = window.NW ?? {};
window.NW.app = createApp(App).mount('#app');
