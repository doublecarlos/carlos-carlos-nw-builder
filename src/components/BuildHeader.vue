<script setup lang="ts">
// Top bar: page title, the active build's own action strip (BuildBar), the quick context
// toggles (QuickOptions), the compare picker, and the data-editor entry point.
import { computed } from "vue";
import BuildBar from "./BuildBar.vue";
import ThemeToggle from "./ui/ThemeToggle.vue";
import ComboBox from "./ui/ComboBox.vue";
import QuickOptions from "./QuickOptions.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import BaseNotice from "./ui/BaseNotice.vue";
import * as library from "../stores/library";
import * as buildEditor from "../stores/buildEditor";
import * as compare from "../stores/compare";
import * as engine from "../stores/engine";
import * as ui from "../stores/ui";
import { notice, showNotice } from "../stores/notice";
import { overlayCount } from "../stores/workspace";

const build = library.build;
const db = engine.db;
const compareBuild = compare.compareBuild;
// build_parameter slots (Options/QuickOptions) always have *some* value -- "filled" isn't a
// meaningful state for them, so they don't belong in this count's denominator either.
const itemSlotCount = computed(
  () => db.value.slots.filter((slot) => slot.type === "item_picker").length,
);
</script>

<template>
  <header
    class="flex flex-wrap items-start gap-x-5 gap-y-3 bg-surface px-3.5 py-2"
    data-testid="build-header"
  >
    <div class="flex min-w-38 flex-col gap-1">
      <h1 class="text-base font-semibold tracking-wide">
        Neverwinter build planner
      </h1>
    </div>

    <BuildBar class="flex-1 basis-full" />

    <QuickOptions />

    <div
      class="flex flex-1 basis-full flex-wrap items-center justify-end gap-2 max-sm:justify-start"
    >
      <BaseNotice v-if="notice" @dismiss="showNotice('')">{{
        notice
      }}</BaseNotice>
      <!-- Quick compare: pick another build, see it inline against the active one (slot
           highlights, the stat panel's headline row) -- deliberately just a picker in the
           top bar, not a page of its own. -->
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-sm text-muted">Compare</span>
        <ComboBox
          class="compare-select min-w-48"
          :model-value="build.compare.id"
          :options="compare.compareOptions.value"
          @update:model-value="compare.setCompareBuild"
        />

        <BaseCheckbox
          :model-value="build.compare.highlight"
          :disabled="!compareBuild"
          @update:model-value="
            (v) => compare.setCompareFlag('highlight', v as boolean)
          "
          >Highlight changes</BaseCheckbox
        >
        <BaseCheckbox
          :model-value="build.compare.onlyDiff"
          :disabled="!compareBuild"
          @update:model-value="
            (v) => compare.setCompareFlag('onlyDiff', v as boolean)
          "
          >Only show changes</BaseCheckbox
        >
      </div>

      <BaseButton variant="link" @click="buildEditor.resetAll()"
        >reset</BaseButton
      >
      <span class="text-sm text-muted"
        >{{ buildEditor.filledSlots.value }}/{{ itemSlotCount }} slots</span
      >

      <BaseButton @click="ui.openEditor()">
        Edit data<BaseBadge v-if="overlayCount" variant="edited">{{
          overlayCount
        }}</BaseBadge>
      </BaseButton>
      <ThemeToggle />
    </div>
  </header>
</template>
