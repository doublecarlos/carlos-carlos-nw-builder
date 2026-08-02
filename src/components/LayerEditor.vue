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
import { onKeyStroke, useEventListener } from "@vueuse/core";
import { useConfirm } from "../composables/useConfirm";
import ItemForm from "./game/ItemForm.vue";
import BonusSetForm from "./game/BonusSetForm.vue";
import ComboBox from "./ui/ComboBox.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import BaseNotice from "./ui/BaseNotice.vue";
import BaseDrawer from "./ui/BaseDrawer.vue";
import CodeBlock from "./ui/CodeBlock.vue";
import TabStrip from "./ui/TabStrip.vue";
import TabButton from "./ui/TabButton.vue";
import * as catalog from "../data/catalog";
import * as router from "../lib/router";
import * as engine from "../stores/resolved";
import * as history from "../stores/history";
import * as layers from "../stores/layers";
import type {
  CatalogGroup,
  CatalogOverlay,
  Item,
  BonusSet,
  LintFinding,
  Layer,
} from "../types";

const db = engine.db;

const props = defineProps<{ layer: Layer }>();

const overlay = computed(() => props.layer.overlay);
function setOverlay(newValue: CatalogOverlay) {
  layers.updateOverlay(props.layer.id, newValue);
}

const query = ref("");
const statusFilter = ref("all"); // all | changed | added | edited | removed
const section = ref("items"); // items | bonusSets
const selectedId = ref<string | null>(null);
const selectedSetId = ref<string | null>(null);
const showExport = ref(false);
const exportTab = ref("items"); // items | bonuses | overlay
const newItemCounter = ref(0);
const notice = ref("");
const confirmReset_ = useConfirm(4000);

const form = ref<InstanceType<typeof ItemForm> | null>(null);
const setForm = ref<InstanceType<typeof BonusSetForm> | null>(null);

