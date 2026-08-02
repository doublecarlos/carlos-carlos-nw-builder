import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { DEV_PORT } from "./ports";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: DEV_PORT,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
