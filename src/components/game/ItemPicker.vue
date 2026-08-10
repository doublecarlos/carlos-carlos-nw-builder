<script setup lang="ts">
// Searchable item typeahead for one slot -- thin wrapper around ComboBox.vue that maps
// Item objects to the generic {value, label} options format and renders the item-specific
// stat preview (plus, given `bonusPreview`, the bonus stats picking it would add now, and
// the ones it's a step toward but hasn't unlocked yet) through ComboBox's `#option` slot.
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
     * fallen out of it (e.g. a class change narrowing `allowedClass`). */
    selectedItem?: Item | null;
    invalid?: boolean;
    /** Build-editor context for a bonus-aware preview: each candidate is hypothetically
     * resolved into `slotId` so the dropdown can show the bonus stats it would add, same as
     * the row's own stat summary would show once it's actually picked (issue #116). Left
     * unset by callers with no live build to resolve against (PresetForm's item rows, which
     * pick a default for a slot rather than editing a real build). `filterHidden` (default
     * true) governs whether a candidate that would activate a `hideFromPicker` problem grant
     * is dropped from the dropdown entirely -- the resolve already happens per candidate for
     * the preview below, so this reads off the same result rather than costing anything extra.
     * Left as a plain field on this same object (rather than its own prop) so a future
     * "ignore picker filters" what-if toggle only has to change what the caller passes here,
     * not this component. */
    bonusPreview?: {
      db: Db;
      build: Build;
      slotId: string;
      filterHidden?: boolean;
    };
  }>(),
  {
    selectedItem: null,
    invalid: false,
    bonusPreview: undefined,
  },
);

const model = defineModel<string>({ default: "" });

const combobox = ref<InstanceType<typeof ComboBox> | null>(null);

/** Mirrors ComboBox's own open state so the filtering/preview work below can stay gated to
 *  "only while this dropdown is actually open" the same way `matchMap` already was -- see the
 *  comment on `candidateStats` further down. */
const isOpen = ref(false);

interface BonusStatsPreview {
  /** What's active if `item` is picked -- same attribution `EngineRow` itself sums into a
   *  row's stats, so this matches what the row's own stat summary would show once the item
   *  is actually picked. */
  current: Record<string, number>;
  /** The ceiling: bonuses `item` itself contributes to (issue #125) that aren't active in
   *  this hypothetical build -- e.g. a set piece it would count toward but not complete on
   *  its own. Sourced from `previewStats`, the same near-miss payload BonusInspector.vue
   *  and ItemCard.vue already show for equipped items' inactive bonuses. */
  potential: Record<string, number>;
  /** True when picking `item` here would activate a bonus grant flagged
   *  `hideFromPicker` -- the candidate should be left out of the dropdown entirely rather
   *  than merely flagged, unless the caller opted out via `bonusPreview.filterHidden`. */
  filtered: boolean;
}

/**
 * The bonus stats `item` would add if it were slotted into `bonusPreview.slotId` -- resolved
 * by cloning the active build with just that one slot's choice swapped, then reading the
 * engine's own attribution/near-miss data off the result. A bad candidate/build combination
 * fails resolution rather than crash the whole dropdown -- the preview just stays empty for
 * that one row.
 */
function previewBonusStats(item: Item): BonusStatsPreview | null {
  const ctx = props.bonusPreview;
  if (!ctx) return null;
  try {
    const hypothetical: Build = {
      ...ctx.build,
      choices: { ...ctx.build.choices, [ctx.slotId]: item.id },
    };
    const result = engine.resolveBuild(ctx.db, hypothetical);

    const current: Record<string, number> = {};
    for (const bonus of result.bonuses) {
      if (!bonus.active || bonus.slotId !== ctx.slotId || !bonus.appliedStats)
        continue;
      for (const [key, value] of Object.entries(bonus.appliedStats)) {
        current[key] = (current[key] ?? 0) + (value ?? 0);
      }
    }

    // `db.bonusesFor(item)` -- item's own contribution list -- rather than filtering
    // `result.bonuses` by slotId: an inactive bonus has no "instancing slot" worth trusting,
    // so membership is what decides whether this candidate is one of its sources at all. Also
    // used for the "hideFromPicker" check below, for the same reason: a problem grant's own
    // `EvaluatedBonus.slotId` is just whichever contributing slot happened to sort first, not
    // necessarily this one, so slot attribution can't be trusted to find it.
    const bonusById = new Map(result.bonuses.map((bonus) => [bonus.id, bonus]));
    const potential: Record<string, number> = {};
    let filtered = false;
    for (const candidate of ctx.db.bonusesFor(item)) {
      const resolved = bonusById.get(candidate.bonus.id);
      if (!resolved) continue;
      if (resolved.active && resolved.problems.some((p) => p.hideFromPicker)) {
        filtered = true;
      }
      if (resolved.active || resolved.excluded || !resolved.previewStats)
        continue;
      for (const [key, value] of Object.entries(resolved.previewStats)) {
        potential[key] = (potential[key] ?? 0) + (value ?? 0);
      }
    }

    return { current, potential, filtered };
  } catch {
    return null;
  }
}

