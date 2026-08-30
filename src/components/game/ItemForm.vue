<script setup lang="ts">
// Editing form for one item. Hybrid approach:
// - Existing items (source != null): live edits, changes emit immediately
// - New items (source == null): explicit Save button, draft until name is finalized
import { ref, computed, watch } from "vue";
import ItemBonuses from "./ItemBonuses.vue";
import BuildParamInput from "./BuildParamInput.vue";
import TokenInput from "../ui/TokenInput.vue";
import CreatableComboBox from "../ui/CreatableComboBox.vue";
import PercentInput from "../ui/PercentInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import { Copy, Plus, Save, Trash, Undo2 } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import FormBar from "../ui/FormBar.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import IdField from "../ui/IdField.vue";
import FormSection from "../ui/FormSection.vue";
import { NW_SCHEMA } from "../../data/data";
import { findParamSlot } from "../../lib/build-path";
import * as catalog from "../../data/catalog";
import { deepEqual } from "../../lib/deep-equal";
import { useDraftHistory } from "../../composables/useDraftHistory";
import { isPercentKind, kindOf, statPickerOptions } from "../../lib/format";
import { focusNextCombo } from "../../lib/stat-row-nav";
import type {
  Item,
  Db,
  Bonus,
  BuildParameterSlot,
  BonusOccurrenceConfig,
} from "../../types";
import type { StatRow } from "../../engine/bonus-draft";
import BaseCheckbox from "../ui/BaseCheckbox.vue";

const props = withDefaults(
  defineProps<{
    /** The item being edited, or null for a brand-new one. */
    source?: Item | null;
    /** Seed values for a brand-new draft, copied from an existing item ("Duplicate").
     *  Ignored once `source` is set -- only meaningful while creating a new item. */
    duplicateFrom?: Item | null;
    status?: string;
    db: Db;
    filters?: string[];
    /** Every known bonus id, forwarded to ItemBonuses for id-collision avoidance and
     *  "attach an existing bonus". */
    allBonusIds?: string[];
    tags?: string[];
    bonusIds?: string[];
    allocatableIds?: string[];
  }>(),
  {
    source: null,
    duplicateFrom: null,
    status: "base",
    filters: () => [],
    allBonusIds: () => [],
    tags: () => [],
    bonusIds: () => [],
    allocatableIds: () => [],
  },
);

const emit = defineEmits<{
  /** Emitted on every change for existing items (debounced). */
  "update:item": [payload: { item: Item; label: string }];
  /** Emitted on Save click for new items. */
  save: [payload: { item: Item }];
  delete: [];
  duplicate: [];
  revert: [];
  "save-bonus": [payload: { id: string; bonus: Bonus }];
  "delete-bonus": [id: string];
  "update-bonus": [payload: { id: string; bonus: Bonus }];
}>();

/** One attached bonus's editable occurrence bounds -- mirrors `BonusOccurrenceConfig`'s
 *  own `min`/`max`/`default`, just widened to `number | string | null` like every other
 *  numeric draft field here so a cleared input reads as empty rather than `0`. `label` mirrors
 *  the config's own optional field directly (always a string here -- "" reads as unset, same
 *  as `DynamicStatDraft.label`). */
export interface OccurrenceDraft {
  min: number | string | null;
  max: number | string | null;
  default: number | string | null;
  label: string;
}

/** One `DynamicStatConfig` row -- widened to `number | string | null` like every other
 *  numeric draft field here so a cleared input reads as empty rather than `0`. */
export interface DynamicStatDraft {
  stat: string;
  min: number | string | null;
  max: number | string | null;
  default: number | string | null;
  label: string;
}

export interface ItemDraft {
  name: string;
  filter: string;
  shortDescription: string;
  longDescription: string;
  maxCopies: number | string | null;
  allowedClass: string[];
  tags: string[];
  gameIds: string[];
  bonuses: string[];
  /** Present only for a bonus id upgraded to a `BonusOccurrenceConfig` -- absence means a
   *  plain-id attachment (always 1 occurrence), same "optional fields" convention
   *  `DynamicStatDraft` uses. Keyed by bonus id, not array index, since it tracks
   *  `draft.bonuses` entries by identity. */
  bonusOccurrences: Record<string, OccurrenceDraft>;
  excludes: string[];
  dynamicStats: DynamicStatDraft[];
  repetitionMin: number | string | null;
  repetitionMax: number | string | null;
  repetitionDefault: number | string | null;
  repetitionPriority: number | string | null;
  repetitionLabel: string;
  stats: StatRow[];
  defaultParams: { slotId: string; value: string | number | boolean }[];
  /** Keyed by context *path*, not slot id -- a published value has no slot (see
   *  `Item.publishes`), which is the whole reason it can replace one. */
  publishes: { path: string; value: string }[];
}

