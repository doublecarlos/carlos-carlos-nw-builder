<script setup lang="ts">
// The layer editor: browse/add/edit/remove items and shared bonus sets in a single layer,
// lint the composed catalogue, and export the results.
//
// Takes the selected Layer as a prop and writes through `layers.updateOverlay`. When the
// layer is disabled, the editor shows a muted banner saying its changes are not applied.
//
// The editor never writes to disk -- it cannot, this is a static client app. It edits the
// layer's overlay (see catalog.ts) and hands you the file contents to paste back.
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useEventListener } from "@vueuse/core";
import { useConfirm } from "../composables/useConfirm";
import ItemForm from "./game/ItemForm.vue";
import BonusForm from "./game/BonusForm.vue";
import PresetForm from "./game/PresetForm.vue";
import LayerExportDrawer from "./game/LayerExportDrawer.vue";
import LayerValidationDrawer from "./game/LayerValidationDrawer.vue";
import LayerEntryList from "./game/LayerEntryList.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import BaseNotice from "./ui/BaseNotice.vue";
import TabStrip from "./ui/TabStrip.vue";
import TabButton from "./ui/TabButton.vue";
import { Download, RotateCcw, Upload } from "@lucide/vue";
import * as catalog from "../data/catalog";
import * as router from "../lib/router";
import * as engine from "../stores/resolved";
import * as history from "../stores/history";
import * as layers from "../stores/layers";
import * as layerEditorUi from "../stores/layerEditorUi";
import { matchesQuery } from "../lib/text-filter";
import type {
  CatalogGroup,
  CatalogOverlay,
  Item,
  Bonus,
  SectionPreset,
  LintFinding,
  Layer,
} from "../types";
import type {
  EditorRow,
  ItemRow,
  BonusRow,
  PresetRow,
} from "./game/LayerEntryList.vue";

const db = engine.db;

const props = defineProps<{ layer: Layer }>();

const overlay = computed(() => props.layer.overlay);
function setOverlay(newValue: CatalogOverlay) {
  layers.updateOverlay(props.layer.id, newValue);
}

/** This layer's own remembered section/filter/selection -- see the store's own doc comment.
 *  A computed, not a plain const: the nav can switch `props.layer` directly from one layer
 *  to another without this component unmounting, and a stale binding would leak writes into
 *  the previous layer's stored state. */
const ui = computed(() => layerEditorUi.getState(props.layer.id));

const query = ref("");
const statusFilter = ref("all"); // all | changed | added | edited | removed
const section = ref("items"); // items | bonuses | sectionPresets
const selectedId = ref<string | null>(null);
const selectedBonusId = ref<string | null>(null);
const selectedPresetId = ref<string | null>(null);
const showExport = ref(false);
const exportTab = ref("items"); // items | bonuses | overlay | slots
const newItemCounter = ref(0);
/** Seed values for the next brand-new item/bonus draft, set by "Duplicate" and consumed
 *  once at that form's mount -- cleared whenever a plain "New" is requested instead so a
 *  stale duplicate doesn't leak into an unrelated blank draft. */
const duplicateItemSeed = ref<Item | null>(null);
const duplicateBonusSeed = ref<Bonus | null>(null);
const notice = ref("");
const confirmReset_ = useConfirm(4000);

const form = ref<InstanceType<typeof ItemForm> | null>(null);
const bonusForm = ref<InstanceType<typeof BonusForm> | null>(null);
const presetForm = ref<InstanceType<typeof PresetForm> | null>(null);

