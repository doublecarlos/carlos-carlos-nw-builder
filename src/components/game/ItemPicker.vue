<script setup lang="ts">
// Searchable item typeahead for one slot -- thin wrapper around ComboBox.vue that maps
// Item objects to the generic {value, label} options format and renders the item-specific
// stat preview (plus, given `bonusPreview`, the bonus stats picking it would add now, and
// the ones it's a step toward but hasn't unlocked yet) through ComboBox's `#option` slot --
// or, with `hidePreview`, nothing but the name. The highlighted candidate's full ItemCard sits
// beside the open menu (ComboBox's `#aside` slot).
//
// A native <datalist> was considered and rejected: it cannot show item level and a stat
// preview per row, and its keyboard behavior is not controllable. This is ~120 lines instead.
//
// The component owns only its own transient UI state (open / query / highlight). The chosen
// value is `model` and every change leaves via `update:model`, so the single build document
// in App.vue stays the only source of truth (undo stack has a single place to hook into).
import { ref, shallowRef, computed } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import {
  itemPreview,
  bonusStatPreview,
  hasBonuses,
  int as fmtInt,
} from "../../lib/format";
import { itemScaleFactor, itemScalers } from "../../composables/useItemScale";
import { scaledStat } from "../../engine/scaling";
import { itemSearchText } from "../../lib/item-search";
import {
  candidatePreviews,
  samePreviewInputs,
  type CandidatePreview,
  type PreviewInputs,
} from "../../lib/candidate-preview";
import * as pickerLens from "../../stores/pickerLens";
import { PREFERRED_MARK, itemDisplay } from "../../engine/insignia";
import { qualityColor, toneStyle } from "../../lib/item-quality";
import type { InsigniaGroup } from "../../engine/insignia";
import type { Item, Db, EvaluatedBonus } from "../../types";
import ComboBox from "../ui/ComboBox.vue";
import type { ComboBoxExposed, HighlightSource } from "../ui/ComboBox.vue";
import ItemCard from "./ItemCard.vue";

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
    /** Catalog the candidates came from, used only to widen what a typed query matches
     * (stats and bonus names, via `itemSearchText`). Separate from `bonusPreview.db` because
     * it is useful without a live build -- PresetForm has a catalog but no build to resolve
     * against. Omit it and the dropdown filters on item names alone, as it always did. */
    db?: Db | null;
    /** Build-editor context for a bonus-aware preview: each candidate is hypothetically
     * resolved into `slotId` so the dropdown can show the bonus stats it would add, same as
     * the row's own stat summary would show once it's actually picked. Left
     * unset by callers with no live build to resolve against (PresetForm's item rows, which
     * pick a default for a slot rather than editing a real build). The same resolve also finds
     * the candidates a `hideFromPicker` problem grant withholds, at no extra pass. */
    bonusPreview?: PreviewInputs;
    /** Render bare item names -- no item level, no conditional-bonus marker, no stat/bonus
     * preview lines -- and let the menu match the input's width instead of widening to make
     * room for them. For candidate lists that read as identities rather than gear (the class
     * picker), where a stat comparison between rows is meaningless noise. Affects display
     * only: `hideFromPicker` filtering still runs, since which candidates are *legal* is not
     * a presentation question. */
    hidePreview?: boolean;
    /** DOM id for the underlying input, so a `<label for>` written by an ancestor
     *  (BuildSlot's row label) points at something real. */
    inputId?: string;
    /** What an empty row reads as instead of a bare dash. Display only: the row is still
     * empty. */
    placeholder?: string;
    /** Whether the dropdown offers the empty "- none -" row (`ItemPickerSlot.disallowEmpty`).
     *  Stops an empty value being *chosen*; says nothing about a build already holding one. */
    allowEmpty?: boolean;
    /** Why each candidate in `items` would normally be withheld, keyed by item id
     *  (`db.ts`'s `slotCandidateList`). `items` arrives complete, so this is what decides
     *  which of them are offered (`visibleItems`); the named ones sort last. */
    hiddenReasons?: ReadonlyMap<string, string> | null;
    /** Display the current value and never open, for a derived row. */
    readonly?: boolean;
    /** Headings to list the candidates under, in order (`insignia.ts`'s `bonusGroupsFor`).
     *  One id may appear under several. Anything the groups miss is appended ungrouped, so a
     *  stale grouping narrows the headings rather than losing a candidate. */
    groups?: readonly InsigniaGroup[] | null;
  }>(),
  {
    selectedItem: null,
    invalid: false,
    db: null,
    bonusPreview: undefined,
    hidePreview: false,
    inputId: undefined,
    placeholder: undefined,
    allowEmpty: true,
    hiddenReasons: null,
    readonly: false,
    groups: null,
  },
);

