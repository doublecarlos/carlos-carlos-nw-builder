<script setup lang="ts">
// Presentational card shell: rounded rim, surface background, shadow. Use inside BasePopover
// for overlay cards, or stand-alone for inline cards. The rim is --line-strong rather than
// --line so a floating card still detaches from the content behind it.
defineProps<{
  /** Any CSS color, tinting the rim. */
  tone?: string;
}>();
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-surface shadow-xl"
    :class="
      tone
        ? 'border-[color-mix(in_oklab,var(--tone)_55%,var(--line-strong))]'
        : 'border-line-strong'
    "
    :style="tone ? { '--tone': tone } : undefined"
  >
    <slot />
  </div>
</template>