/** Same formatted parts, so "potential" can be hidden when it would just repeat "current". */
const sameParts = (
  a: ReturnType<typeof bonusStatPreview>,
  b: ReturnType<typeof bonusStatPreview>,
) =>
  a.more === b.more &&
  a.parts.length === b.parts.length &&
  a.parts.every((part, i) => part === b.parts[i]);

const EMPTY_PREVIEW: ReturnType<typeof bonusStatPreview> = {
  parts: [],
  more: 0,
};

/** Per-candidate resolve results, keyed by item id -- computed once per item and shared by
 *  both `visibleItems` (filtering) and `matchMap` (preview) below, rather than resolving twice.
 *  `null` while closed, so touching it costs nothing: the `isOpen` guard runs *before* any
 *  `previewBonusStats` call, so a closed picker's `options`/`matchMap` (both derived from this)
 *  track only `isOpen`/`props.items` as reactive dependencies, not the deep build state
 *  `resolveBuild` reads -- same "closed rows never pay the cost" property `matchMap` alone used
 *  to have, now shared across filtering too. */
const candidateStats = computed(() => {
  if (!isOpen.value) return null;
  const map = new Map<string, BonusStatsPreview | null>();
  for (const item of props.items) map.set(item.id, previewBonusStats(item));
  return map;
});

/** `items` narrowed by any active `hideFromPicker` problem grant a candidate would trigger.
 *  Filtering is opt-out via `bonusPreview.filterHidden === false`, kept toggleable per-caller
 *  so a future "ignore picker filters" what-if setting can flip it off without changing this
 *  component. */
const visibleItems = computed(() => {
  const stats = candidateStats.value;
  if (!stats || props.bonusPreview?.filterHidden === false) return props.items;
  return props.items.filter((item) => !stats.get(item.id)?.filtered);
});

/** Map items to the generic {value, label} format ComboBox expects. */
const options = computed(() =>
  visibleItems.value.map((item) => ({ value: item.id, label: item.name })),
);

/** Decorated once per filter change rather than once per render pass -- and, since this reads
 *  `visibleItems`/`candidateStats`, only pays the per-candidate resolve cost while this
 *  particular dropdown is open, not on every keystroke elsewhere in the build. */
const matchMap = computed(() => {
  const map = new Map<
    string,
    {
      item: Item;
      preview: ReturnType<typeof itemPreview>;
      bonusPreview: ReturnType<typeof bonusStatPreview>;
      potentialPreview: ReturnType<typeof bonusStatPreview>;
      flagged: boolean;
    }
  >();
  for (const item of visibleItems.value) {
    const bonusStats = candidateStats.value?.get(item.id) ?? null;
    const bonusPreview = bonusStatPreview(bonusStats?.current);
    const potentialPreview = bonusStatPreview(bonusStats?.potential);
    map.set(item.id, {
      item,
      preview: itemPreview(item, 3),
      bonusPreview,
      // "Potentially" is only worth showing when it says something "current" doesn't already.
      potentialPreview: sameParts(bonusPreview, potentialPreview)
        ? EMPTY_PREVIEW
        : potentialPreview,
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
    wide
    @update:model-value="model = $event"
    @update:open="isOpen = $event"
  >
    <template #option="{ option }">
      <template v-if="matchMap.has(option.value)">
        <div class="flex items-baseline gap-1.5">
          <span
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-semibold"
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
        <!-- Indented under the name, so the row reads as "item, then what it's worth". -->
        <div class="flex flex-col gap-0.5 pl-2">
          <div class="flex flex-wrap gap-2 text-sm text-text">
            <span
              v-for="part in matchMap.get(option.value)?.preview?.parts ?? []"
              :key="part"
              >{{ part }}</span
            >
            <span
              v-if="matchMap.get(option.value)?.preview?.more"
              class="italic"
              >+{{ matchMap.get(option.value)?.preview?.more }} more</span
            >
          </div>
          <!-- What picking this item would add via bonuses, e.g. a set piece it would
               complete -- distinct from the item's own stats above (issue #116). -->
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
          <!-- The ceiling: bonuses this item contributes to that aren't active yet -- hidden
               whenever it would just repeat the "current" line above (issue #125). -->
          <div
            v-if="matchMap.get(option.value)?.potentialPreview?.parts?.length"
            data-testid="picker-option-potential-preview"
            class="flex flex-wrap items-baseline gap-2 text-sm text-muted"
          >
            <span class="italic">Potentially:</span>
            <span
              v-for="part in matchMap.get(option.value)?.potentialPreview
                ?.parts ?? []"
              :key="part"
              >{{ part }}</span
            >
            <span
              v-if="matchMap.get(option.value)?.potentialPreview?.more"
              class="italic"
              >+{{
                matchMap.get(option.value)?.potentialPreview?.more
              }}
              more</span
            >
          </div>
        </div>
      </template>
    </template>
  </ComboBox>
</template>
