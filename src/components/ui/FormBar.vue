<script setup lang="ts">
// Sticky action bar at the top of an editing form (ItemForm/BonusForm/PresetForm).
// The parent's scroll container carries no top padding, so this bar's own `p-3` sits
// flush against the container's top edge -- avoids a sticky element needing a negative
// margin to cancel a fractional-pixel top padding, which rounds to a different device
// pixel than the padding itself and leaves a hairline gap. The container's *horizontal*
// padding is still cancelled the usual way, via this bar's `-mx-3 mb-3`.
</script>

<template>
  <div
    data-testid="form-bar"
    class="sticky top-0 z-2 flex flex-wrap items-center gap-1.5 border-b border-line bg-surface p-3"
  >
    <slot />
  </div>
</template>
