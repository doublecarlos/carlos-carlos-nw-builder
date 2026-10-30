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
    name: "app/ui-primitives",
    files: ["src/**/*.vue"],
    // The primitives themselves (BaseInput, BaseTextarea, and genuinely novel controls like
    // OcrTextField/PercentInput) are what a raw <input>/<textarea>, or a wrapping row of
    // controls, is allowed to live inside.
    ignores: ["src/components/ui/**"],
    rules: {
      // A checkbox/radio/file/range/color/hidden input is a different control than the
      // duplicated text-entry field this rule targets (see src/components/ui/README.md) --
      // excluded by type rather than by file, so a text input added anywhere later still trips.
      "vue/no-restricted-syntax": [
        "error",
        {
          selector: "VElement[name='textarea']",
          message:
            "Use BaseTextarea (src/components/ui) instead of a raw <textarea>.",
        },
        {
          selector:
            "VElement[name='input']:not(:has(VAttribute[key.name='type'] > VLiteral[value=/^(checkbox|radio|file|range|color|hidden)$/]))",
          message:
            "Use BaseInput or another ui/ primitive instead of a raw <input>. See src/components/ui/README.md.",
        },
        // A `flex-wrap` row of form controls breaks unevenly on a phone. The primitives own how
        // a control row wraps (FormGrid, InputRow, RepeatableRows cards). A row may still wrap
        // from `md:` up when a phone lays it out otherwise, and a genuine flow of independent
        // items says so with `flow-wrap`.
        {
          selector:
            "VElement:has(VElement[rawName=/^(input|select|textarea|FormField|FormGrid|BaseInput|BaseTextarea|BaseCheckbox|ComboBox|CreatableComboBox|NumberStepper|PercentInput|NumberOrPercentInput|StatValueInput|TokenInput|OcrTextField|FormulaField|FormulaInput|SegmentedControl|ItemPicker)$/]) > VStartTag > VAttribute[key.name=/^(class|row-class)$/] > VLiteral[value=/(^|\\s)(max-[\\w-]+:)?flex-wrap(\\s|$)/]",
          message:
            "Don't wrap a row of form controls with flex-wrap: use a ui/ primitive (FormGrid, InputRow, RepeatableRows #lead), or `flow-wrap` for a flow of independent items. See src/components/ui/README.md.",
        },
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
