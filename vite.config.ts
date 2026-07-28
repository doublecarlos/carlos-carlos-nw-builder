import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Not-yet-converted classic components (see the phased migration in llm/plans/) still pass
    // Vue a string `template: '...'` option, which needs the runtime *compiler* -- Vite's
    // default `vue` resolution is runtime-only (SFCs are precompiled at build time, so they
    // never need it). Once every file is a real SFC (end of the migration) this alias stops
    // doing anything and can be dropped.
    alias: {
      vue: 'vue/dist/vue.esm-bundler.js',
    },
  },
  build: {
    outDir: 'dist',
  },
});
