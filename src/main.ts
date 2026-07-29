import { createApp } from 'vue';
import App from './App.vue';
import './base.css'

declare global {
  interface Window {
    NW: any;
  }
}

window.NW = window.NW ?? {};
window.NW.app = createApp(App).mount('#app');