/** Inline-repetition numeric fields count as "set" once they hold a real number, not just an
 *  empty string left behind by a cleared number input. */
function hasRepetitionField(v: number | string | null): boolean {
  return v != null && v !== "";
}

function buildDraft(item: Item | null | undefined): ItemDraft {
  const source = item ?? ({} as Partial<Item>);
  const statKeys = new Set(NW_SCHEMA.statKeys);
  const bonuses: string[] = [];
  const bonusOccurrences: Record<string, OccurrenceDraft> = {};
  for (const entry of source.bonuses ?? []) {
    if (typeof entry === "string") {
      bonuses.push(entry);
    } else {
      bonuses.push(entry.bonus);
      bonusOccurrences[entry.bonus] = {
        min: entry.min,
        max: entry.max,
        default: entry.default,
        label: entry.label ?? "",
      };
    }
  }
  return {
    name: source.name ?? "",
    filter: source.filter ?? "",
    shortDescription: source.shortDescription ?? "",
    longDescription: source.longDescription ?? "",
    maxCopies: source.maxCopies ?? null,
    allowedClass: [...(source.allowedClass ?? [])],
    tags: [...(source.tags ?? [])],
    gameIds: [...(source.gameIds ?? [])],
    bonuses,
    bonusOccurrences,
    excludes: [...(source.excludes ?? [])],
    dynamicStats: (source.dynamicStats ?? []).map((d) => ({
      stat: d.stat,
      min: d.min,
      max: d.max,
      default: d.default,
      label: d.label ?? "",
    })),
    repetitionMin: source.inlineRepetition?.min ?? null,
    repetitionMax: source.inlineRepetition?.max ?? null,
    repetitionDefault: source.inlineRepetition?.default ?? null,
    repetitionPriority: source.inlineRepetition?.priority ?? null,
    repetitionLabel: source.inlineRepetition?.label ?? "",
    stats: Object.keys(source)
      .filter((key) => statKeys.has(key))
      .map((key) => ({ key, value: source[key as keyof Item] as number })),
    publishes: Object.entries(source.publishes ?? {}).map(([path, value]) => ({
      path,
      value: String(value),
    })),
    defaultParams: Object.entries(source.defaultParams ?? {}).map(
      ([slotId, value]) => ({ slotId, value }),
    ),
  };
}

// Existing items: live edits. New items: draft until Save.
const isNew = computed(() => !props.source);

const draft = ref<ReturnType<typeof buildDraft>>(
  buildDraft(props.source ?? props.duplicateFrom),
);
const error = ref("");
// Initialize with item JSON for correct comparison on existing items.
let lastEmittedJson = JSON.stringify(toItem());

function diffLabel(oldJson: string, newJson: string): string {
  try {
    const old = JSON.parse(oldJson);
    const nw = JSON.parse(newJson);
    if (old.name !== nw.name) return `edit name → "${nw.name}"`;
    if (old.filter !== nw.filter) return `edit filter → "${nw.filter}"`;
    if (old.shortDescription !== nw.shortDescription)
      return "edit short description";
    if (old.longDescription !== nw.longDescription)
      return "edit long description";
    if (old.maxCopies !== nw.maxCopies)
      return `edit max copies → ${nw.maxCopies ?? "(none)"}`;
    if (JSON.stringify(old.allowedClass) !== JSON.stringify(nw.allowedClass))
      return "edit classes";
    if (JSON.stringify(old.tags) !== JSON.stringify(nw.tags))
      return diffArrayLabel("tag", old.tags ?? [], nw.tags ?? []);
    if (JSON.stringify(old.gameIds) !== JSON.stringify(nw.gameIds))
      return diffArrayLabel("game id", old.gameIds ?? [], nw.gameIds ?? []);
    if (
      JSON.stringify(bonusIdsOf(old.bonuses)) !==
      JSON.stringify(bonusIdsOf(nw.bonuses))
    )
      return diffArrayLabel(
        "bonus",
        bonusIdsOf(old.bonuses),
        bonusIdsOf(nw.bonuses),
      );
    if (
      JSON.stringify(occurrenceConfigsOf(old.bonuses)) !==
      JSON.stringify(occurrenceConfigsOf(nw.bonuses))
    )
      return diffOccurrenceLabel(
        occurrenceConfigsOf(old.bonuses),
        occurrenceConfigsOf(nw.bonuses),
      );
    if (JSON.stringify(old.excludes) !== JSON.stringify(nw.excludes))
      return diffArrayLabel("exclude", old.excludes ?? [], nw.excludes ?? []);
    if (JSON.stringify(old.dynamicStats) !== JSON.stringify(nw.dynamicStats))
      return diffDynamicStatsLabel(
        old.dynamicStats ?? [],
        nw.dynamicStats ?? [],
      );
    if (
      JSON.stringify(old.inlineRepetition) !==
      JSON.stringify(nw.inlineRepetition)
    )
      return "edit inline repetition";
    if (JSON.stringify(old.stats) !== JSON.stringify(nw.stats))
      return diffStatsLabel(old.stats ?? [], nw.stats ?? []);
    if (JSON.stringify(old.publishes) !== JSON.stringify(nw.publishes))
      return "edit published values";
    if (JSON.stringify(old.defaultParams) !== JSON.stringify(nw.defaultParams))
      return "edit default build parameters";
  } catch {
    // JSON parse error -- shouldn't happen but be safe.
  }
  return "edit item";
}

