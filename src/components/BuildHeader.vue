<script setup lang="ts">
// Top bar: page title, the active build's own action strip (BuildBar), the quick context
// toggles (QuickOptions), and the data-editor entry point.
import { computed } from "vue";
import BuildBar from "./BuildBar.vue";
import ThemeToggle from "./ui/ThemeToggle.vue";
import QuickOptions from "./QuickOptions.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import BaseNotice from "./ui/BaseNotice.vue";
import * as buildEditor from "../stores/buildEditor";
import * as engine from "../stores/engine";
import * as ui from "../stores/ui";
import { notice, showNotice } from "../stores/notice";
import { overlayCount } from "../stores/workspace";
// build_parameter slots (Options/QuickOptions) always have *some* value -- "filled" isn't a
// meaningful state for them, so they don't belong in this count's denominator either.
const itemSlotCount = computed(
  () =>
    engine.db.value.slots.filter((slot) => slot.type === "item_picker").length,
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