const model = defineModel<string>({ default: "" });

const combobox = ref<ComboBoxExposed | null>(null);

/** Mirrors ComboBox's own open state so the filtering/preview work below can stay gated to
 *  "only while this dropdown is actually open" the same way `matchMap` already was -- see the
 *  comment on `candidateStats` further down. */
const isOpen = ref(false);

/** `bonusPreview`, kept while its db, build and slot are unchanged, so a caller passing a fresh
 *  literal per render does not re-resolve every candidate. */
const previewInputs = computed<PreviewInputs | undefined>((previous) =>
  samePreviewInputs(previous, props.bonusPreview)
    ? previous
    : props.bonusPreview,
);

/** `hidePreview` states something about the call site's own list, so the menu option can only
 *  take previews away, never add them back. */
const previewsHidden = computed(
  () => props.hidePreview || !pickerLens.showPreview.value,
);

/** Mirrored out of ComboBox for the exact-id override alone; filtering stays ComboBox's. */
const query = ref("");

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

/** One resolve per candidate, shared by filtering (`visibleItems`), the row previews
 *  (`matchMap`) and the card. Null while closed, and checked before any resolve, so a closed
 *  picker tracks only `isOpen` and never the build. */
const candidateStats = computed(() => {
  if (!isOpen.value) return null;
  const inputs = previewInputs.value;
  return inputs
    ? candidatePreviews(inputs, props.items)
    : new Map<string, CandidatePreview | null>();
});

/** The caller's `hiddenReasons` plus this component's own conflict check. Names every withheld
 *  candidate, listed or not: `visibleItems` needs the full set to decide from. */
const withheld = computed(() => {
  const map = new Map<string, string>(props.hiddenReasons ?? []);
  for (const [id, stats] of candidateStats.value ?? []) {
    if (stats?.conflict && !map.has(id)) map.set(id, stats.conflict);
  }
  return map;
});

/** A full id is unambiguous, so it offers its item whatever the lens says. The row still
 *  carries the withheld reason. */
const namedById = computed(() => {
  const typed = query.value.trim().toLowerCase();
  return typed && props.items.some((item) => item.id.toLowerCase() === typed)
    ? typed
    : null;
});

/** Where "show unavailable" and the exact-id override are actually applied. Re-shown
 *  candidates sort last, so turning the option on appends rather than reshuffles. */
const visibleItems = computed(() => {
  // Null while closed, and a closed picker has nothing listed to filter.
  if (!candidateStats.value) return props.items;
  const reasons = withheld.value;
  const listed = pickerLens.showHidden.value
    ? [...props.items]
    : props.items.filter(
        (item) =>
          !reasons.has(item.id) || item.id.toLowerCase() === namedById.value,
      );
  return listed.sort(
    (a, b) => Number(reasons.has(a.id)) - Number(reasons.has(b.id)),
  );
});

/** Kept off `matchMap`, which the preview options skip: a row's name is not a preview. */
const displayMap = computed(
  () =>
    new Map(
      visibleItems.value.map((item) => [item.id, itemDisplay(props.db, item)]),
    ),
);

/** The off-screen haystack, limited to whichever picker-option buckets are on.
 *  `itemSearchText` memoizes per catalog, so this is a lookup and a join, not a rebuild. */
function searchTextFor(db: Db | null, item: Item) {
  const parts: string[] = [];
  // The exactly-named item needs its id here too, or ComboBox filters the row back out.
  if (pickerLens.searchById.value || item.id.toLowerCase() === namedById.value)
    parts.push(item.id);
  if (db) {
    const text = itemSearchText(db, item);
    if (pickerLens.searchByStat.value) parts.push(text.stat);
    if (pickerLens.searchByBonus.value) parts.push(text.bonus);
  }
  return parts.join(" ") || undefined;
}