/** A saved item's `bonuses` entries mix plain ids and `BonusOccurrenceConfig` objects --
 *  split that into "which bonuses are attached" (id order/membership) and "which attached
 *  ones carry an occurrence config" so attach/detach and occurrence edits get distinct,
 *  readable diff labels instead of one opaque "edit bonuses". */
function bonusIdsOf(entries: unknown): string[] {
  return Array.isArray(entries)
    ? entries.map((e) =>
        typeof e === "string" ? e : (e as { bonus: string }).bonus,
      )
    : [];
}
function occurrenceConfigsOf(entries: unknown): Record<string, unknown> {
  const configs: Record<string, unknown> = {};
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (typeof e !== "string") configs[(e as { bonus: string }).bonus] = e;
    }
  }
  return configs;
}

/** Label an occurrence-config change with the specific bonus id it touched, same spirit as
 *  `diffArrayLabel` -- "edit occurrence config" alone wouldn't say which of an item's several
 *  attachments changed. */
function diffOccurrenceLabel(
  oldConfigs: Record<string, unknown>,
  nwConfigs: Record<string, unknown>,
): string {
  const oldKeys = new Set(Object.keys(oldConfigs));
  const nwKeys = new Set(Object.keys(nwConfigs));
  const added = [...nwKeys].filter((id) => !oldKeys.has(id));
  const removed = [...oldKeys].filter((id) => !nwKeys.has(id));
  if (added.length) return `add occurrence config for "${added[0]}"`;
  if (removed.length) return `remove occurrence config for "${removed[0]}"`;
  const changed = [...nwKeys].find(
    (id) => JSON.stringify(oldConfigs[id]) !== JSON.stringify(nwConfigs[id]),
  );
  return changed
    ? `edit occurrence config for "${changed}"`
    : "edit occurrence config";
}

/** Label array mutations as add/remove with the changed entry count. */
function diffArrayLabel(
  noun: string,
  oldArr: unknown[],
  newArr: unknown[],
): string {
  const oldSet = new Set(oldArr.map(String));
  const newSet = new Set(newArr.map(String));
  const added = newArr.filter((v) => !oldSet.has(String(v))).length;
  const removed = oldArr.filter((v) => !newSet.has(String(v))).length;
  if (added && removed) return `edit ${noun}s (+${added} / −${removed})`;
  if (added) return `add ${noun}${added > 1 ? "s" : ""} (${added})`;
  if (removed) return `remove ${noun}${removed > 1 ? "s" : ""} (${removed})`;
  return `edit ${noun}s`;
}

/** Label stat changes with the specific stat key(s) that changed. */
function diffStatsLabel(
  oldStats: { key: string; value: number }[],
  newStats: { key: string; value: number }[],
): string {
  const oldMap = new Map(oldStats.map((s) => [s.key, s.value]));
  const newMap = new Map(newStats.map((s) => [s.key, s.value]));
  const changed: string[] = [];
  for (const [key, val] of newMap) {
    if (!oldMap.has(key)) changed.push(`+${key}`);
    else if (oldMap.get(key) !== val) changed.push(key);
  }
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) changed.push(`−${key}`);
  }
  if (changed.length === 1) return `edit stat: ${changed[0]}`;
  if (changed.length <= 3) return `edit stats: ${changed.join(", ")}`;
  return `edit stats (${changed.length} changed)`;
}

/** Label a `dynamicStats` array change with the specific stat(s) added/removed/changed --
 *  same spirit as `diffStatsLabel`, over `Item.dynamicStats` entries instead. */
function diffDynamicStatsLabel(
  oldRows: { stat: string }[],
  newRows: { stat: string }[],
): string {
  const oldStats = oldRows.map((r) => r.stat).filter(Boolean);
  const newStats = newRows.map((r) => r.stat).filter(Boolean);
  if (JSON.stringify(oldStats) !== JSON.stringify(newStats))
    return diffArrayLabel("dynamic stat", oldStats, newStats);
  return "edit dynamic stat range";
}

