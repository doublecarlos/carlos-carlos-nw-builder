<script setup lang="ts">
// One small vocabulary reused everywhere a row needs a status/count chip: the build slot list,
// the data editor's changed-row list and its item/bonus forms, the bonus inspector's
// near-miss flag. `unsaved` and `removed` share a look -- a row's overlay *status*
// (added/edited/removed) and its form having an in-progress draft are different facts that can
// both be true at once, so they stay separate variants rather than collapsing into one.
withDefaults(
  defineProps<{
    variant?:
      | "error"
      | "diff"
      | "near"
      | "added"
      | "edited"
      | "removed"
      | "warn"
      | "unsaved";
  }>(),
  {
    variant: "near",
  },
);

const variants: Record<string, string> = {
  error: "bg-danger-soft text-danger",
  diff: "bg-diff/25 text-diff",
  near: "bg-accent-soft text-accent",
  added: "bg-ok/25 text-ok",
  edited: "bg-accent-soft text-accent",
  removed: "bg-danger-soft text-danger",
  warn: "bg-warn/25 text-warn",
  unsaved: "bg-danger-soft text-danger",
};
</script>

<template>
  <span
    class="rounded-full px-1.5 text-sm font-semibold"
    :class="variants[variant]"
    data-testid="badge"
    :data-variant="variant"
  >
    <slot />
  </span>
</template>
