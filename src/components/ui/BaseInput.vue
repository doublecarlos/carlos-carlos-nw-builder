<script setup lang="ts">
// The ordinary text/number/search field, replacing the raw `<input>` class string that used to
// be hand-copied at every call site (34 files). Numeric input right-aligns its digits, following
// the type, so that no longer has to be requested per call site either.
//
// `type` is a prop rather than a fallthrough attribute so the numeric coercion below can react
// to it: a plain `v-model` on a dynamically-typed native `<input>` never gets Vue's own
// `v-model.number` treatment, since that only triggers for a statically-known `type="number"`.
// This reproduces the same "empty and mid-typing input stays as-is, everything else becomes a
// number" behaviour by hand.
//
// A dedicated control like OcrTextField or PercentInput is still the right call for anything
// genuinely novel; this only owns the ordinary case.
const props = withDefaults(
  defineProps<{
    type?: "text" | "number" | "search";
  }>(),
  { type: "text" },
);

const model = defineModel<string | number | null>({ default: "" });

/** Mirrors Vue's own `v-model.number`: mid-typing states like "-" or "1." are left as the raw
 *  string rather than snapped to NaN or 0. */
function looseToNumber(value: string): number | string {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function onInput(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  model.value = props.type === "number" ? looseToNumber(value) : value;
}
</script>

<template>
  <input
    :value="model"
    :type="type"
    class="rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
    :class="type === 'number' && 'text-right tabular-nums'"
    @input="onInput"
  />
</template>
