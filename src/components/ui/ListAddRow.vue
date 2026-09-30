<script setup lang="ts">
// The add row after a list of cards: a "+" that appends, any other way of adding (an attach
// picker) as the default slot, and the list's empty note while it has nothing. It sits after
// the list because that is where a new entry lands. Used by an item's bonuses, a bonus's
// grants, and a grant's tiers and variants.
import { Plus } from "@lucide/vue";
import IconButton from "./IconButton.vue";

withDefaults(
  defineProps<{
    title: string;
    testid?: string;
    /** Shows the `#empty` note. */
    empty?: boolean;
  }>(),
  { testid: undefined, empty: false },
);
defineEmits<{ add: [] }>();
</script>

<template>
  <div class="mb-1 flex flex-wrap items-center gap-1.5">
    <IconButton :title="title" :data-testid="testid" @click="$emit('add')"
      ><Plus
    /></IconButton>
    <slot />
    <span v-if="empty" class="text-muted"><slot name="empty" /></span>
  </div>
</template>
