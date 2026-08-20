<script setup lang="ts">
// The "go to" palette: one search box over every place in the app worth jumping to -- sections
// and their slots, plus builds and layers.
//
// Deliberately navigate-only, not a command palette. Verbs ("expand all", "new build") need
// confirmation, undo and a different result-row shape; keeping them out is what lets this be a
// list of destinations you can hit blind.
//
// It does not duplicate the slot filter (Mod+/): that narrows the list *in place* and stays
// on, answering "show me only these". This takes you somewhere and gets out of the way.
import { computed, nextTick, onMounted, ref, useTemplateRef, watch } from "vue";
import { onKeyStroke } from "@vueuse/core";
import BaseModal from "./ui/BaseModal.vue";
import { rankEntries, type GoToEntry } from "../lib/go-to";
import { useGoToEntries } from "../composables/useGoToEntries";
import * as goTo from "../stores/goTo";
import * as selection from "../stores/selection";
import * as builds from "../stores/builds";

const KIND_LABEL: Record<GoToEntry["kind"], string> = {
  section: "Section",
  slot: "Slot",
  build: "Build",
  layer: "Layer",
};

const modal = useTemplateRef<InstanceType<typeof BaseModal>>("modal");
const input = useTemplateRef<HTMLInputElement>("input");
const list = useTemplateRef<HTMLElement>("list");
const query = ref("");
const highlight = ref(0);

const entries = useGoToEntries();
const results = computed(() => rankEntries(entries.value, query.value));

// Typing changes what row 0 *is*, so the highlight goes back to the top rather than staying on
// an index that now points at something unrelated.
watch(query, () => (highlight.value = 0));

watch(highlight, async () => {
  await nextTick();
  list.value
    ?.querySelector("[data-highlighted]")
    ?.scrollIntoView({ block: "nearest" });
});

// The palette is mounted only while open (`v-if` in AppHeader), so this runs once per opening,
// after BaseModal has focused its panel -- taking the focus here is what makes Mod+K straight
// into typing.
onMounted(() => input.value?.focus());

function move(delta: number) {
  const count = results.value.length;
  if (!count) return;
  // Wraps: a palette list is short and circular movement beats hitting an invisible wall.
  highlight.value = (highlight.value + delta + count) % count;
}

/**
 * Jumping to a section or slot needs the Build editor, which is not on screen while a layer is
 * selected -- so selecting the build comes first, and the request waits in the store until
 * BuildEditor mounts and consumes it. `builds.build` always resolves to a build (falling back
 * to the first), so there is always one to go back to.
 */
function choose(entry: GoToEntry) {
  if (entry.kind === "build") {
    selection.selectBuild(entry.id);
    goTo.close();
    return;
  }
  if (entry.kind === "layer") {
    selection.selectLayer(entry.id);
    goTo.close();
    return;
  }
  if (selection.selection.value?.kind !== "build") {
    selection.selectBuild(builds.build.value.id);
  }
  goTo.requestJump({
    sectionId: entry.kind === "slot" ? entry.sectionId! : entry.id,
    slotId: entry.kind === "slot" ? entry.id : undefined,
  });
  // The destination takes the focus -- a slot jump parks the keyboard cursor on its row, and
  // handing focus back to whatever opened the palette would undo that immediately.
  modal.value?.releaseFocus();
  goTo.close();
}

onKeyStroke("ArrowDown", (event) => {
  event.preventDefault();
  move(1);
});
onKeyStroke("ArrowUp", (event) => {
  event.preventDefault();
  move(-1);
});
onKeyStroke("Enter", (event) => {
  event.preventDefault();
  const entry = results.value[highlight.value];
  if (entry) choose(entry);
});
</script>

<template>
  <BaseModal
    ref="modal"
    label="Go to"
    align="top"
    panel-class="max-h-[70vh] w-[520px]"
    data-testid="go-to-palette"
    @close="goTo.close()"
  >
    <input
      ref="input"
      v-model="query"
      type="text"
      role="combobox"
      aria-expanded="true"
      aria-controls="go-to-list"
      :aria-activedescendant="
        results[highlight] ? `go-to-${results[highlight].key}` : undefined
      "
      aria-label="Go to a section, slot, build or layer"
      data-testid="go-to-input"
      class="w-full border-b border-line bg-surface px-3 py-2.5 focus:outline-none"
      placeholder="Go to a section, slot, build or layer…"
    />

    <div
      id="go-to-list"
      ref="list"
      role="listbox"
      aria-label="Destinations"
      class="min-h-0 flex-1 overflow-y-auto py-1"
    >
      <!-- Rows are spelled out here rather than reusing ComboBoxMenuRow: that row carries
           the pickers' own `picker-option` test id, and a palette result answering to it
           would quietly widen every picker assertion in the suite. -->
      <div v-if="!results.length" class="px-3 py-1 italic text-muted">
        Nothing matches “{{ query }}”
      </div>
      <div
        v-for="(entry, index) in results"
        :id="`go-to-${entry.key}`"
        :key="entry.key"
        role="option"
        :aria-selected="index === highlight ? 'true' : 'false'"
        class="flex cursor-pointer items-baseline gap-2 px-3 py-1"
        :class="index === highlight && 'bg-accent-soft'"
        :data-highlighted="index === highlight || undefined"
        :data-testid="`go-to-option-${entry.key}`"
        @mousemove="highlight = index"
        @click="choose(entry)"
      >
        <span class="flex-none">{{ entry.label }}</span>
        <span v-if="entry.detail" class="min-w-0 truncate text-muted">{{
          entry.detail
        }}</span>
        <span class="ml-auto flex-none text-xs uppercase text-muted">{{
          KIND_LABEL[entry.kind]
        }}</span>
      </div>
    </div>
  </BaseModal>
</template>
