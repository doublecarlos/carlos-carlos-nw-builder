<script setup lang="ts">
// A label chip in one of the `--badge-<tone>` colors from base.css, for a fact about the thing
// it sits on. Outlined with no fill, a squarer corner and no hover, so it reads apart from
// BaseBadge's filled status chips and never as something to click. The border is softened
// toward whatever is behind it, so the text leads.
defineProps<{
  /** One of the `--badge-*` tone names in base.css. */
  tone: string;
}>();
</script>

<template>
  <span
    class="inline-block rounded-sm border border-[color-mix(in_oklab,var(--badge-tone)_55%,transparent)] px-1 leading-tight whitespace-nowrap text-(--badge-tone)"
    :style="{ '--badge-tone': `var(--badge-${tone})` }"
    data-testid="tone-badge"
    :data-tone="tone"
  >
    <slot />
  </span>
</template>
