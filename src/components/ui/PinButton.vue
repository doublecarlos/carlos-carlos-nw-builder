<script setup lang="ts">
// A hover card's header button: pins the card in place, then closes it once pinned. One
// button either way, so a caller's class lands on it whichever it is.
import { Pin, X } from "@lucide/vue";
import IconButton from "./IconButton.vue";

const props = defineProps<{ pinned: boolean }>();

const emit = defineEmits<{ pin: []; close: [] }>();

function onClick() {
  if (props.pinned) emit("close");
  else emit("pin");
}
</script>

<template>
  <IconButton
    :title="pinned ? 'Close' : 'Pin in place'"
    :data-testid="pinned ? 'card-close' : 'card-pin'"
    @click="onClick"
  >
    <X v-if="pinned" />
    <Pin v-else />
  </IconButton>
</template>
