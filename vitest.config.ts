import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { APP_DEFINES } from "./build-info";

export default defineConfig({
  plugins: [vue()],
  define: APP_DEFINES,
  test: {
    environment: "node",
    include: ["tests/unit/**/*.spec.ts"],
  },
});
