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
      // Nav.vue is a well-known abbreviation, not a single-word component that lacks meaning.
      "vue/multi-word-component-names": ["error", { ignores: ["Nav"] }],
    },
  },

  {
    name: "app/z-index-scale",
    files: ["src/**/*.vue"],
    // TabButton's active-tab lift is the recorded exception; see its own comment.
    ignores: ["src/components/ui/TabButton.vue"],
    rules: {
      // Use base.css's --z-index-* scale instead of a bare z-<number>.
      "vue/no-restricted-class": ["error", "/^z-[0-9]+$/"],
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
