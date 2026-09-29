<script setup lang="ts">
// Edits one `FormulaRef`: the formula, checked as it is typed, and an optional label shown in
// place of it to players, with the derived label as the label's placeholder. Every formula
// site of a bonus uses it (grant scale, tier measure, condition leaf, named formula).
//
// The vocabulary, the checks and the preview come from the bonus form's formula context
// (useFormulaContext.ts). Outside one, only the text itself is checked.
import { computed, ref, useTemplateRef } from "vue";
import { Sigma } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseInput from "../ui/BaseInput.vue";
import FormulaInput, { type FormulaInputIssue } from "../ui/FormulaInput.vue";
import IconButton from "../ui/IconButton.vue";
import { useFormulaContext } from "../../composables/useFormulaContext";
import {
  FORMULA_FUNCTIONS,
  FORMULA_VARIABLES,
  checkFormula,
  explainFormula,
  formatNumber,
  formulaLabel,
  formulaUsage,
  lintFormula,
} from "../../engine/formula";

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    /** Problems found outside the formula itself, such as a reference cycle. */
    extraIssues?: FormulaInputIssue[];
    /** Leading part of every `data-testid` inside: the field itself, then `-issue`, `-fix`,
     *  `-label`, `-preview`, `-reference-toggle`, `-reference` and `-reference-item`. */
    testid: string;
  }>(),
  { placeholder: "", extraIssues: () => [] },
);

const formula = defineModel<string>("formula", { required: true });
const label = defineModel<string>("label", { required: true });

const context = useFormulaContext();
const input = useTemplateRef<InstanceType<typeof FormulaInput>>("input");
const showReference = ref(false);

const text = computed(() => formula.value.trim());

const issues = computed<FormulaInputIssue[]>(() => {
  if (!text.value) {
    if (props.extraIssues.length || !label.value.trim())
      return props.extraIssues;
    // An empty formula means none, which takes the label with it.
    return [
      {
        start: 0,
        end: 0,
        level: "warn",
        message: "the label is not saved without a formula",
      },
    ];
  }
  const found = context
    ? lintFormula(formula.value, context.owner.value, context.vocabulary.value)
    : checkFormula(formula.value, []);
  // The fix is offered as a link, so the message need not spell it out too.
  const shown = found.map((issue) => ({
    ...issue,
    message: issue.brief ?? issue.message,
  }));
  return [...shown, ...props.extraIssues];
});

const hasError = computed(() =>
  issues.value.some((issue) => (issue.level ?? "error") === "error"),
);

/** The formula against the active build, named since the editor shows no build of its own,
 *  once it has nothing to fix. */
const preview = computed(() => {
  if (!text.value || hasError.value) return null;
  const ctx = context?.evalContext();
  if (!ctx) return null;
  const { substituted, result } = explainFormula(formula.value, ctx);
  const value = result.ok ? formatNumber(result.value) : null;
  return {
    build: context?.buildName.value ?? "",
    // Left out where it would only repeat the formula or the value.
    substituted:
      substituted === formula.value || substituted === value
        ? null
        : substituted,
    value,
    error: result.ok ? null : result.error,
  };
});

const derivedLabel = computed(() =>
  text.value && context
    ? formulaLabel({ formula: formula.value }, context.labels.value)
    : undefined,
);

interface ReferenceItem {
  /** What clicking inserts. */
  insert: string;
  /** What the chip reads, when it differs from `insert`. */
  text?: string;
  hint?: string;
}

const reference = computed(() => {
  const owner = context?.owner.value;
  const groups: { title: string; items: ReferenceItem[] }[] = [
    {
      title: "Variables",
      items: FORMULA_VARIABLES.map((name) => ({ insert: name })),
    },
    {
      title: "Functions",
      items: FORMULA_FUNCTIONS.map((name) => ({
        insert: `${name}(`,
        text: formulaUsage(name),
      })),
    },
    {
      title: "Formulas of this bonus",
      items: Object.entries(owner?.formulas ?? {}).map(([name, ref]) => ({
        insert: `$${name}`,
        hint: ref.label,
      })),
    },
    {
      title: "Inputs of this bonus",
      items: Object.entries(owner?.inputs ?? {})
        .filter(([, def]) => def.type !== "boolean")
        .map(([name, def]) => ({
          insert: `$${name}`,
          hint: def.label,
        })),
    },
    {
      title: "Scalers",
      items: (context?.scalers.value ?? []).map((option) => ({
        insert: `scaler("${option.value}")`,
        hint: option.label,
      })),
    },
  ];
  return groups.filter((group) => group.items.length);
});
</script>

<template>
  <div class="flex min-w-0 flex-col gap-0.5">
    <div class="flex flex-wrap items-start gap-1.5">
      <FormulaInput
        ref="input"
        v-model="formula"
        class="min-w-56 flex-1"
        :issues="issues"
        :placeholder="placeholder"
        :testid="testid"
      >
        <template #leading>
          <IconButton
            :title="
              showReference ? 'Hide formula reference' : 'Formula reference'
            "
            :aria-pressed="showReference"
            :data-testid="`${testid}-reference-toggle`"
            @click="showReference = !showReference"
            ><Sigma
          /></IconButton>
        </template>
      </FormulaInput>
      <BaseInput
        v-model="label"
        type="text"
        class="w-36"
        :placeholder="derivedLabel ?? 'Label (optional)'"
        :data-testid="`${testid}-label`"
      />
    </div>
    <p v-if="preview" class="text-muted" :data-testid="`${testid}-preview`">
      On build "{{ preview.build }}":
      <template v-if="preview.substituted"
        ><span class="font-mono">{{ preview.substituted }}</span> =
      </template>
      <strong v-if="preview.value !== null" class="text-text">{{
        preview.value
      }}</strong>
      <span v-else class="text-warn">{{ preview.error }}</span>
    </p>
    <div
      v-if="showReference"
      class="rounded-md border border-line bg-surface p-1.5"
      :data-testid="`${testid}-reference`"
    >
      <div v-for="group in reference" :key="group.title" class="mb-1">
        <div class="text-muted">{{ group.title }}</div>
        <div class="flex flex-wrap gap-1">
          <BaseButton
            v-for="item in group.items"
            :key="item.insert"
            class="font-mono"
            :data-testid="`${testid}-reference-item`"
            @click="input?.insert(item.insert)"
          >
            {{ item.text ?? item.insert }}
            <span v-if="item.hint" class="font-sans text-muted">{{
              item.hint
            }}</span>
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>
