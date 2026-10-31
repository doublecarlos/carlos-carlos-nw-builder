<script setup lang="ts">
// The quick options on a phone, as one summary line that opens the controls in a bottom
// sheet. The line never grows, so neither pane gives up room for it, and on the Stats pane the
// numbers above the sheet follow each change.
import { computed, ref } from "vue";
import { SlidersHorizontal } from "@lucide/vue";
import BaseSheet from "../ui/BaseSheet.vue";
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
import type { Build } from "../../types";

// Attrs land on the summary line, not the teleported sheet.
defineOptions({ inheritAttrs: false });

const props = defineProps<{ build: Build }>();

const open = ref(false);

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
  <button
    type="button"
    class="flex items-center gap-1.5 bg-surface px-2.5 py-1.5 text-left"
    aria-haspopup="dialog"
    data-testid="quick-band-toggle"
    v-bind="$attrs"
    @click="open = true"
  >
    <SlidersHorizontal class="size-4 shrink-0 text-muted" />
    <span class="shrink-0 font-semibold">Quick options</span>
    <span
      class="min-w-0 truncate text-muted"
      data-testid="quick-band-summary"
      >{{ summary }}</span
    >
  </button>
  <BaseSheet
    v-if="open"
    side="bottom"
    title="Quick options"
    data-testid="quick-sheet"
    @close="open = false"
  >
    <div class="min-h-0 overflow-y-auto p-3">
      <QuickOptions :build="build" />
    </div>
  </BaseSheet>
</template>
