<script setup lang="ts">
// A stat row's info button, for StatPanel's source card: hovering previews the card, a click
// pins it. Talks to the panel's one card through the trigger useStatSourcePopover provides.
//
// No tooltip of its own: the card it opens already says what the button is for.
//
// On a coarse pointer it opts out of the finger-sized minimum, which would stand every stat row
// a tap target tall and push the row's compare line below its neighbors'. An invisible area
// centered on it keeps the tap target that size instead.
import { inject } from "vue";
import { CircleAlert } from "@lucide/vue";
import IconButton from "../ui/IconButton.vue";
import { STAT_SOURCE_TRIGGER } from "../../composables/useStatSourcePopover";

defineProps<{ statKey: string; label: string }>();

const trigger = inject(STAT_SOURCE_TRIGGER);
</script>

<template>
  <IconButton
    v-if="trigger"
    class="relative flex-none pointer-coarse:min-h-0 pointer-coarse:min-w-0 pointer-coarse:after:absolute pointer-coarse:after:inset-[calc((100%-var(--spacing-tap))/2)]"
    title=""
    :label="`Show sources for ${label}`"
    :data-stat-key="statKey"
    data-testid="stat-info"
    @mouseenter="trigger.enter($event, statKey)"
    @mouseleave="trigger.leave()"
    @click="trigger.toggle($event, statKey)"
  >
    <CircleAlert />
  </IconButton>
</template>