// --- Live edit emit (existing items) ---------------------------------------------------

function emitChange() {
  const item = toItem();
  const currentJson = JSON.stringify(item);
  if (currentJson === lastEmittedJson) return;
  const label = diffLabel(lastEmittedJson, currentJson);
  lastEmittedJson = currentJson;
  emit("update:item", { item, label });
}

const { resetDraftHistory } = useDraftHistory({
  draft,
  isNew,
  diffLabel,
  onEmit: emitChange,
});

// --- Common ---------------------------------------------------------------------------

const displayId = computed(
  () =>
    props.source?.id ??
    (draft.value.name.trim()
      ? catalog.nextId(
          draft.value.name.trim(),
          props.allocatableIds.length
            ? props.allocatableIds
            : props.db.items.map((i) => i.id),
          "item",
        )
      : ""),
);

/** The class vocabulary these checkboxes offer: every distinct value the catalogue publishes
 * at `class`, labelled by the item that publishes it. A class param's options are still
 * honoured as a fallback, so an overlay declaring the older param-based shape keeps working.
 * Blank values are dropped either way -- "no class at all" is not a restriction. */
const classSlot = computed(() => findParamSlot(props.db.slots, "class"));
const classes = computed(() => {
  const byValue = new Map<string, string>();
  for (const option of classSlot.value?.options ?? []) {
    if (option.value) byValue.set(option.value, option.label);
  }
  for (const item of props.db.items) {
    const value = item.publishes?.class;
    if (typeof value === "string" && value) byValue.set(value, item.name);
  }
  return [...byValue].map(([value, label]) => ({ value, label }));
});

const statComboOptions = statPickerOptions;
const dynamicStatOptions = statPickerOptions;

// Off the composed catalogue, so a layer-authored param can be seeded by `defaultParams`
// exactly like a shipped one.
const buildParamSlots = computed(() =>
  props.db.slots.filter(
    (slot): slot is BuildParameterSlot => slot.type === "build_parameter",
  ),
);
const defaultParamSlotOptions = computed(() =>
  buildParamSlots.value.map((slot) => ({
    value: slot.id,
    label: slot.label,
  })),
);
function slotForDefaultParam(slotId: string): BuildParameterSlot | undefined {
  return buildParamSlots.value.find((slot) => slot.id === slotId);
}

function toItem(): Item {
  const local = draft.value;
  const id =
    props.source?.id ??
    catalog.nextId(
      local.name.trim(),
      props.allocatableIds.length
        ? props.allocatableIds
        : props.db.items.map((i) => i.id),
      "item",
    );
  const item: Item = {
    id,
    name: local.name.trim(),
    filter: local.filter.trim(),
  };

  if (local.shortDescription.trim())
    item.shortDescription = local.shortDescription.trim();
  if (local.longDescription.trim())
    item.longDescription = local.longDescription.trim();

  for (const { key, value } of local.stats) {
    if (!key) continue;
    const number = Number(value);
    if (value === "" || value == null || !Number.isFinite(number)) continue;
    item[key] = number;
  }

  if (local.tags.length) item.tags = [...local.tags];
  if (local.gameIds.length) item.gameIds = [...local.gameIds];
  if (local.bonuses.length) {
    const bonuses: (string | BonusOccurrenceConfig)[] = local.bonuses.map(
      (id) => {
        const occurrence = local.bonusOccurrences[id];
        if (!occurrence) return id;
        return {
          bonus: id,
          min: Number(occurrence.min) || 0,
          max: Number(occurrence.max) || 0,
          default: Number(occurrence.default) || 0,
          ...(occurrence.label.trim()
            ? { label: occurrence.label.trim() }
            : {}),
        };
      },
    );
    item.bonuses = bonuses;
  }
  if (local.excludes.length) item.excludes = [...local.excludes];
  if (local.maxCopies) item.maxCopies = Number(local.maxCopies);
  if (local.allowedClass.length) item.allowedClass = [...local.allowedClass];

  const dynamicStats = local.dynamicStats
    .filter((d) => d.stat)
    .map((d) => ({
      stat: d.stat,
      min: Number(d.min) || 0,
      max: Number(d.max) || 0,
      default: Number(d.default) || 0,
      ...(d.label.trim() ? { label: d.label.trim() } : {}),
    }));
  if (dynamicStats.length) item.dynamicStats = dynamicStats;

  if (
    hasRepetitionField(local.repetitionMin) ||
    hasRepetitionField(local.repetitionMax) ||
    hasRepetitionField(local.repetitionDefault)
  ) {
    item.inlineRepetition = {
      min: Number(local.repetitionMin) || 0,
      max: Number(local.repetitionMax) || 0,
      default: Number(local.repetitionDefault) || 0,
      ...(hasRepetitionField(local.repetitionPriority)
        ? { priority: Number(local.repetitionPriority) }
        : {}),
      ...(local.repetitionLabel.trim()
        ? { label: local.repetitionLabel.trim() }
        : {}),
    };
  }

  const publishes: Record<string, string | number | boolean> = {};
  for (const { path, value } of local.publishes) {
    if (path.trim()) publishes[path.trim()] = value;
  }
  if (Object.keys(publishes).length) item.publishes = publishes;

  const defaultParams: Record<string, string | number | boolean> = {};
  for (const { slotId, value } of local.defaultParams) {
    if (slotId) defaultParams[slotId] = value;
  }
  if (Object.keys(defaultParams).length) item.defaultParams = defaultParams;

  return item;
}