interface ItemRow {
  key: string;
  name: string;
  filter: string;
  item: Item | null;
  status: string;
  kind: "item";
}
interface BonusSetRow {
  key: string;
  name: string;
  filter: string;
  set: BonusSet | null;
  status: string;
  kind: "bonusSet";
}
type EditorRow = ItemRow | BonusSetRow;

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
const bonusSetRows = computed<BonusSetRow[]>(() => {
  const rows: BonusSetRow[] = db.value.bonusSets.map((set) => ({
    key: set.id,
    name: set.name || set.id,
    filter: `${(set.grants ?? []).length} grant(s)`,
    set,
    status: catalog.statusOf(overlay.value, "bonusSets", set.id),
    kind: "bonusSet",
  }));
  for (const [id, value] of Object.entries(overlay.value.bonusSets ?? {})) {
    if (value === null) {
      rows.push({
        key: id,
        name: id,
        filter: "—",
        set: null,
        status: "removed",
        kind: "bonusSet",
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
});

const rows = computed(() =>
  section.value === "bonusSets" ? bonusSetRows.value : itemRows.value,
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return rows.value.filter((row) => {
    if (statusFilter.value === "changed" && row.status === "base") return false;
    if (
      ["added", "edited", "removed"].includes(statusFilter.value) &&
      row.status !== statusFilter.value
    )
      return false;
    if (!q) return true;
    return (
      row.name.toLowerCase().includes(q) ||
      (row.filter ?? "").toLowerCase().includes(q)
    );
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

const selectedSet = computed(() => {
  if (selectedSetId.value == null) return null;
  return db.value.bonusSetById.get(selectedSetId.value) ?? null;
});

const selectedSetStatus = computed(() =>
  selectedSetId.value == null
    ? "base"
    : catalog.statusOf(overlay.value, "bonusSets", selectedSetId.value),
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
  [...new Set<string>(db.value.bonusSets.map((set) => set.id))].sort(),
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
    Object.keys(overlay.value.bonusSets ?? {}).length,
);

/** Entry count badge: non-tombstone entries in the overlay. */
const entryCount = computed(() => {
  let count = 0;
  for (const value of Object.values(overlay.value.items ?? {})) {
    if (value !== null) count += 1;
  }
  for (const value of Object.values(overlay.value.bonusSets ?? {})) {
    if (value !== null) count += 1;
  }
  return count;
});

const hasUnsavedDraft = (row: EditorRow) => {
  if (row.kind === "bonusSet") {
    if (row.key === selectedSetId.value) return setForm.value?.dirty ?? false;
  }
  return false;
};

/** All existing ids across base + every layer + the selected build's catalog, for id
 * allocation. See decision 12 and phase 2b §2.5. */
const allocatableIds = computed(() => {
  const ids = new Set<string>(layers.allocatableIds());
  const build = engine.db.value.items.map((item) => item.id);
  for (const id of build) ids.add(id);
  return [...ids];
});

const findings = computed(() =>
  catalog.validate(db.value.items, db.value.bonusSets),
);

const errorCount = computed(
  () => findings.value.filter((f) => f.level === "error").length,
);
const warnCount = computed(
  () => findings.value.filter((f) => f.level === "warn").length,
);

const exportText = computed(() => {
  if (exportTab.value === "items") {
    // Composed across all enabled layers for the maintainer path.
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalog.toItemsFile(allEnabled.items);
  }
  if (exportTab.value === "bonuses") {
    const allEnabled = catalog.compose(layers.enabledOverlays.value);
    return catalog.toBonusesFile(allEnabled.bonusSets);
  }
  // "This layer": raw overlay JSON.
  return JSON.stringify(overlay.value, null, 2);
});

const exportName = computed(() => {
  if (exportTab.value === "items") return "db-items.json";
  if (exportTab.value === "bonuses") return "db-bonuses.json";
  return "catalog-overlay.json";
});

// --- filters ---------------------------------------------------------------------------

function clearFilters() {
  query.value = "";
  statusFilter.value = "all";
}

// --- routing --------------------------------------------------------------------------
// `item`/`set`/`section`/`status`/`q` are this component's own corner of the URL --
// App.vue owns view/build/tab and knows nothing about what's selected in here. `select`'s
// `push` flag is what keeps arrow-key browsing from filling the back/forward stack with
// one stop per keystroke: a click is a real "go to this row" navigation, an arrow key is
// just skimming.

function isValidStatusFilter(value: unknown) {
  return statusFilterOptions.some((option) => option.value === value);
}

/** Back/forward landed on this component while it was already mounted (still in the
 * editor, just a different item/set/section/status filter/query). A fresh mount reads the
 * same params in `onMounted`. */
function onPopState() {
  const route = router.parse();
  if (route.section === "bonusSets") {
    section.value = "bonusSets";
    selectedSetId.value =
      route.set && db.value.bonusSetById.get(route.set) ? route.set : null;
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
  router.apply(
    target === "bonusSets"
      ? { section: "bonusSets", item: null, set: selectedSetId.value }
      : { section: null, set: null, item: selectedId.value },
  );
}

function select(row: EditorRow, { push = true }: { push?: boolean } = {}) {
  if (row.status === "removed") return;
  if (row.kind === "bonusSet") {
    selectedSetId.value = row.key;
    router.apply({ set: row.key, item: null }, { push });
  } else {
    selectedId.value = row.key;
    router.apply({ item: row.key, set: null }, { push });
  }
}

/**
 * ArrowUp/Down drive the list from either the search box (kept focused, command-palette
 * style -- typing still filters normally) or a focused row. The current section's selected
 * key doubles as the keyboard cursor: the existing click UX has no separate "highlighted
 * but not open" state, so keyboard nav matches it exactly rather than inventing one.
 * Guarded to the search input or an `.editor-row` so the status ComboBox's own dropdown
 * keeps its arrows.
 */
onKeyStroke(["ArrowDown", "ArrowUp", "Enter"], (event) => {
  const target = event.target as HTMLElement;
  const isSearch = target.matches?.('input[type="search"]');
  const isRow = target.closest?.(".editor-row");
  if (!isSearch && !isRow) return;
  const rowsList = filtered.value;
  if (!rowsList.length) return;
  event.preventDefault();
  const currentKey =
    section.value === "bonusSets" ? selectedSetId.value : selectedId.value;
  const idx = rowsList.findIndex((row) => row.key === currentKey);
  if (event.key === "Enter") {
    if (idx !== -1) select(rowsList[idx]);
    return;
  }
  const dir = event.key === "ArrowDown" ? 1 : -1;
  const next =
    idx === -1
      ? dir === 1
        ? 0
        : rowsList.length - 1
      : Math.min(Math.max(idx + dir, 0), rowsList.length - 1);
  select(rowsList[next], { push: false });
});

function newItem() {
  selectedId.value = null;
  newItemCounter.value++;
  router.apply({ item: null });
}

function newSet() {
  selectedSetId.value = null;
  newItemCounter.value++;
  router.apply({ set: null });
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
  const group: CatalogGroup = row.kind === "bonusSet" ? "bonusSets" : "items";
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
  selectedSetId.value = null;
  router.apply({ item: null, set: null });
  notice.value = "Discarded every change — back to the shipped data";
}

/** Jump to whatever a validation finding points at, switching section if needed --
 * findings carry `kind` precisely so this doesn't have to guess from the id/name shape. */
function selectFinding(finding: LintFinding) {
  if (!finding.name) return;
  if (finding.kind === "bonusSet") {
    section.value = "bonusSets";
    selectedSetId.value = finding.name;
    router.apply({ section: "bonusSets", set: finding.name, item: null });
  } else {
    section.value = "items";
    selectedId.value = finding.name;
    router.apply({ section: null, item: finding.name, set: null });
  }
}

// --- bonus sets -----------------------------------------------------------------------
// `onSaveSet`/`onDeleteSet` are the sub-editor inside the item form (a bonus this item
// attaches or detaches); `onSaveSetTop`/`onDeleteSetTop`/`onRevertSetTop` are this
// component's own "Bonus sets" section, browsing and editing a set on its own.

function onSaveSet({ id, set }: { id: string; set: BonusSet }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `save-set:${id}`,
    `Save bonus "${set.name || id}"`,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonusSets", id, set));
  notice.value = `Saved set "${set.name || id}"`;
}

/** Live-edit handler: debounced changes from existing bonus sets in item editor go here. */
function onUpdateSet({ id, set }: { id: string; set: BonusSet }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `edit-set:${id}`,
    `Edit bonus "${set.name || id}"`,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonusSets", id, set));
}

function onDeleteSet(id: string) {
  history.snapshot(
    "layer",
    props.layer.id,
    `delete-set:${id}`,
    `Delete bonus "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.remove(overlay.value, "bonusSets", id));
  notice.value = `Removed set "${id}"`;
}

function onSaveSetTop({ id, set }: { id: string; set: BonusSet }) {
  history.snapshot(
    "layer",
    props.layer.id,
    `save-set:${id}`,
    `Save bonus set "${set.name || id}"`,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonusSets", id, set));
  selectedSetId.value = id;
  router.apply({ set: id });
  notice.value = `Saved bonus set "${set.name || id}"`;
}

/** Live-edit handler: debounced changes from existing bonus sets go here. */
function onUpdateSetTop({
  id,
  set,
  label,
}: {
  id: string;
  set: BonusSet;
  label: string;
}) {
  history.snapshot(
    "layer",
    props.layer.id,
    `edit-set:${id}`,
    label,
    overlay.value,
  );
  setOverlay(catalog.upsert(overlay.value, "bonusSets", id, set));
}

function onDeleteSetTop() {
  const id = selectedSetId.value!;
  history.snapshot(
    "layer",
    props.layer.id,
    `delete-set:${id}`,
    `Delete bonus set "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.remove(overlay.value, "bonusSets", id));
  selectedSetId.value = null;
  router.apply({ set: null });
  notice.value = `Removed bonus set "${id}"`;
}

function onRevertSetTop() {
  const id = selectedSetId.value!;
  history.snapshot(
    "layer",
    props.layer.id,
    `revert-set:${id}`,
    `Revert bonus set "${id}"`,
    overlay.value,
  );
  setOverlay(catalog.revert(overlay.value, "bonusSets", id));
  notice.value = `Reverted bonus set "${id}" to the shipped version`;
}

// --- export ---------------------------------------------------------------------------

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    notice.value = `Copied ${exportName.value} to the clipboard`;
  } catch {
    notice.value = "Clipboard blocked — select the text and copy it manually";
  }
}

function downloadExport() {
  const blob = new Blob([exportText.value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportName.value;
  link.click();
  URL.revokeObjectURL(url);
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

onMounted(() => {
  const routed = router.parse();
  // When the layer changes, keep the `item` param if the new layer's composed catalogue
  // still has that id, otherwise drop it (phase 6 §2.3).
  if (routed.section === "bonusSets") {
    section.value = "bonusSets";
    if (routed.set && db.value.bonusSetById.get(routed.set))
      selectedSetId.value = routed.set;
  } else if (routed.item && db.value.get(routed.item)) {
    selectedId.value = routed.item;
  } else {
    selectedId.value = null;
    selectedSetId.value = null;
  }
  if (isValidStatusFilter(routed.status)) statusFilter.value = routed.status;
  if (routed.q) query.value = routed.q;
});

useEventListener(window, "popstate", onPopState);

onUnmounted(() => {
  router.apply(
    { item: null, set: null, section: null, status: null, q: null },
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
          :active="section === 'bonusSets'"
          @click="switchSection('bonusSets')"
        >
          Bonus sets
          <span class="text-sm opacity-75 tabular-nums">{{
            db.bonusSets.length
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
        >Export…</BaseButton
      >
      <BaseButton as="label"
        >Import overlay
        <input type="file" accept=".json" hidden @change="importOverlay"
      /></BaseButton>
      <BaseButton
        :danger="confirmReset_.isConfirming('reset')"
        :disabled="!changedCount"
        @click="resetAll"
      >
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

    <BaseDrawer v-if="showExport" class="mb-2">
      <div class="mb-1.5 flex flex-wrap items-end gap-2">
        <TabStrip>
          <TabButton
            :active="exportTab === 'items'"
            @click="exportTab = 'items'"
            >db-items.json</TabButton
          >
          <TabButton
            :active="exportTab === 'bonuses'"
            @click="exportTab = 'bonuses'"
            >db-bonuses.json</TabButton
          >
          <TabButton
            :active="exportTab === 'overlay'"
            @click="exportTab = 'overlay'"
            >This layer</TabButton
          >
        </TabStrip>
        <span class="flex-1"></span>
        <BaseButton @click="copyExport">Copy</BaseButton>
        <BaseButton @click="downloadExport"
          >Download {{ exportName }}</BaseButton
        >
      </div>
      <CodeBlock :value="exportText" :rows="12" class="w-full" />
      <p class="mt-1 text-sm text-muted">
        <template v-if="exportTab === 'items'">
          Composed from all enabled layers — for regenerating the shipped data
          files.
        </template>
        <template v-else-if="exportTab === 'bonuses'">
          Composed from all enabled layers — for regenerating the shipped data
          files.
        </template>
        <template v-else> Just this layer's raw overlay JSON. </template>
      </p>
    </BaseDrawer>

    <BaseDrawer
      v-if="findings.length"
      class="mb-2 max-h-48 flex-none overflow-y-auto"
    >
      <div class="text-sm uppercase text-muted">Validation</div>
      <ul class="mt-1 list-none">
        <li
          v-for="(finding, i) in findings.slice(0, 40)"
          :key="i"
          class="flex gap-2 py-0.5 text-sm"
        >
          <span
            class="flex-none rounded px-1.5 uppercase"
            :class="
              finding.level === 'error'
                ? 'bg-danger-soft text-danger'
                : 'bg-warn/25 text-warn'
            "
            >{{ finding.level }}</span
          >
          <BaseButton
            v-if="finding.name"
            variant="link"
            @click="selectFinding(finding)"
            >{{ finding.name }}</BaseButton
          >
          <span>{{ finding.message }}</span>
        </li>
      </ul>
      <p v-if="findings.length > 40" class="mt-1 text-sm text-muted">
        …and {{ findings.length - 40 }} more.
      </p>
    </BaseDrawer>

    <div class="flex min-h-0 flex-1 flex-col items-stretch gap-3 lg:flex-row">
      <div
        class="flex min-h-0 flex-none flex-col rounded-md border border-line bg-surface lg:w-96"
      >
        <div class="flex flex-none gap-1.5 border-b border-line p-2">
          <input
            v-model="query"
            type="search"
            class="editor-search min-w-0 flex-1 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            :placeholder="
              section === 'bonusSets' ? 'Filter bonus sets…' : 'Filter items…'
            "
          />
          <ComboBox
            class="w-25"
            :model-value="statusFilter"
            :options="statusFilterOptions"
            @update:model-value="(v) => (statusFilter = v)"
          />
          <BaseButton
            v-if="query || statusFilter !== 'all'"
            variant="link"
            @click="clearFilters"
            >clear filters</BaseButton
          >
          <BaseButton
            v-if="section === 'bonusSets'"
            variant="primary"
            @click="newSet"
            >+ New bonus set</BaseButton
          >
          <BaseButton v-else variant="primary" @click="newItem"
            >+ New item</BaseButton
          >
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div
            v-for="row in filtered"
            :key="row.key"
            tabindex="0"
            class="editor-row flex cursor-pointer items-center gap-1.5 border-b border-line/45 px-2 py-1 hover:bg-surface-2"
            :class="
              row.key ===
                (section === 'bonusSets' ? selectedSetId : selectedId) &&
              'is-on bg-accent-soft'
            "
            @click="select(row)"
          >
            <span class="editor-row-name min-w-0 flex-1 truncate">{{
              row.name
            }}</span>
            <BaseBadge
              v-if="row.status !== 'base'"
              :variant="row.status as any"
              >{{ row.status }}</BaseBadge
            >
            <BaseBadge
              v-if="hasUnsavedDraft(row)"
              variant="unsaved"
              title="Unsaved edits in the form"
              >unsaved</BaseBadge
            >
            <BaseButton
              v-if="row.status === 'removed'"
              variant="link"
              @click.stop="restore(row)"
              >restore</BaseButton
            >
            <span v-else class="text-sm text-muted">{{ row.filter }}</span>
          </div>
          <p v-if="!filtered.length" class="p-2 text-muted">Nothing matches.</p>
        </div>
      </div>

      <div
        class="min-w-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface p-2.5"
      >
        <ItemForm
          v-if="section === 'items'"
          ref="form"
          :key="selectedId ?? `__new__${newItemCounter}`"
          :source="selected"
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
          @revert="onRevert"
          @save-set="onSaveSet"
          @delete-set="onDeleteSet"
          @update-set="onUpdateSet"
        />
        <BonusSetForm
          v-else
          ref="setForm"
          :key="selectedSetId ?? `__new__${newItemCounter}`"
          :source="selectedSet"
          :status="selectedSetStatus"
          :db="db"
          :set-ids="setIds"
          :tags="tagList"
          :bonus-ids="bonusIds"
          :allocatable-ids="allocatableIds"
          @save="onSaveSetTop"
          @update:set="onUpdateSetTop"
          @delete="onDeleteSetTop"
          @revert="onRevertSetTop"
        />
      </div>
    </div>
  </div>
</template>
