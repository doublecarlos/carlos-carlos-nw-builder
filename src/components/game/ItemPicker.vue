<script setup lang="ts">
// Searchable item typeahead for one slot -- thin wrapper around ComboBox.vue that maps
// Item objects to the generic {value, label} options format and renders the item-specific
// stat preview (plus, given `bonusPreview`, the bonus stats picking it would add) through
// ComboBox's `#option` slot.
//
// A native <datalist> was considered and rejected: it cannot show item level and a stat
// preview per row, and its keyboard behaviour is not controllable. This is ~120 lines instead.
//
// The component owns only its own transient UI state (open / query / highlight). The chosen
// value is `model` and every change leaves via `update:model`, so the single build document
// in App.vue stays the only source of truth (undo stack has a single place to hook into).
import { ref, computed } from "vue";
import {
  itemPreview,
  bonusStatPreview,
  hasBonuses,
  int as fmtInt,
} from "../../lib/format";
import * as engine from "../../engine/engine";
import type { Item, Db, Build } from "../../types";
import ComboBox from "../ui/ComboBox.vue";

const props = withDefaults(
  defineProps<{
    items: Item[];
    /** The item `modelValue` (an id) currently resolves to, or null/undefined for an empty
     * slot -- drives the closed box's display text/placeholder. Passed down already-resolved
     * by the caller (BuildSlot.vue already has it) rather than looked up here, since `items`
     * is only this slot's *selectable* list and would miss an equipped item that's since
     * fallen out of it (e.g. a class/race change narrowing `allowedClass`/`allowedRace`). */
    selectedItem?: Item | null;
    invalid?: boolean;
    /** Build-editor context for a bonus-aware preview: each candidate is hypothetically
     * resolved into `slotId` so the dropdown can show the bonus stats it would add, same as
     * the row's own stat summary would show once it's actually picked (issue #116). Left
     * unset by callers with no live build to resolve against (PresetForm's item rows, which
     * pick a default for a slot rather than editing a real build). */
    bonusPreview?: { db: Db; build: Build; slotId: string };
  }>(),
  {
    selectedItem: null,
    invalid: false,
    bonusPreview: undefined,
  },
);

const model = defineModel<string>({ default: "" });

const combobox = ref<InstanceType<typeof ComboBox> | null>(null);

/** Map items to the generic {value, label} format ComboBox expects. */
const options = computed(() =>
  props.items.map((item) => ({ value: item.id, label: item.name })),
);

/**
 * The bonus stats `item` would add if it were slotted into `bonusPreview.slotId` -- resolved
 * by cloning the active build with just that one slot's choice swapped, then reading which
 * active bonuses the engine attributes back to that same slot (same attribution `EngineRow`
 * itself sums into a row's stats, so this matches what the row's own stat summary would show
 * once the item is actually picked). A bad candidate/build combination fails resolution
 * rather than crash the whole dropdown -- the preview just stays empty for that one row.
 */
function previewBonusStats(item: Item): Record<string, number> | null {
  const ctx = props.bonusPreview;
  if (!ctx) return null;
  try {
    const hypothetical: Build = {
      ...ctx.build,
      choices: { ...ctx.build.choices, [ctx.slotId]: item.id },
    };
    const result = engine.resolveBuild(ctx.db, hypothetical);
    const stats: Record<string, number> = {};
    for (const bonus of result.bonuses) {
      if (!bonus.active || bonus.slotId !== ctx.slotId || !bonus.appliedStats)
        continue;
      for (const [key, value] of Object.entries(bonus.appliedStats)) {
        stats[key] = (stats[key] ?? 0) + (value ?? 0);
      }
    }
    return stats;
  } catch {
    return null;
  }
}

/** Decorated once per filter change rather than once per render pass -- and, since this is a
 *  lazy `computed` only ever read from the (`v-if="open"`-gated) option list, only while this
 *  particular dropdown is open, not on every keystroke elsewhere in the build. */
const matchMap = computed(() => {
  const map = new Map<
    string,
    {
      item: Item;
      preview: ReturnType<typeof itemPreview>;
      bonusPreview: ReturnType<typeof bonusStatPreview>;
      flagged: boolean;
    }
  >();
  for (const item of props.items) {
    map.set(item.id, {
      item,
      preview: itemPreview(item, 3),
      bonusPreview: bonusStatPreview(previewBonusStats(item)),
      flagged: hasBonuses(item),
    });
  }
  return map;
});

const int = (value: unknown) => fmtInt(value);

defineExpose({
  /** Focus the underlying input -- same open/clear behavior as a direct click (ComboBox's
   *  own `onFocus` opens the list and starts a fresh query). */
  focus() {
    combobox.value?.$el?.querySelector("input")?.focus();
  },
  /** Delegates to ComboBox's focusAndSeed. */
  focusAndSeed(char: string) {
    combobox.value?.focusAndSeed(char);
  },
});
</script>

<template>
  <ComboBox
    ref="combobox"
    :options="options"
    :model-value="model"
    :invalid="invalid"
    :show-empty-option="true"
    :closed-display="selectedItem?.name ?? ''"
    :placeholder="selectedItem?.name || '—'"
    @update:model-value="model = $event"
  >
    <template #option="{ option }">
      <template v-if="matchMap.has(option.value)">
        <div class="flex items-baseline gap-1.5">
          <span
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
            >{{ option.label }}</span
          >
          <span
            v-if="matchMap.get(option.value)?.flagged"
            class="text-sm text-accent"
            title="has conditional bonuses"
            >◈</span
          >
          <span
            v-if="matchMap.get(option.value)?.item?.il"
            class="text-sm text-muted tabular-nums"
            >iL {{ int(matchMap.get(option.value)?.item?.il) }}</span
          >
        </div>
        <div class="flex flex-wrap gap-2 text-sm text-muted">
          <span
            v-for="part in matchMap.get(option.value)?.preview?.parts ?? []"
            :key="part"
            >{{ part }}</span
          >
          <span v-if="matchMap.get(option.value)?.preview?.more" class="italic"
            >+{{ matchMap.get(option.value)?.preview?.more }} more</span
          >
        </div>
        <!-- What picking this item would add via bonuses, e.g. a set piece it would complete --
             distinct from the item's own stats above (issue #116). -->
        <div
          v-if="matchMap.get(option.value)?.bonusPreview?.parts?.length"
          data-testid="picker-option-bonus-preview"
          class="flex flex-wrap gap-2 text-sm text-accent"
        >
          <span
            v-for="part in matchMap.get(option.value)?.bonusPreview?.parts ??
            []"
            :key="part"
            >{{ part }}</span
          >
          <span
            v-if="matchMap.get(option.value)?.bonusPreview?.more"
            class="italic"
            >+{{ matchMap.get(option.value)?.bonusPreview?.more }} more</span
          >
        </div>
      </template>
    </template>
  </ComboBox>
</template>
