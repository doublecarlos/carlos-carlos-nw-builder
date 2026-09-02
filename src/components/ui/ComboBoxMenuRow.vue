<script setup lang="ts">
// One row inside ComboBoxMenu.vue. `data-highlighted` is a JS/scroll-into-view hook (see
// ComboBox.vue's `watch(highlight, ...)`), kept separate from the `highlighted` prop's
// Tailwind styling so restyling the row never breaks that lookup.
//
// `highlighted` and `selected` look alike but say different things, and assistive tech needs
// both: `highlighted` is where the keyboard cursor currently sits (what the input's
// `aria-activedescendant` points at), `selected` is the option the model actually holds.
withDefaults(
  defineProps<{
    highlighted?: boolean;
    muted?: boolean;
    /** This row's own id, referenced by the input's `aria-activedescendant`. */
    id?: string;
    selected?: boolean;
    /** Status text -- a "no match" line, a truncation footer -- rather than something
     *  choosable. Kept out of the listbox's option set: a listbox's children are meant to be
     *  its options, and being counted as one ("option 4 of 4") would misreport how many
     *  choices there actually are. */
    presentational?: boolean;
    /** Overridden by rows that are not choices at all -- a group heading -- so a spec asking
     *  for `picker-option` never has to filter them back out. */
    testid?: string;
  }>(),
  {
    highlighted: false,
    muted: false,
    id: undefined,
    selected: false,
    presentational: false,
    testid: "picker-option",
  },
);

defineSlots<{
  default(): unknown;
}>();
</script>

<template>
  <div
    :id="id"
    :role="presentational ? 'presentation' : 'option'"
    :aria-selected="presentational ? undefined : selected ? 'true' : 'false'"
    class="cursor-pointer px-2 py-1"
    :class="[highlighted && 'bg-accent-soft', muted && 'italic text-muted']"
    :data-highlighted="highlighted || undefined"
    :data-testid="testid"
  >
    <slot />
  </div>
</template>