// Removed entries are gone from `db`, so the list is built from the composed catalogue
// plus the overlay's tombstones -- otherwise a deletion would vanish with no way back.
const itemRows = computed<ItemRow[]>(() => {
  const rows: ItemRow[] = db.value.items.map((item) => ({
    key: item.id,
    name: item.name,
    filter: item.filter ?? "",
    item,
    status: catalog.statusOf(overlay.value, "items", item.id),
    kind: "item",
  }));
  for (const [id, value] of Object.entries(overlay.value.items ?? {})) {
    if (value === null) {
      // A tombstone only ever hides a shipped item, so its display name is still in `base()`.
      const name =
        catalog.base().items.find((item) => item.id === id)?.name ?? id;
      rows.push({
        key: id,
        name,
        filter: "—",
        item: null,
        status: "removed",
        kind: "item",
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

/** Same shape as `itemRows`, one row per bonus set rather than per item -- so the same
 * list/search/keyboard-nav code serves both without knowing which it's showing. */
const bonusRows = computed<BonusRow[]>(() => {
  const rows: BonusRow[] = db.value.bonuses.map((set) => ({
    key: set.id,
    name: set.name || set.id,
    filter: `${(set.grants ?? []).length} grant(s)`,
    set,
    status: catalog.statusOf(overlay.value, "bonuses", set.id),
    kind: "bonus",
  }));
  for (const [id, value] of Object.entries(overlay.value.bonuses ?? {})) {
    if (value === null) {
      rows.push({
        key: id,
        name: id,
        filter: "—",
        set: null,
        status: "removed",
        kind: "bonus",
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

/** Same shape as `itemRows`/`bonusRows`, one row per section preset. */
const presetRows = computed<PresetRow[]>(() => {
  const rows: PresetRow[] = db.value.presets.map((preset) => ({
    key: preset.id,
    name: preset.label || preset.id,
    filter: preset.section,
    preset,
    status: catalog.statusOf(overlay.value, "sectionPresets", preset.id),
    kind: "sectionPreset",
  }));
  for (const [id, value] of Object.entries(
    overlay.value.sectionPresets ?? {},
  )) {
    if (value === null) {
      const shipped = catalog
        .base()
        .sectionPresets.find((preset) => preset.id === id);
      rows.push({
        key: id,
        name: shipped?.label ?? id,
        filter: shipped?.section ?? "—",
        preset: null,
        status: "removed",
        kind: "sectionPreset",
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

const rows = computed(() => {
  if (section.value === "bonuses") return bonusRows.value;
  if (section.value === "sectionPresets") return presetRows.value;
  return itemRows.value;
});

const filtered = computed(() => {
  return rows.value.filter((row) => {
    if (statusFilter.value === "changed" && row.status === "base") return false;
    if (
      ["added", "edited", "removed"].includes(statusFilter.value) &&
      row.status !== statusFilter.value
    )
      return false;
    return matchesQuery([row.name, row.filter ?? ""], query.value);
  });
});

const statusFilterOptions = [
  { value: "all", label: "all" },
  { value: "changed", label: "changed only" },
  { value: "added", label: "added" },
  { value: "edited", label: "edited" },
  { value: "removed", label: "removed" },
];

const selected = computed(() => {
  if (selectedId.value == null) return null;
  return db.value.get(selectedId.value);
});

const selectedStatus = computed(() =>
  selectedId.value == null
    ? "base"
    : catalog.statusOf(overlay.value, "items", selectedId.value),
);

const selectedBonus = computed(() => {
  if (selectedBonusId.value == null) return null;
  return db.value.bonusById.get(selectedBonusId.value) ?? null;
});

const selectedBonusStatus = computed(() =>
  selectedBonusId.value == null
    ? "base"
    : catalog.statusOf(overlay.value, "bonuses", selectedBonusId.value),
);

const selectedPreset = computed(() => {
  if (selectedPresetId.value == null) return null;
  return db.value.presets.find((p) => p.id === selectedPresetId.value) ?? null;
});

const selectedPresetStatus = computed(() =>
  selectedPresetId.value == null
    ? "base"
    : catalog.statusOf(overlay.value, "sectionPresets", selectedPresetId.value),
);

const filters = computed<string[]>(() =>
  [
    ...new Set<string>(
      db.value.items
        .map((item) => item.filter)
        .filter((f): f is string => Boolean(f)),
    ),
  ].sort(),
);

const setIds = computed<string[]>(() =>
  [...new Set<string>(db.value.bonuses.map((set) => set.id))].sort(),
);

const tagList = computed<string[]>(() =>
  [...db.value.itemsByTag.keys()].sort(),
);

/** The vocabulary for `excludes`. A set now resolves as one unit, so only sets (not
 * individual grants) are addressable -- same list as `setIds`, kept as its own computed
 * since the two are used for unrelated purposes at the call sites. */
const bonusIds = computed(() => setIds.value);

const changedCount = computed(
  () =>
    Object.keys(overlay.value.items ?? {}).length +
    Object.keys(overlay.value.bonuses ?? {}).length +
    Object.keys(overlay.value.sectionPresets ?? {}).length,
);

/** Entry count badge: non-tombstone entries in the overlay. */
const entryCount = computed(() => {
  let count = 0;
  for (const value of Object.values(overlay.value.items ?? {})) {
    if (value !== null) count += 1;
  }
  for (const value of Object.values(overlay.value.bonuses ?? {})) {
    if (value !== null) count += 1;
  }
  for (const value of Object.values(overlay.value.sectionPresets ?? {})) {
    if (value !== null) count += 1;
  }
  return count;
});

const hasUnsavedDraft = (row: EditorRow) => {
  if (row.kind === "bonus") {
    if (row.key === selectedBonusId.value)
      return bonusForm.value?.dirty ?? false;
  }
  if (row.kind === "sectionPreset") {
    if (row.key === selectedPresetId.value)
      return presetForm.value?.dirty ?? false;
  }
  return false;
};

/** All existing ids across base + every layer + the selected build's catalog, for id
 * allocation. See decision 12 and phase 2b §2.5. */
const allocatableIds = computed(() => {
  const ids = new Set<string>(layers.allocatableIds());
  const build = engine.db.value.items.map((item) => item.id);
  for (const id of build) ids.add(id);
  for (const preset of engine.db.value.presets) ids.add(preset.id);
  return [...ids];
});

const findings = computed(() =>
  catalog.validate(
    db.value.items,
    db.value.bonuses,
    undefined,
    db.value.presets,
  ),
);

const errorCount = computed(
  () => findings.value.filter((f) => f.level === "error").length,
);
const warnCount = computed(
  () => findings.value.filter((f) => f.level === "warn").length,
);

// --- routing --------------------------------------------------------------------------
// `item`/`bonus`/`section`/`status`/`q` are this component's own corner of the URL --
// App.vue owns view/build/tab and knows nothing about what's selected in here. `select`'s
// `push` flag is what keeps arrow-key browsing from filling the back/forward stack with
// one stop per keystroke: a click is a real "go to this row" navigation, an arrow key is
// just skimming.

function isValidStatusFilter(value: unknown) {
  return statusFilterOptions.some((option) => option.value === value);
}

/** Back/forward landed on this component while it was already mounted (still in the
 * editor, just a different item/bonus/section/status filter/query). A fresh mount reads the
 * same params in `onMounted`. */
function onPopState() {
  // A duplicate draft's seed is only ever meant for the mount it was set up for -- back/
  // forward must never resurrect it onto an unrelated blank draft.
  duplicateItemSeed.value = null;
  duplicateBonusSeed.value = null;
  const route = router.parse();
  if (route.section === "bonuses") {
    section.value = "bonuses";
    selectedBonusId.value =
      route.bonus && db.value.bonusById.get(route.bonus) ? route.bonus : null;
  } else if (route.section === "sectionPresets") {
    section.value = "sectionPresets";
    selectedPresetId.value =
      route.preset && db.value.presets.some((p) => p.id === route.preset)
        ? route.preset
        : null;
  } else {
    section.value = "items";
    selectedId.value =
      route.item && db.value.get(route.item) ? route.item : null;
  }
  statusFilter.value = isValidStatusFilter(route.status) ? route.status : "all";
  query.value = route.q ?? "";
}

function switchSection(target: string) {
  if (section.value === target) return;
  section.value = target;
  if (target === "bonuses") {
    router.apply({
      section: "bonuses",
      item: null,
      preset: null,
      bonus: selectedBonusId.value,
    });
  } else if (target === "sectionPresets") {
    router.apply({
      section: "sectionPresets",
      item: null,
      bonus: null,
      preset: selectedPresetId.value,
    });
  } else {
    router.apply({
      section: null,
      bonus: null,
      preset: null,
      item: selectedId.value,
    });
  }
}

function select(row: EditorRow, { push = true }: { push?: boolean } = {}) {
  if (row.status === "removed") return;
  if (row.kind === "bonus") {
    selectedBonusId.value = row.key;
    router.apply({ bonus: row.key, item: null, preset: null }, { push });
  } else if (row.kind === "sectionPreset") {
    selectedPresetId.value = row.key;
    router.apply({ preset: row.key, item: null, bonus: null }, { push });
  } else {
    selectedId.value = row.key;
    router.apply({ item: row.key, bonus: null, preset: null }, { push });
  }
}

const selectedKey = computed(() => {
  if (section.value === "bonuses") return selectedBonusId.value;
  if (section.value === "sectionPresets") return selectedPresetId.value;
  return selectedId.value;
});

function newItem() {
  selectedId.value = null;
  duplicateItemSeed.value = null;
  newItemCounter.value++;
  router.apply({ item: null });
}

function newBonus() {
  selectedBonusId.value = null;
  duplicateBonusSeed.value = null;
  newItemCounter.value++;
  router.apply({ bonus: null });
}

/** Opens a new item draft pre-filled from the currently selected item -- an explicit Save
 *  is still required, and that Save is what mints the copy's id (from whatever name ends
 *  up in the draft, so retyping the name before saving is what changes it). */
function duplicateItem() {
  const item = selected.value;
  if (!item) return;
  duplicateItemSeed.value = item;
  selectedId.value = null;
  newItemCounter.value++;
  router.apply({ item: null });
  notice.value = `Duplicating "${item.name}" — edit and save to create a copy`;
}

function duplicateBonus() {
  const bonus = selectedBonus.value;
  if (!bonus) return;
  duplicateBonusSeed.value = bonus;
  selectedBonusId.value = null;
  newItemCounter.value++;
  router.apply({ bonus: null });
  notice.value = `Duplicating "${bonus.name || bonus.id}" — edit and save to create a copy`;
}

function newPreset() {
  selectedPresetId.value = null;
  newItemCounter.value++;
  router.apply({ preset: null });
}

function onSave({ item }: { item: Item }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `save:${item.id}`,
    `Save item "${item.name}"`,
    overlay.value,
  );
  const next = catalog.upsert(overlay.value, "items", item.id, item);
  setOverlay(next);
  selectedId.value = item.id;
  router.apply({ item: item.id });
  notice.value = `Saved "${item.name}"`;
}

/** Live-edit handler: debounced changes from existing items go here. */
function onUpdateItem({ item, label }: { item: Item; label: string }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `edit:${item.id}`,
    label,
    overlay.value,
  );
  const next = catalog.upsert(overlay.value, "items", item.id, item);
  setOverlay(next);
}

function onDelete() {
  const id = selectedId.value!;
  const name = selected.value?.name ?? id;
  history.snapshot(
    "layer",
    props.layer.id,
    `delete:${id}`,
    `Delete item "${name}"`,
    overlay.value,
  );
  setOverlay(catalog.remove(overlay.value, "items", id));
  selectedId.value = null;
  router.apply({ item: null });
  notice.value = `Removed "${name}"`;
}

function onRevert() {
  const id = selectedId.value!;
  const name = selected.value?.name ?? id;
  history.snapshot(
    "layer",
    props.layer.id,
    `revert:${id}`,
    `Revert item "${name}"`,
    overlay.value,
  );
  setOverlay(catalog.revert(overlay.value, "items", id));
  notice.value = `Reverted "${name}" to the shipped version`;
}

function restore(row: EditorRow) {
  const group: CatalogGroup =
    row.kind === "bonus"
      ? "bonuses"
      : row.kind === "sectionPreset"
        ? "sectionPresets"
        : "items";
  history.snapshot(
    "layer",
    props.layer.id,
    `restore:${row.key}`,
    `Restore "${row.name}"`,
    overlay.value,
  );
  setOverlay(catalog.revert(overlay.value, group, row.key));
  notice.value = `Restored "${row.name}"`;
}

/** Two-step, not a `confirm()` dialog -- same pattern as BuildBar.vue's delete: this
 *  wipes every change in the overlay, and a blocking modal would stall anything driving
 *  the editor programmatically. */
function resetAll() {
  if (!confirmReset_.run("reset")) return;
  history.snapshot(
    "layer",
    props.layer.id,
    null,
    "Discard all changes",
    overlay.value,
  );
  setOverlay(catalog.emptyOverlay());
  selectedId.value = null;
  selectedBonusId.value = null;
  selectedPresetId.value = null;
  router.apply({ item: null, bonus: null, preset: null });
  notice.value = "Discarded every change — back to the shipped data";
}

/** Jump to whatever a validation finding points at, switching section if needed --
 * findings carry `kind` precisely so this doesn't have to guess from the id/name shape. */
function selectFinding(finding: LintFinding) {
  if (!finding.name) return;
  if (finding.kind === "bonus") {
    section.value = "bonuses";
    selectedBonusId.value = finding.name;
    router.apply({
      section: "bonuses",
      bonus: finding.name,
      item: null,
      preset: null,
    });
  } else if (finding.kind === "sectionPreset") {
    section.value = "sectionPresets";
    selectedPresetId.value = finding.name;
    router.apply({
      section: "sectionPresets",
      preset: finding.name,
      item: null,
      bonus: null,
    });
  } else {
    section.value = "items";
    selectedId.value = finding.name;
    router.apply({
      section: null,
      item: finding.name,
      bonus: null,
      preset: null,
    });
  }
}

// --- bonuses ----------------------------------------------------------------------------
// `onSaveBonus`/`onDeleteBonus` are the sub-editor inside the item form (a bonus this item
// attaches or detaches); `onSaveBonusTop`/`onDeleteBonusTop`/`onRevertBonusTop` are this
// component's own "Bonuses" section, browsing and editing a bonus on its own.

function onSaveBonus({ id, set }: { id: string; set: Bonus }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `save-set:${id}`,
    `Save bonus "${set.name || id}"`,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonuses", id, set));
  notice.value = `Saved bonus "${set.name || id}"`;
}

/** Live-edit handler: debounced changes from existing bonuses in item editor go here. */
function onUpdateBonus({ id, set }: { id: string; set: Bonus }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `edit-set:${id}`,
    `Edit bonus "${set.name || id}"`,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonuses", id, set));
}

function onDeleteBonus(id: string) {
  history.snapshot(
    "layer",
    props.layer.id,
    `delete-set:${id}`,
    `Delete bonus "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.remove(overlay.value, "bonuses", id));
  notice.value = `Removed bonus "${id}"`;
}

function onSaveBonusTop({ id, set }: { id: string; set: Bonus }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `save-set:${id}`,
    `Save bonus "${set.name || id}"`,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonuses", id, set));
  selectedBonusId.value = id;
  router.apply({ bonus: id });
  notice.value = `Saved bonus "${set.name || id}"`;
}

/** Live-edit handler: debounced changes from existing bonuses go here. */
function onUpdateBonusTop({
  id,
  set,
  label,
}: {
  id: string;
  set: Bonus;
  label: string;
}) {
  history.snapshot(
    "layer",
    props.layer.id,
    `edit-set:${id}`,
    label,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonuses", id, set));
}

function onDeleteBonusTop() {
  const id = selectedBonusId.value!;
  history.snapshot(
    "layer",
    props.layer.id,
    `delete-set:${id}`,
    `Delete bonus "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.remove(overlay.value, "bonuses", id));
  selectedBonusId.value = null;
  router.apply({ bonus: null });
  notice.value = `Removed bonus "${id}"`;
}

function onRevertBonusTop() {
  const id = selectedBonusId.value!;
  history.snapshot(
    "layer",
    props.layer.id,
    `revert-set:${id}`,
    `Revert bonus "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.revert(overlay.value, "bonuses", id));
  notice.value = `Reverted bonus "${id}" to the shipped version`;
}

// --- section presets ------------------------------------------------------------------

function onSavePreset({ preset }: { preset: SectionPreset }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `save-preset:${preset.id}`,
    `Save preset "${preset.label || preset.id}"`,
    overlay.value,
  );
  setOverlay(
    catalog.upsert(overlay.value, "sectionPresets", preset.id, preset),
  );
  selectedPresetId.value = preset.id;
  router.apply({ preset: preset.id });
  notice.value = `Saved preset "${preset.label || preset.id}"`;
}

/** Live-edit handler: debounced changes from an existing preset go here. */
function onUpdatePreset({
  preset,
  label,
}: {
  preset: SectionPreset;
  label: string;
}) {
  history.snapshot(
    "layer",
    props.layer.id,
    `edit-preset:${preset.id}`,
    label,
    overlay.value,
  );
  setOverlay(
    catalog.upsert(overlay.value, "sectionPresets", preset.id, preset),
  );
}

function onDeletePreset() {
  const id = selectedPresetId.value!;
  history.snapshot(
    "layer",
    props.layer.id,
    `delete-preset:${id}`,
    `Delete preset "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.remove(overlay.value, "sectionPresets", id));
  selectedPresetId.value = null;
  router.apply({ preset: null });
  notice.value = `Removed preset "${id}"`;
}

function onRevertPreset() {
  const id = selectedPresetId.value!;
  history.snapshot(
    "layer",
    props.layer.id,
    `revert-preset:${id}`,
    `Revert preset "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.revert(overlay.value, "sectionPresets", id));
  notice.value = `Reverted preset "${id}" to the shipped version`;
}

async function importOverlay(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    history.snapshot(
      "layer",
      props.layer.id,
      null,
      "Import overlay",
      overlay.value,
    );
    setOverlay(catalog.normaliseOverlay(parsed));
    notice.value = "Overlay imported";
  } catch (error: unknown) {
    notice.value = `Could not read that overlay: ${error instanceof Error ? error.message : String(error)}`;
  }
  input.value = "";
}

watch(statusFilter, (value) => {
  router.apply({ status: value === "all" ? null : value }, { push: false });
});
watch(query, (value) => {
  router.apply({ q: value || null }, { push: false });
});

// Mirror every field this component owns into the per-layer store, so a later remount (a
// round trip through the build editor) has something to restore from once the URL itself
// has been cleared by `onUnmounted` below.
watch(
  [section, selectedId, selectedBonusId, selectedPresetId, statusFilter, query],
  ([sec, item, bonus, preset, status, q]) => {
    ui.value.section = sec;
    ui.value.item = item ?? "";
    ui.value.bonus = bonus ?? "";
    ui.value.preset = preset ?? "";
    ui.value.status = status === "all" ? "" : status;
    ui.value.q = q;
  },
);

/** Whether the URL itself carries any of this component's own params -- true for a deep
 *  link or a back/forward navigation, false for a plain remount after switching editors
 *  (those params were wiped on the way out). Only in the true case should the URL outrank
 *  the per-layer store below. */
function hasRoutedLayerState(routed: Record<string, string>) {
  return Boolean(
    routed.item ||
    routed.bonus ||
    routed.preset ||
    routed.section ||
    routed.status ||
    routed.q ||
    routed.newItemFilter,
  );
}

onMounted(() => {
  const routed = router.parse();
  const routedActive = hasRoutedLayerState(routed);
  const source = routedActive ? routed : ui.value;
  // When the layer changes, keep the `item` param if the new layer's composed catalogue
  // still has that id, otherwise drop it (phase 6 §2.3).
  if (source.section === "bonuses") {
    section.value = "bonuses";
    if (source.bonus && db.value.bonusById.get(source.bonus))
      selectedBonusId.value = source.bonus;
  } else if (source.section === "sectionPresets") {
    section.value = "sectionPresets";
    if (source.preset && db.value.presets.some((p) => p.id === source.preset))
      selectedPresetId.value = source.preset;
  } else if (source.item && db.value.get(source.item)) {
    selectedId.value = source.item;
  } else {
    selectedId.value = null;
    selectedBonusId.value = null;
    selectedPresetId.value = null;
    // BuildEditor's per-row "+" button lands here with no item selected -- seed the fresh
    // draft's filter from the row it was clicked on (see BuildEditor.vue's `onAddItem`).
    // One-shot, so read straight off the URL rather than `source`: this is never part of
    // the per-layer store's own remembered state (`LayerEditorUiState` has no such field).
    if (routed.newItemFilter) {
      duplicateItemSeed.value = {
        id: "",
        name: "",
        filter: routed.newItemFilter,
      };
      // ItemForm's `:key` already resolved for this mount by the time this handler runs
      // (onMounted fires post-render) -- bump the counter so it remounts and picks up the
      // seed, same as `duplicateItem()` does for its own seed below.
      newItemCounter.value++;
      notice.value = `New item — filter pre-filled from "${routed.newItemFilter}"`;
    }
  }
  if (isValidStatusFilter(source.status)) statusFilter.value = source.status;
  if (source.q) query.value = source.q;
  // One-shot: consumed above, and a stale value must not resurrect on a later back/forward
  // navigation or reload of this same URL.
  if (routed.newItemFilter)
    router.apply({ newItemFilter: null }, { push: false });
});

useEventListener(window, "popstate", onPopState);

onUnmounted(() => {
  router.apply(
    {
      item: null,
      bonus: null,
      preset: null,
      section: null,
      status: null,
      q: null,
      newItemFilter: null,
    },
    { push: false },
  );
});
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col p-3">
    <!-- Layer header strip -->
    <div class="mb-2 flex flex-none flex-wrap items-center gap-1.5">
      <div class="flex items-center gap-1.5">
        <BaseCheckbox
          :model-value="props.layer.enabled"
          @update:model-value="
            (v) =>
              typeof v === 'boolean' &&
              layers.setLayerEnabled(props.layer.id, v)
          "
        />
        <strong>{{ props.layer.name }}</strong>
        <span class="text-sm text-muted tabular-nums"
          >{{ entryCount }} entr{{ entryCount === 1 ? "y" : "ies" }}</span
        >
      </div>

      <span class="mx-1 h-4 w-px bg-line"></span>

      <TabStrip>
        <TabButton
          :active="section === 'items'"
          @click="switchSection('items')"
        >
          Items
          <span class="text-sm opacity-75 tabular-nums">{{
            db.items.length
          }}</span>
        </TabButton>
        <TabButton
          :active="section === 'bonuses'"
          @click="switchSection('bonuses')"
        >
          Bonuses
          <span class="text-sm opacity-75 tabular-nums">{{
            db.bonuses.length
          }}</span>
        </TabButton>
        <TabButton
          :active="section === 'sectionPresets'"
          @click="switchSection('sectionPresets')"
        >
          Presets
          <span class="text-sm opacity-75 tabular-nums">{{
            db.presets.length
          }}</span>
        </TabButton>
      </TabStrip>

      <span class="flex-1"></span>

      <BaseBadge v-if="changedCount" variant="edited"
        >{{ changedCount }} changed</BaseBadge
      >
      <BaseBadge v-if="errorCount" variant="error"
        >{{ errorCount }} error(s)</BaseBadge
      >
      <BaseBadge v-if="warnCount" variant="warn"
        >{{ warnCount }} warning(s)</BaseBadge
      >

      <BaseButton :active="showExport" @click="showExport = !showExport"
        ><Download />Export…</BaseButton
      >
      <BaseButton as="label"
        ><Upload />Import overlay
        <input type="file" accept=".json" hidden @change="importOverlay"
      /></BaseButton>
      <BaseButton
        :danger="confirmReset_.isConfirming('reset')"
        :disabled="!changedCount"
        @click="resetAll"
      >
        <RotateCcw />
        {{
          confirmReset_.isConfirming("reset")
            ? "Really discard?"
            : "Discard changes"
        }}
      </BaseButton>

      <span class="mx-1 h-4 w-px bg-line"></span>
    </div>

    <!-- Disabled layer banner -->
    <div
      v-if="!props.layer.enabled"
      class="mb-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-sm text-warn"
    >
      This layer is disabled — its changes are not currently applied to the
      build. Enable it to see its effects.
    </div>

    <BaseNotice v-if="notice" class="mb-2" @dismiss="notice = ''">{{
      notice
    }}</BaseNotice>

    <LayerExportDrawer
      v-if="showExport"
      v-model="exportTab"
      :overlay="overlay"
      class="mb-2"
      @notice="notice = $event"
    />

    <LayerValidationDrawer
      v-if="findings.length"
      :findings="findings"
      @select="selectFinding"
    />

    <div class="flex min-h-0 flex-1 flex-col items-stretch gap-3 lg:flex-row">
      <LayerEntryList
        v-model:query="query"
        v-model:status-filter="statusFilter"
        :rows="filtered"
        :section="section"
        :selected-key="selectedKey"
        :status-filter-options="statusFilterOptions"
        :has-unsaved-draft="hasUnsavedDraft"
        @select="select"
        @create="
          section === 'bonuses'
            ? newBonus()
            : section === 'sectionPresets'
              ? newPreset()
              : newItem()
        "
        @restore="restore"
      />

      <div
        class="min-w-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface px-3 pb-3"
      >
        <ItemForm
          v-if="section === 'items'"
          ref="form"
          :key="selectedId ?? `__new__${newItemCounter}`"
          :source="selected"
          :duplicate-from="duplicateItemSeed"
          :status="selectedStatus"
          :db="db"
          :filters="filters"
          :set-ids="setIds"
          :tags="tagList"
          :bonus-ids="bonusIds"
          :allocatable-ids="allocatableIds"
          @save="onSave"
          @update:item="onUpdateItem"
          @delete="onDelete"
          @duplicate="duplicateItem"
          @revert="onRevert"
          @save-set="onSaveBonus"
          @delete-set="onDeleteBonus"
          @update-set="onUpdateBonus"
        />
        <BonusForm
          v-else-if="section === 'bonuses'"
          ref="bonusForm"
          :key="selectedBonusId ?? `__new__${newItemCounter}`"
          :source="selectedBonus"
          :duplicate-from="duplicateBonusSeed"
          :status="selectedBonusStatus"
          :db="db"
          :set-ids="setIds"
          :tags="tagList"
          :bonus-ids="bonusIds"
          :allocatable-ids="allocatableIds"
          @save="onSaveBonusTop"
          @update:set="onUpdateBonusTop"
          @delete="onDeleteBonusTop"
          @duplicate="duplicateBonus"
          @revert="onRevertBonusTop"
        />
        <PresetForm
          v-else
          ref="presetForm"
          :key="selectedPresetId ?? `__new__${newItemCounter}`"
          :source="selectedPreset"
          :status="selectedPresetStatus"
          :db="db"
          :allocatable-ids="allocatableIds"
          @save="onSavePreset"
          @update:preset="onUpdatePreset"
          @delete="onDeletePreset"
          @revert="onRevertPreset"
        />
      </div>
    </div>
  </div>
</template>
