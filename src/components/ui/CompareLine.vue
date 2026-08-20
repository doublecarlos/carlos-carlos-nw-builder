<script setup lang="ts">
// The compare build's own value, stacked under this build's in the same cell (StatPanel.vue's
// ratings table and StatPairsTable.vue). Deliberately not a table row of its own: keeping the
// pair inside one <tr> leaves row striping, the ratings table's group dividers and the hover
// outline working on the stat they belong to, and each cell's second line still lines up with
// the column above it. The dashed rule stands in for the row border it therefore doesn't get.
//
// Recedes by opacity rather than by a muted colour, so a caller that has a meaningful colour
// to give the line (the ratings table's capped/overcapped state) keeps it legible, and one
// that doesn't simply inherits the cell's own.
//
// `fitRight` shrinks the line -- and with it the rule -- to its own text, against the cell's
// right edge. The number cells want the rule spanning their whole column, under the value it
// belongs to; the label cell's would otherwise run the full width of the stat's name.
//
// `title` carries the untruncated text -- the build-name variant is the one that overflows.
defineProps<{ text: string; title?: string; fitRight?: boolean }>();
</script>

<template>
  <span
    class="block truncate border-t border-dashed border-muted leading-tight opacity-70"
    :class="fitRight && 'ml-auto w-fit max-w-full'"
    :title="title"
    data-testid="compare-line"
    >{{ text }}</span
  >
</template>
