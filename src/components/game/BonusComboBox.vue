<script setup lang="ts">
// The one picker every "choose a bonus" surface uses: attaching an existing bonus to an item
// (ItemBonuses.vue), and naming which bonus an occurrence condition (ConditionRows.vue) or a
// tier (BonusRows.vue) counts.
//
// A row leads with the bonus's name and carries its id underneath. A query matches
// either; ComboBox itself leads with a row whose id is exactly what was typed.
//
// `self` is for the occurrence pickers, where the bonus being edited is the usual target: it
// offers "this bonus" as the first row and as what an empty value reads as -- the data's own
// spelling of that choice (`BonusOccurrenceSpec`), so the picker never has to know the id of
// the bonus it sits in, which a not-yet-saved one does not have.
import { computed } from "vue";
import ComboBox from "../ui/ComboBox.vue";
import type { BonusOption } from "../../types";

const props = withDefaults(
  defineProps<{
    options: BonusOption[];
    placeholder?: string;
    self?: boolean;
  }>(),
  { placeholder: "- bonus -", self: false },
);

const model = defineModel<string>({ default: "" });

const searchable = computed(() =>
  props.options.map((option) => ({ ...option, search: option.value })),
);

const closedDisplay = computed(() =>
  props.self && !model.value ? "this bonus" : "",
);
</script>

<template>
  <ComboBox
    v-model="model"
    :options="searchable"
    :placeholder="placeholder"
    :show-empty-option="self"
    :closed-display="closedDisplay"
    menu-class="left-0 w-max min-w-full max-w-[min(22rem,80vw)]"
  >
    <template #empty>this bonus</template>
    <template #option="{ option }">
      <div class="min-w-0 leading-tight">
        <div class="overflow-hidden text-ellipsis whitespace-nowrap">
          {{ option.label }}
        </div>
        <div
          class="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted"
          data-testid="bonus-option-id"
        >
          {{ option.value }}
        </div>
      </div>
    </template>
  </ComboBox>
</template>