const dirty = computed(() => {
  const item = toItem();
  if (!props.source)
    return Boolean(item.name || item.filter || draft.value.stats.length);
  return !deepEqual(item, props.source);
});

const isPercent = (key: string) => isPercentKind(kindOf(key));

function save() {
  error.value = "";
  const item = toItem();
  if (!item.name) {
    error.value = "The item needs a name.";
    return;
  }
  if (!item.filter) {
    error.value = "The item needs a filter, or no slot can hold it.";
    return;
  }
  emit("save", { item });
}

/** Merge item-shaped values -- currently the ones read off a tooltip screenshot -- into the
 *  open draft. Imperative rather than a prop: the tooltip window is a sibling of this form, and
 *  routing its values through the layer overlay would reach a saved item but never an unsaved
 *  new draft, which is exactly the state the screenshot flow starts from. The draft watcher
 *  takes it from here, so the merge debounces out as an ordinary edit and joins undo like one.
 *
 *  The name and stats overwrite what is there -- taking the screenshot's value is the point.
 *  `gameIds` appends instead, since one item legitimately carries several. */
function applyPatch(patch: Partial<Item>) {
  const statKeys = new Set<string>(NW_SCHEMA.statKeys);
  for (const [key, value] of Object.entries(patch)) {
    if (key === "name") {
      draft.value.name = String(value);
    } else if (key === "gameIds") {
      const added = (value as string[]).filter(
        (id) => !draft.value.gameIds.includes(id),
      );
      if (added.length)
        draft.value.gameIds = [...draft.value.gameIds, ...added];
    } else if (statKeys.has(key)) {
      const row = draft.value.stats.find((stat) => stat.key === key);
      if (row) row.value = value as number;
      else draft.value.stats.push({ key, value: value as number });
    }
  }
}

defineExpose({ applyPatch });

function addStat() {
  draft.value.stats.push({ key: "", value: 0 });
}
function removeStat(index: number) {
  draft.value.stats.splice(index, 1);
}
function focusNextStat(event: KeyboardEvent) {
  focusNextCombo(event);
}

function addDynamicStat() {
  draft.value.dynamicStats.push({
    stat: "",
    min: null,
    max: null,
    default: null,
    label: "",
  });
}
function removeDynamicStat(index: number) {
  draft.value.dynamicStats.splice(index, 1);
}

function addPublishes() {
  draft.value.publishes.push({ path: "", value: "" });
}
function removePublishes(index: number) {
  draft.value.publishes.splice(index, 1);
}

function addDefaultParam() {
  draft.value.defaultParams.push({ slotId: "", value: "" });
}
function removeDefaultParam(index: number) {
  draft.value.defaultParams.splice(index, 1);
}

// Description and inline repetition are single field groups rather than arrays, so
// "added"/"removed" is tracked as its own flag instead of splicing a list. Both start active
// whenever the source item already carries values for them. Dynamic stats, like Stats below,
// are a plain repeatable list instead -- no separate group toggle.
function hasDescription(d: ItemDraft): boolean {
  return d.shortDescription !== "" || d.longDescription !== "";
}
function hasInlineRepetition(d: ItemDraft): boolean {
  return (
    hasRepetitionField(d.repetitionMin) ||
    hasRepetitionField(d.repetitionMax) ||
    hasRepetitionField(d.repetitionDefault) ||
    hasRepetitionField(d.repetitionPriority)
  );
}

const descriptionActive = ref(hasDescription(draft.value));
const repetitionActive = ref(hasInlineRepetition(draft.value));

// Draft undo/redo (new-item history) replaces `draft.value` wholesale, bypassing the
// add/remove handlers below -- resurface the group automatically whenever its fields come
// back populated so a redo of "add" doesn't leave the fields hidden behind a stale flag.
// Never flips a flag to false itself; only the explicit remove handlers do that.
watch(
  () => [draft.value.shortDescription, draft.value.longDescription],
  () => {
    if (hasDescription(draft.value)) descriptionActive.value = true;
  },
);
watch(
  () => [
    draft.value.repetitionMin,
    draft.value.repetitionMax,
    draft.value.repetitionDefault,
    draft.value.repetitionPriority,
  ],
  () => {
    if (hasInlineRepetition(draft.value)) repetitionActive.value = true;
  },
);

