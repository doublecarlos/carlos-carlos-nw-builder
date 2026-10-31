<script setup lang="ts">
// The quick options above a phone's stats pane, so a toggle can be flipped while watching
// the numbers. Collapsed by default to one summary line, keeping the pane for the stats.
import { computed } from "vue";
import { ChevronDown, ChevronRight } from "@lucide/vue";
import QuickOptions from "./QuickOptions.vue";
import { getPath } from "../../lib/build-path";
import { slotShown } from "../../lib/slot-availability";
import {
  isQuick,
  quickSummary,
  type QuickSlot,
  type QuickValue,
} from "../../lib/quick-summary";
import * as engine from "../../stores/resolved";
import * as shell from "../../stores/shell";
import type { Build } from "../../types";

const props = defineProps<{ build: Build }>();

function valueOf(slot: QuickSlot): QuickValue {
  if (slot.type === "item_picker") {
    const id = props.build.choices[slot.id] ?? "";
    return {
      label: slot.label,
      value: engine.db.value.get(id)?.name ?? (id || "none"),
    };
  }
  const value = getPath(props.build.context, slot.path) ?? slot.default;
  if (slot.paramType === "boolean")
    return { label: slot.label, value: Boolean(value) };
  const option = slot.options?.find((entry) => entry.value === value);
  return { label: slot.label, value: option?.label ?? String(value ?? "") };
}

const summary = computed(() =>
  quickSummary(
    engine.db.value.slots
      .filter(isQuick)
      .filter((slot) => slotShown(slot, engine.hiddenSlots.value))
      .map(valueOf),
  ),
);
</script>

<template>
  <div
    class="border-b border-line bg-surface px-2.5 py-1.5"
    data-testid="quick-band"
  >
    <button
      type="button"
      class="flex w-full items-center gap-1.5 text-left"
      :aria-expanded="shell.quickBandOpen.value"
      data-testid="quick-band-toggle"
      @click="shell.quickBandOpen.value = !shell.quickBandOpen.value"
    >
      <ChevronDown v-if="shell.quickBandOpen.value" class="shrink-0" />
      <ChevronRight v-else class="shrink-0" />
      <span class="shrink-0 font-semibold">Quick options</span>
      <span
        v-if="!shell.quickBandOpen.value"
        class="min-w-0 truncate text-muted"
        data-testid="quick-band-summary"
        >{{ summary }}</span
      >
    </button>
    <QuickOptions
      v-if="shell.quickBandOpen.value"
      class="mt-1.5"
      :build="build"
    />
  </div>
</template>
