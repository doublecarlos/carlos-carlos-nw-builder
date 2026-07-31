import { globalIgnores } from "eslint/config";
import {
  defineConfigWithVueTs,
  vueTsConfigs,
} from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";
import pluginVitest from "@vitest/eslint-plugin";
import pluginPlaywright from "eslint-plugin-playwright";
import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"],
  },

  globalIgnores([
    "dist/**",
    "test-results/**",
    "playwright-report/**",
    ".playwright/**",
    ".playwright-cli/**",
    "workspace/**",
    "venv/**",
    "data/**",
  ]),

  pluginVue.configs["flat/recommended"],
  vueTsConfigs.recommended,

  {
    name: "app/rule-adjustments",
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        // storage.ts's diff helpers destructure `{ updated: ua, ...restA }` purely to drop
        // `updated` from the comparison -- the bound name is intentionally unused.
        { ignoreRestSiblings: true },
      ],
    },
  },

  {
    name: "app/vitest-tests",
    ...pluginVitest.configs.recommended,
    files: ["tests/unit/**/*.spec.ts"],
  },

  {
    name: "app/playwright-tests",
    ...pluginPlaywright.configs["flat/recommended"],
    files: ["tests/e2e/**/*.spec.ts"],
  },

  // Must be last: turns off stylistic rules that Prettier already owns.
  skipFormatting,
);
