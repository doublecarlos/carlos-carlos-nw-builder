<script setup lang="ts">
// Shared "range (at least/below) or exact" comparison fields for the leaf types that support
// both -- duration, bonusOccurrences, equipped, and param's numeric form. Extracted so the
// toggle and field wiring can't drift between the four call sites the way `equipped`'s and
// `bonusOccurrences`'s "Below" fields once did: present in the template, wired to `row.below`,
// but silently dropped on save because condition-draft.ts's leaf conversion had never been
// taught to read that field for those two types.
//
// Four named `v-model`s (not a single `:row` object prop) so this stays a normal controlled
// component -- mutating a prop's own fields in place would trip `vue/no-mutating-props`, and
// the caller (ConditionRows.vue) already owns direct mutation rights over its own `row` objects.
import FormField from "../ui/FormField.vue";

withDefaults(
  defineProps<{
    /** Appended to each field's label, e.g. " (s)" for duration's seconds -- occurrence/
     *  equip counts and generic build parameters have no implied unit, so this stays blank. */
    unitSuffix?: string;
  }>(),
  { unitSuffix: "" },
);

const atLeast = defineModel<string | number | null>("atLeast", {
  default: null,
});
const below = defineModel<string | number | null>("below", { default: null });
const exactly = defineModel<string | number | null>("exactly", {
  default: null,
});
const rangeMode = defineModel<"range" | "exact">("rangeMode", {
  default: "range",
});

function setRangeMode(mode: "range" | "exact") {
  rangeMode.value = mode;
  if (mode === "exact") {
    atLeast.value = null;
    below.value = null;
  } else {
    exactly.value = null;
  }
}
</script>

<template>
  <div class="inline-flex">
    <button
      type="button"
      class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
      :class="
        rangeMode === 'range'
          ? 'border-accent bg-accent-soft text-text'
          : 'bg-surface text-muted'
      "
      @click="setRangeMode('range')"
    >
      range
    </button>
    <button
      type="button"
      class="border border-line px-2 py-0.5 text-sm first:rounded-l-md last:rounded-r-md last:border-l-0"
      :class="
        rangeMode === 'exact'
          ? 'border-accent bg-accent-soft text-text'
          : 'bg-surface text-muted'
      "
      @click="setRangeMode('exact')"
    >
      exact
    </button>
  </div>
  <template v-if="rangeMode === 'range'">
    <FormField :label="`At least${unitSuffix}`" class="min-w-0"
      ><input
        v-model.number="atLeast"
        class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="number"
        step="any"
    /></FormField>
    <FormField :label="`Below${unitSuffix}`" class="min-w-0"
      ><input
        v-model.number="below"
        class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="number"
        step="any"
    /></FormField>
  </template>
  <template v-else>
    <FormField :label="`Exactly${unitSuffix}`" class="min-w-0"
      ><input
        v-model.number="exactly"
        class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="number"
        step="any"
    /></FormField>
  </template>
</template>
