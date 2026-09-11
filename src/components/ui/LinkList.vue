<script setup lang="ts">
// A comma-separated run of BaseLinks inside a sentence: the items granting a bonus
// (BonusForm.vue), the slots a bonus comes from (BonusInspector.vue), the other parts of a set
// (ItemCard.vue). A `plain` entry is written as text, for the one that is already on screen.
import BaseLink from "./BaseLink.vue";

export interface LinkListItem {
  key: string;
  label: string;
  plain?: boolean;
}

withDefaults(
  defineProps<{
    items: LinkListItem[];
    separator?: string;
    /** `data-testid` for every link, so a caller's locators stay its own. */
    linkTestid?: string;
  }>(),
  { separator: ", ", linkTestid: undefined },
);

defineEmits<{ select: [key: string] }>();
</script>

<template>
  <!-- Two entries can share a key (two sources on one slot), hence the index in `:key`. -->
  <template v-for="(item, index) in items" :key="`${index}:${item.key}`"
    ><template v-if="index">{{ separator }}</template
    ><span v-if="item.plain">{{ item.label }}</span
    ><BaseLink
      v-else
      :data-testid="linkTestid"
      @click="$emit('select', item.key)"
      >{{ item.label }}</BaseLink
    ></template
  >
</template>