/** Map items to the generic {value, label} format ComboBox expects, plus that `search` blob.
 *  `label` stays the catalog name even where the row draws a shortened one: it is what the
 *  query matches against. */
const options = computed(() => {
  const db = props.db;
  const optionFor = (item: Item, group?: string) => ({
    value: item.id,
    label: item.name,
    search: searchTextFor(db, item),
    group,
  });
  const items = visibleItems.value;
  if (!props.groups) return items.map((item) => optionFor(item));

  const byId = new Map(items.map((item) => [item.id, item]));
  const out: ReturnType<typeof optionFor>[] = [];
  const placed = new Set<string>();
  for (const group of props.groups) {
    for (const id of group.ids) {
      const item = byId.get(id);
      if (!item) continue;
      placed.add(id);
      out.push(optionFor(item, group.label));
    }
  }
  for (const item of items) {
    if (!placed.has(item.id)) out.push(optionFor(item));
  }
  return out;
});

/** Grouping lists a candidate once per heading, so a budget sized for one row per item would
 *  cut the list mid-heading. */
const maxRows = computed(() => (props.groups ? 240 : 60));

/** Decorated once per filter change rather than once per render pass -- and, since this reads
 *  `visibleItems`/`candidateStats`, only pays the per-candidate resolve cost while this
 *  particular dropdown is open, not on every keystroke elsewhere in the build. */
const matchMap = computed(() => {
  const map = new Map<
    string,
    {
      item: Item;
      preview: ReturnType<typeof itemPreview>;
      il: number;
      bonusPreview: ReturnType<typeof bonusStatPreview>;
      potentialPreview: ReturnType<typeof bonusStatPreview>;
      flagged: boolean;
    }
  >();
  // Nothing in the template reads it while previews are off, so skip the formatting work.
  if (previewsHidden.value) return map;
  for (const item of visibleItems.value) {
    const bonusStats = candidateStats.value?.get(item.id) ?? null;
    const bonusPreview = bonusStatPreview(bonusStats?.current);
    const potentialPreview = bonusStatPreview(bonusStats?.potential);
    // One factor per candidate, shared by the row's item level and its stat preview -- ranking
    // mounts by an unscaled item level while the preview under it is scaled would be worse
    // than showing neither.
    const factor = itemScaleFactor(item);
    map.set(item.id, {
      item,
      il: scaledStat(item, "il", factor),
      preview: itemPreview(item, 4, factor),
      bonusPreview,
      // "Potentially" is only worth showing when it says something "current" doesn't already.
      potentialPreview:
        !pickerLens.showPotential.value ||
        sameParts(bonusPreview, potentialPreview)
          ? EMPTY_PREVIEW
          : potentialPreview,
      flagged: hasBonuses(item),
    });
  }
  return map;
});

const int = (value: unknown) => fmtInt(value);

/** Name only: the box is a fixed width, and the row states the star beside it. */
const selectedLabel = computed(() =>
  props.selectedItem ? itemDisplay(props.db, props.selectedItem).name : "",
);

const selectedTone = computed(() => qualityColor(props.selectedItem?.quality));

// --- highlighted candidate's item card ----------------------------------------------------

/** Pause before a pointer-driven highlight reaches the card, so sweeping the list does not
 *  resolve a hypothetical build for every row it crosses. */
const POINTER_CARD_DELAY_MS = 100;

const cardItemId = shallowRef<string | null>(null);
let pendingCardId: string | null = null;
const { start: startCardTimer, stop: stopCardTimer } = useTimeoutFn(
  () => {
    cardItemId.value = pendingCardId;
  },
  POINTER_CARD_DELAY_MS,
  { immediate: false },
);

function onHighlighted(value: string | null, source: HighlightSource) {
  stopCardTimer();
  // Leaving a candidate (the empty row, a closed menu) clears the card at once.
  if (source === "keyboard" || value === null) {
    cardItemId.value = value;
    return;
  }
  pendingCardId = value;
  startCardTimer();
}

const cardItem = computed(() => {
  const id = cardItemId.value;
  if (!id || !pickerLens.showCard.value) return null;
  return props.items.find((item) => item.id === id) ?? null;
});

/** Reads the candidate's resolve from `candidateStats`. Without one (no build, or a resolve
 *  that threw) the card shows the item's own lines and no bonuses. */