function addDescription() {
  descriptionActive.value = true;
}
function removeDescription() {
  draft.value.shortDescription = "";
  draft.value.longDescription = "";
  descriptionActive.value = false;
}

function addInlineRepetition() {
  repetitionActive.value = true;
}
function removeInlineRepetition() {
  draft.value.repetitionMin = null;
  draft.value.repetitionMax = null;
  draft.value.repetitionDefault = null;
  draft.value.repetitionPriority = null;
  draft.value.repetitionLabel = "";
  repetitionActive.value = false;
}

function attachBonus(id: string) {
  if (draft.value.bonuses.includes(id)) return;
  draft.value.bonuses = [...draft.value.bonuses, id];
}

function detachBonus(id: string) {
  draft.value.bonuses = draft.value.bonuses.filter(
    (bonusId: string) => bonusId !== id,
  );
  if (id in draft.value.bonusOccurrences) {
    const { [id]: _removed, ...rest } = draft.value.bonusOccurrences;
    draft.value.bonusOccurrences = rest;
  }
}

/** Toggle or edit one attached bonus's occurrence config -- `occurrence: null` drops it back
 *  to a plain-id attachment (always 1 occurrence), mirroring `removeInlineRepetition`'s
 *  clear-back-to-unset behavior. */
function updateBonusOccurrence(id: string, occurrence: OccurrenceDraft | null) {
  if (occurrence) {
    draft.value.bonusOccurrences = {
      ...draft.value.bonusOccurrences,
      [id]: occurrence,
    };
  } else if (id in draft.value.bonusOccurrences) {
    const { [id]: _removed, ...rest } = draft.value.bonusOccurrences;
    draft.value.bonusOccurrences = rest;
  }
}

// Rebuild draft when source changes (e.g. after undo/redo reverts the overlay).
watch(
  () => props.source,
  (value) => {
    // Same round-trip-echo guard BonusForm.vue uses: a live edit's own update:item goes
    // out through the layer overlay and comes straight back as this prop. Rebuilding from
    // that echo would wipe half-drawn rows - `toItem` drops stat, dynamic-stat and
    // default-param rows with nothing picked yet, so an "add the rows first, fill them one
    // by one" session would lose every row still empty when the first one is filled.
    if (value && lastEmittedJson && JSON.stringify(value) === lastEmittedJson)
      return;
    draft.value = buildDraft(value);
    descriptionActive.value = hasDescription(draft.value);
    repetitionActive.value = hasInlineRepetition(draft.value);
    error.value = "";
    lastEmittedJson = JSON.stringify(toItem());
    resetDraftHistory();
  },
);
</script>

