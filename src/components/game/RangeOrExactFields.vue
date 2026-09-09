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
import BaseInput from "../ui/BaseInput.vue";
import SegmentedControl from "../ui/SegmentedControl.vue";

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
  <FormField :label="'&nbsp'" class="min-w-0">
    <SegmentedControl
      :model-value="rangeMode"
      :options="[
        { value: 'range', label: 'range' },
        { value: 'exact', label: 'exact' },
      ]"
      @update:model-value="setRangeMode"
    />
  </FormField>
  <template v-if="rangeMode === 'range'">
    <FormField :label="`At least${unitSuffix}`" class="min-w-0"
      ><BaseInput v-model="atLeast" class="w-24" type="number" step="any"
    /></FormField>
    <FormField :label="`Below${unitSuffix}`" class="min-w-0"
      ><BaseInput v-model="below" class="w-24" type="number" step="any"
    /></FormField>
  </template>
  <template v-else>
    <FormField :label="`Exactly${unitSuffix}`" class="min-w-0"
      ><BaseInput v-model="exactly" class="w-24" type="number" step="any"
    /></FormField>
  </template>
</template>