const card = computed(() => {
  const item = cardItem.value;
  if (!item) return null;
  const preview = candidateStats.value?.get(item.id) ?? null;
  return {
    item,
    bonuses: preview?.bonuses ?? [],
    bonusById: preview?.bonusById ?? new Map<string, EvaluatedBonus>(),
    context: preview?.ctx ?? null,
    db: previewInputs.value?.db ?? props.db,
    scalers: itemScalers(item),
  };
});

defineExpose({
  /** Focus the underlying input -- same open/clear behavior as a direct click (ComboBox's
   *  own `onFocus` opens the list and starts a fresh query). */
  focus() {
    combobox.value?.focusInput();
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
    :input-id="inputId"
    :model-value="model"
    :invalid="invalid"
    :show-empty-option="allowEmpty"
    :closed-display="selectedLabel"
    :tone="selectedTone"
    :placeholder="selectedLabel || placeholder || '-'"
    :title-input="false"
    :readonly="readonly"
    :max-rows="maxRows"
    :menu-class="previewsHidden ? 'w-(--anchor-width)' : 'w-[min(32rem,90vw)]'"
    @update:model-value="model = $event"
    @update:open="isOpen = $event"
    @update:query="query = $event"
    @update:highlighted="onHighlighted"
  >
    <template v-if="card" #aside>
      <ItemCard
        class="w-80 max-w-[90vw]"
        readonly
        :item="card.item"
        :bonuses="card.bonuses"
        :bonus-by-id="card.bonusById"
        :context="card.context"
        :db="card.db"
        :scalers="card.scalers"
      />
    </template>
    <template #option="{ option }">
      <div class="flex items-baseline gap-1.5" :class="option.group && 'pl-3'">
        <span class="flex min-w-0 flex-1 items-baseline font-semibold">
          <span
            class="overflow-hidden text-ellipsis whitespace-nowrap text-(--tone)"
            :style="toneStyle(displayMap.get(option.value)?.quality)"
            :data-quality="displayMap.get(option.value)?.quality ?? undefined"
            data-testid="picker-option-name"
            >{{ displayMap.get(option.value)?.name ?? option.label }}</span
          >
          <span
            v-if="displayMap.get(option.value)?.preferred"
            class="ml-1 shrink-0 text-accent"
            data-testid="picker-option-preferred"
            title="Preferred"
            >{{ PREFERRED_MARK }}</span
          >
        </span>
        <!-- Why this row is here at all when it would normally be withheld. Outside the
             `previewsHidden` block below: which candidates are legal is not a presentation
             question. -->
        <span
          v-if="withheld.get(option.value)"
          class="shrink-0 text-warn"
          data-testid="picker-option-hidden-reason"
          >{{ withheld.get(option.value) }}</span
        >
        <!-- Both markers describe the item as gear, so they go with the preview lines. -->
        <template v-if="!previewsHidden">
          <!-- Stays a native `title`: this marker lives inside an already-open dropdown, and
               a BaseTooltip here would be a second floating layer stacked over the first. -->
          <span
            v-if="matchMap.get(option.value)?.flagged"
            class="text-accent"
            title="has conditional bonuses"
            >◈</span
          >
          <span
            v-if="matchMap.get(option.value)?.il"
            class="text-muted tabular-nums"
            >iL {{ int(matchMap.get(option.value)?.il) }}</span
          >
        </template>
      </div>
      <template v-if="!previewsHidden && matchMap.has(option.value)">
        <!-- Indented under the name, so the row reads as "item, then what it's worth". -->
        <div
          class="flex flex-col gap-0.5"
          :class="option.group ? 'pl-5' : 'pl-2'"
        >
          <div
            data-testid="picker-option-preview"
            class="flex flex-wrap gap-2 text-text"
          >
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
          <!-- What picking this item would add via bonuses, e.g. a bonus tier it would
               complete -- distinct from the item's own stats above. -->
          <div
            v-if="matchMap.get(option.value)?.bonusPreview?.parts?.length"
            data-testid="picker-option-bonus-preview"
            class="flex flex-wrap gap-2 text-accent"
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
               whenever it would just repeat the "current" line above. -->
          <div
            v-if="matchMap.get(option.value)?.potentialPreview?.parts?.length"
            data-testid="picker-option-potential-preview"
            class="flex flex-wrap items-baseline gap-2 text-muted"
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