<template>
  <div>
    <FormBar class="-mx-3 mb-3">
      <strong>{{ draft.name || "New item" }}</strong>
      <BaseBadge v-if="status !== 'base'" :variant="status as any">{{
        status
      }}</BaseBadge>
      <BaseBadge v-if="dirty && isNew">unsaved</BaseBadge>
      <span class="flex-1"></span>
      <!-- Save button only for new items -->
      <BaseButton
        v-if="isNew"
        variant="primary"
        :disabled="!dirty"
        @click="save"
        ><Save />Save item</BaseButton
      >
      <BaseButton v-if="status === 'edited'" @click="$emit('revert')"
        ><Undo2 />Revert to shipped</BaseButton
      >
      <BaseButton
        v-if="source"
        data-testid="duplicate-item"
        @click="$emit('duplicate')"
        ><Copy />Duplicate</BaseButton
      >
      <BaseButton v-if="source" @click="$emit('delete')"
        ><Trash />Delete</BaseButton
      >
    </FormBar>

    <p v-if="error" class="mt-1 text-danger">{{ error }}</p>

    <FormGrid class="mb-2">
      <FormField label="Name">
        <input
          v-model="draft.name"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
          data-testid="item-name-input"
        />
      </FormField>
      <IdField :id="displayId" label="Id" :existing="Boolean(source)" />
      <FormField label="Filter (slot category)">
        <CreatableComboBox
          v-model="draft.filter"
          :options="filters"
          testid="item-filter-input"
        />
      </FormField>
      <FormField label="Max copies (0 = unlimited)">
        <input
          v-model.number="draft.maxCopies"
          class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="number"
          min="0"
        />
      </FormField>
    </FormGrid>

    <datalist id="nw-tags">
      <option v-for="t in tags" :key="t" :value="t"></option>
    </datalist>

    <FormGrid class="mb-2">
      <FormField label="Tags" class="min-w-80 flex-1">
        <TokenInput
          v-model="draft.tags"
          :options="tags"
          placeholder="Add a tag…"
          data-testid="item-tags-input"
        />
      </FormField>
    </FormGrid>

    <FormGrid class="mb-2">
      <FormField
        label="Game IDs (the Hitem values from a demo record)"
        class="min-w-80 flex-1"
      >
        <TokenInput
          v-model="draft.gameIds"
          placeholder="Add a game id…"
          data-testid="item-gameids-input"
        />
      </FormField>
    </FormGrid>

    <FormSection>Restricted to classes</FormSection>
    <div class="mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
      <BaseCheckbox
        v-for="cls in classes"
        :key="cls.value"
        v-model="draft.allowedClass"
        :value="cls.value"
      >
        {{ cls.label }}
      </BaseCheckbox>
    </div>

    <FormSection>Stats</FormSection>
    <div
      v-for="(stat, index) in draft.stats"
      :key="index"
      class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add stat" @click="addStat"><Plus /></IconButton>
      <IconButton title="Remove stat" @click="removeStat(index)"
        ><Trash
      /></IconButton>
      <ComboBox
        class="combo--stat w-52"
        :model-value="stat.key"
        :options="statComboOptions"
        placeholder="- pick a stat -"
        @update:model-value="(v) => (stat.key = v)"
      />
      <PercentInput
        v-if="isPercent(stat.key)"
        v-model="stat.value"
        class="w-28"
        @keydown="focusNextStat"
      />
      <input
        v-else
        v-model.number="stat.value"
        class="w-28 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="number"
        step="any"
        @keydown="focusNextStat"
      />
    </div>
    <div
      v-if="!draft.stats.length"
      class="stat-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add stat" @click="addStat"><Plus /></IconButton>
    </div>

    <FormSection
      >Dynamic stats (player types the value; default applies until they
      do)</FormSection
    >
    <div
      v-for="(row, index) in draft.dynamicStats"
      :key="index"
      class="dynamic-stat-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add dynamic stat" @click="addDynamicStat"
        ><Plus
      /></IconButton>
      <IconButton title="Remove dynamic stat" @click="removeDynamicStat(index)"
        ><Trash
      /></IconButton>
      <FormField label="Stat">
        <ComboBox
          class="combo--stat w-52"
          :model-value="row.stat"
          :options="dynamicStatOptions"
          placeholder="- pick a stat -"
          @update:model-value="(v) => (row.stat = v)"
        />
      </FormField>
      <FormField label="Min">
        <PercentInput
          v-if="isPercent(row.stat)"
          :model-value="row.min ?? ''"
          class="w-24"
          @update:model-value="(v) => (row.min = v)"
        />
        <input
          v-else
          v-model.number="row.min"
          class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="number"
        />
      </FormField>
      <FormField label="Max">
        <PercentInput
          v-if="isPercent(row.stat)"
          :model-value="row.max ?? ''"
          class="w-24"
          @update:model-value="(v) => (row.max = v)"
        />
        <input
          v-else
          v-model.number="row.max"
          class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="number"
        />
      </FormField>
      <FormField label="Default">
        <PercentInput
          v-if="isPercent(row.stat)"
          :model-value="row.default ?? ''"
          class="w-24"
          @update:model-value="(v) => (row.default = v)"
        />
        <input
          v-else
          v-model.number="row.default"
          class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="number"
        />
      </FormField>
      <FormField label="Label (optional)">
        <input
          v-model="row.label"
          class="w-40 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          type="text"
        />
      </FormField>
    </div>
    <div
      v-if="!draft.dynamicStats.length"
      class="dynamic-stat-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add dynamic stat" @click="addDynamicStat"
        ><Plus
      /></IconButton>
    </div>

    <FormSection
      >Inline repetition (boons, attributes, other point_assignment slots
      filter)</FormSection
    >
    <div class="flex flex-wrap items-center gap-1.5 mb-2">
      <IconButton
        v-if="!repetitionActive"
        title="Add inline repetition"
        data-testid="add-inline-repetition"
        @click="addInlineRepetition"
        ><Plus
      /></IconButton>
      <IconButton
        v-else
        title="Remove inline repetition"
        data-testid="remove-inline-repetition"
        @click="removeInlineRepetition"
        ><Trash
      /></IconButton>
      <FormGrid v-if="repetitionActive" data-testid="inline-repetition-fields">
        <FormField label="Min">
          <input
            v-model.number="draft.repetitionMin"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
        <FormField label="Max">
          <input
            v-model.number="draft.repetitionMax"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
        <FormField label="Default">
          <input
            v-model.number="draft.repetitionDefault"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
        <FormField label="Priority">
          <input
            v-model.number="draft.repetitionPriority"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="number"
          />
        </FormField>
        <FormField label="Label (optional, overrides the item name on its row)">
          <input
            v-model="draft.repetitionLabel"
            class="w-40 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="text"
            data-testid="inline-repetition-label-input"
          />
        </FormField>
      </FormGrid>
    </div>

    <FormSection>Equipping this item suppresses</FormSection>
    <TokenInput
      v-model="draft.excludes"
      :options="bonusIds"
      placeholder="bonus id this item overrides…"
    />
    <p class="text-muted">
      Item-level override: those bonuses go inactive whenever this item is
      equipped, whatever grants them.
    </p>

    <FormSection>Description (optional)</FormSection>
    <div class="flex flex-wrap items-center gap-1.5 mb-2">
      <IconButton
        v-if="!descriptionActive"
        title="Add description"
        data-testid="add-item-description"
        @click="addDescription"
        ><Plus
      /></IconButton>
      <IconButton
        v-else
        title="Remove description"
        data-testid="remove-item-description"
        @click="removeDescription"
        ><Trash
      /></IconButton>
      <FormGrid v-if="descriptionActive" data-testid="item-description-fields">
        <FormField
          label="Short (shown next to the stat summary)"
          class="min-w-80 flex-1"
        >
          <input
            v-model="draft.shortDescription"
            class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            type="text"
            data-testid="item-short-description-input"
            placeholder="e.g. AP when killing mobs"
          />
        </FormField>
        <FormField
          label="Long (shown on the hover card)"
          class="min-w-80 flex-1"
        >
          <textarea
            v-model="draft.longDescription"
            class="w-full resize-y rounded-md border border-line bg-surface p-2"
            rows="2"
            data-testid="item-long-description-input"
            placeholder="e.g. When you kill an enemy, gain 3% Action Points."
          ></textarea>
        </FormField>
      </FormGrid>
    </div>

    <FormSection
      >Default build parameters (applied when this item is picked)</FormSection
    >
    <div
      v-for="(row, index) in draft.defaultParams"
      :key="index"
      class="default-param-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add default build parameter" @click="addDefaultParam"
        ><Plus
      /></IconButton>
      <IconButton
        title="Remove default build parameter"
        @click="removeDefaultParam(index)"
        ><Trash
      /></IconButton>
      <ComboBox
        class="w-52"
        :model-value="row.slotId"
        :options="defaultParamSlotOptions"
        placeholder="- pick a build parameter -"
        @update:model-value="(v) => (row.slotId = v)"
      />
      <BuildParamInput
        v-if="slotForDefaultParam(row.slotId)"
        v-model="row.value"
        :slot-def="slotForDefaultParam(row.slotId)!"
        >{{ slotForDefaultParam(row.slotId)?.label }}</BuildParamInput
      >
    </div>
    <div
      v-if="!draft.defaultParams.length"
      class="default-param-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add default build parameter" @click="addDefaultParam"
        ><Plus
      /></IconButton>
    </div>

    <FormSection
      >Published build parameters (applied while this item is
      equipped)</FormSection
    >
    <div
      v-for="(row, index) in draft.publishes"
      :key="index"
      class="publishes-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add published value" @click="addPublishes"
        ><Plus
      /></IconButton>
      <IconButton title="Remove published value" @click="removePublishes(index)"
        ><Trash
      /></IconButton>
      <input
        v-model="row.path"
        class="w-52 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="text"
        placeholder="Context path, e.g. class"
        :data-testid="`publishes-path-${index}`"
      />
      <input
        v-model="row.value"
        class="w-52 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        type="text"
        placeholder="Value"
        :data-testid="`publishes-value-${index}`"
      />
    </div>
    <div
      v-if="!draft.publishes.length"
      class="publishes-row flex flex-wrap items-center gap-1.5 mb-1"
    >
      <IconButton title="Add published value" @click="addPublishes"
        ><Plus
      /></IconButton>
    </div>

    <ItemBonuses
      :attached-bonus-ids="draft.bonuses"
      :occurrence-configs="draft.bonusOccurrences"
      :item-name="draft.name"
      :db="db"
      :all-bonus-ids="allBonusIds"
      :tags="tags"
      :bonus-ids="bonusIds"
      :allocatable-ids="props.allocatableIds"
      @save-bonus="$emit('save-bonus', $event)"
      @delete-bonus="$emit('delete-bonus', $event)"
      @update-bonus="$emit('update-bonus', $event)"
      @detach-bonus="detachBonus"
      @attach-bonus="attachBonus"
      @update-occurrence="(e) => updateBonusOccurrence(e.id, e.occurrence)"
    />
  </div>
</template>
