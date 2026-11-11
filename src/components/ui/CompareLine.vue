<script setup lang="ts">
// The compare build's own value, on a second row under this build's (StatPanel.vue's ratings
// table and StatPanelPairsTable.vue). Both rows share one tbody per stat, so striping, the
// ratings table's group dividers and the hover outline cover the pair. The dashed rule stands
// in for the row border between them.
//
// Recedes by opacity rather than by a muted color, so a caller that has a meaningful color
// to give the line (the ratings table's capped/overcapped state) keeps it legible, and one
// that doesn't simply inherits the cell's own.
//
// `fitRight` shrinks the line -- and with it the rule -- to its own text, against the cell's
// right edge. The number cells want the rule spanning their whole column, under the value it
// belongs to; the label cell's would otherwise run the full width of the stat's name.
//
// `title` carries the untruncated text -- the build-name variant is the one that overflows.
// The wrapper's inline-size containment keeps that name out of the column's width, so
// a long one truncates to the cell instead of widening the table past a narrow panel.
defineProps<{ text: string; title?: string; fitRight?: boolean }>();
</script>

<template>
  <span class="block" :class="fitRight && 'contain-inline-size'">
    <span
      class="block truncate border-t border-dashed border-muted leading-tight opacity-70"
      :class="fitRight && 'ml-auto w-fit max-w-full'"
      :title="title"
      data-testid="compare-line"
      >{{ text }}</span
    >
  </span>
</template>
