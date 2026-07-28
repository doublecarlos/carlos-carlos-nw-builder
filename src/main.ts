// Vite module entry point. During the phased migration (see llm/plans/ for the migration plan)
// this only wires up already-converted modules via legacy-bridge so not-yet-converted classic
// <script> files keep working; src/app.js still owns the real createApp().mount('#app') call
// until Phase 6 replaces it with App.vue mounted from here.
import './legacy-bridge';
