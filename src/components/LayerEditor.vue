<script setup lang="ts">
// The layer editor: browse/add/edit/remove items and shared bonuses in a single layer,
// lint the composed catalog, and export the results.
//
// Takes the selected Layer as a prop and writes through `layers.updateOverlay`. When the
// layer is disabled, the editor shows a muted banner saying its changes are not applied.
//
// The editor never writes to disk -- it cannot, this is a static client app. It edits the
// layer's overlay (see catalog.ts) and hands you the file contents to paste back.
import {
  computed,
  defineAsyncComponent,
  h,
  markRaw,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import BaseModal from "./ui/BaseModal.vue";
import { useEventListener, useMediaQuery } from "@vueuse/core";
import * as confirm from "../stores/confirm";
import ItemForm from "./game/ItemForm.vue";
import BonusForm from "./game/BonusForm.vue";
import PresetForm from "./game/PresetForm.vue";
import SlotForm from "./game/SlotForm.vue";
import LayerExportModal from "./game/LayerExportModal.vue";
/** Async so the window -- and the tooltip parser it pulls in -- stays out of the main chunk
 *  alongside the OCR engine it loads. It only ever renders behind a `v-if`.
 *
 *  `delay: 0` and a placeholder because otherwise the button appears to do nothing at all
 *  until the chunk arrives. */
const TooltipImportModal = defineAsyncComponent({
  loader: () => import("./game/TooltipImportModal.vue"),
  loadingComponent: () =>
    h(
      BaseModal,
      {
        title: "Read an item from a tooltip",
        panelClass: "w-[760px] max-w-[92vw]",
        onClose: () => (showTooltipImport.value = false),
      },
      () => h("p", { class: "p-4 text-muted" }, "Loading…"),
    ),
  delay: 0,
});
import LayerValidationDrawer from "./game/LayerValidationDrawer.vue";
import LayerEntryList from "./game/LayerEntryList.vue";
import BaseButton from "./ui/BaseButton.vue";
import RailGutter from "./ui/RailGutter.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import TabStrip from "./ui/TabStrip.vue";
import TabButton from "./ui/TabButton.vue";
import { ClipboardPaste, Download, RotateCcw, Upload } from "@lucide/vue";
import * as catalog from "../data/catalog";
import { showNotice } from "../stores/notice";
import * as router from "../lib/router";
import * as engine from "../stores/resolved";
import * as history from "../stores/history";
import * as layers from "../stores/layers";
import * as layerEditorUi from "../stores/layerEditorUi";
import * as rails from "../stores/rails";
import { matchesQuery } from "../lib/text-filter";
import type {
  CatalogGroup,
  CatalogOverlay,
  Db,
  Item,
  Bonus,
  BonusOption,
  BuildParameterSlot,
  SectionPreset,
  LintFinding,
  Layer,
} from "../types";
import type {
  EditorRow,
  ItemRow,
  BonusRow,
  PresetRow,
  SlotRow,
} from "./game/LayerEntryList.vue";

const entriesCollapsed = rails.collapsed("layerEntries");
const entriesWidth = rails.width("layerEntries");

// The two panes only sit side by side from `lg` up; below it they stack, and a pinned width
// would be a width on a full-bleed row. Matches the `lg:flex-row` on their container.
const sideBySide = useMediaQuery("(min-width: 64rem)");

/** Only an open rail in a side-by-side layout gets a width of its own. */
const entriesStyle = computed(() =>
  sideBySide.value && !entriesCollapsed.value
    ? { width: `${entriesWidth.value}px` }
    : undefined,
);

const props = defineProps<{ layer: Layer }>();

const overlay = computed(() => props.layer.overlay);
function setOverlay(newValue: CatalogOverlay) {
  layers.updateOverlay(props.layer.id, newValue);
}

/** Every overlay write is "snapshot the undo stack, then store the new overlay"; only the
 *  snapshot's action id and message vary. */
function commit(
  actionId: string | null,
  message: string,
  next: CatalogOverlay,
) {
  history.snapshot("layer", props.layer.id, actionId, message, overlay.value);
  setOverlay(next);
}

/** The editor's own catalog: the layer under edit folds last whatever its `enabled` flag
 * says, so its entries reach the lists, forms and lint even while switched off. Dropped from
 * the engine's fold order first, so an enabled layer folds once and on top. `markRaw` as in
 * `engine.db`. */
const db = computed(() =>
  markRaw(
    catalog.makeDb([
      ...engine.overlays.value.filter((o) => o !== overlay.value),
      overlay.value,
    ]),
  ),
);

/** This layer's own remembered section/filter/selection -- see the store's own doc comment.
 *  A computed, not a plain const: the nav can switch `props.layer` directly from one layer
 *  to another without this component unmounting, and a stale binding would leak writes into
 *  the previous layer's stored state. */
const ui = computed(() => layerEditorUi.getState(props.layer.id));

const query = ref("");
const statusFilter = ref("all"); // all | changed | added | edited | removed
const section = ref<CatalogGroup>("items");

/** One entry per overlay group, so a section is data rather than a fourth if/else branch:
 *  adding a fifth is an entry here plus its own form block in the template. `routerKey`
 *  mirrors the router params' naming, which predates this table. `labelIn` returns null for
 *  an id that no longer resolves, so callers fall back to the raw id. */
interface SectionDef {
  group: CatalogGroup;
  routerKey: "item" | "bonus" | "preset" | "slot";
  noun: string;
  existsIn(db: Db, id: string): boolean;
  labelIn(db: Db, id: string): string | null;
  rowsFrom(db: Db, overlay: CatalogOverlay): EditorRow[];
  /** Clears this section's own duplicate seed before blanking the selection. */
  createNew(): void;
}
const SECTIONS: Record<CatalogGroup, SectionDef> = {
  items: {
    group: "items",
    routerKey: "item",
    noun: "item",
    existsIn: (db, id) => Boolean(db.get(id)),
    labelIn: (db, id) => db.get(id)?.name ?? null,
    rowsFrom: itemRowsFrom,
    createNew: () => newItem(),
  },
  bonuses: {
    group: "bonuses",
    routerKey: "bonus",
    noun: "bonus",
    existsIn: (db, id) => Boolean(db.bonusById.get(id)),
    labelIn: (db, id) => {
      const bonus = db.bonusById.get(id);
      return bonus ? bonus.name || bonus.id : null;
    },
    rowsFrom: bonusRowsFrom,
    createNew: () => newBonus(),
  },
  sectionPresets: {
    group: "sectionPresets",
    routerKey: "preset",
    noun: "preset",
    existsIn: (db, id) => db.presets.some((preset) => preset.id === id),
    labelIn: (db, id) => {
      const preset = db.presets.find((candidate) => candidate.id === id);
      return preset ? preset.label || preset.id : null;
    },
    rowsFrom: presetRowsFrom,
    createNew: () => newPreset(),
  },
  slots: {
    group: "slots",
    routerKey: "slot",
    noun: "parameter",
    existsIn: (db, id) => db.slotById.has(id),
    labelIn: (db, id) => {
      const slot = db.authoredSlots.find((candidate) => candidate.id === id);
      return slot ? slot.label || slot.id : null;
    },
    rowsFrom: slotRowsFrom,
    createNew: () => newSlot(),
  },
};

/** `EditorRow.kind` names things the way the row lists do ("sectionPreset", singular); the
 *  overlay/router side names them the way `CatalogOverlay` does ("sectionPresets", plural).
 *  One lookup instead of a `kind === "bonus" ? "bonuses" : ...` chain at each of the three
 *  places (`select`, `restore`, `selectFinding`) that need to cross from one naming to the
 *  other. */
const GROUP_OF_KIND: Record<EditorRow["kind"], CatalogGroup> = {
  item: "items",
  bonus: "bonuses",
  sectionPreset: "sectionPresets",
  slot: "slots",
};

/** This layer's current selection, one id per overlay group. One reactive record rather than
 *  four `selectedXId` refs, which always moved in lockstep with `section` itself. */
const selectedBySection = reactive<Record<CatalogGroup, string | null>>({
  items: null,
  bonuses: null,
  sectionPresets: null,
  slots: null,
});

const showExport = ref(false);
const showTooltipImport = ref(false);
const exportTab = ref("overlay"); // items | bonuses | overlay | slots
const newItemCounter = ref(0);
/** Seed values for the next brand-new item/bonus draft, set by "Duplicate" and consumed
 *  once at that form's mount -- cleared whenever a plain "New" is requested instead so a
 *  stale duplicate doesn't leak into an unrelated blank draft.
 *
 *  An item seed can also arrive from outside: BuildEditor's Ctrl/Cmd+click on an empty slot
 *  row leaves a blank item pre-narrowed to that row for this mount to pick up. Taken here at
 *  setup rather than in `onMounted` so ItemForm's very first render already builds its draft
 *  from it, with no remount needed to notice it. */
const newItemSeed = layerEditorUi.takeNewItemSeed();
const duplicateItemSeed = ref<Item | null>(newItemSeed);
const duplicateBonusSeed = ref<Bonus | null>(null);
/** Same one-shot handoff as `newItemSeed`, from BuildSection's "Create new from current". */
const newPresetSeed = layerEditorUi.takeNewPresetSeed();
const duplicatePresetSeed = ref<SectionPreset | null>(newPresetSeed);

const form = ref<InstanceType<typeof ItemForm> | null>(null);
const bonusForm = ref<InstanceType<typeof BonusForm> | null>(null);
const presetForm = ref<InstanceType<typeof PresetForm> | null>(null);
const slotForm = ref<InstanceType<typeof SlotForm> | null>(null);

/** One row per composed-catalog entry plus one per tombstone, name-sorted. Removed entries
 *  are gone from `db`, so without the tombstone pass (`catalog.tombstoneIds`) a deletion would
 *  vanish from the list with no way back. */
function editorRows<E, R extends EditorRow>(
  entries: E[],
  toRow: (entity: E) => R,
  tombstones: string[],
  toTombstoneRow: (id: string) => R,
): R[] {
  const rows = entries.map(toRow);
  for (const id of tombstones) rows.push(toTombstoneRow(id));
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

function itemRowsFrom(catalogDb: Db, ovl: CatalogOverlay): ItemRow[] {
  return editorRows<Item, ItemRow>(
    catalogDb.items,
    (item) => ({
      key: item.id,
      name: item.name,
      filter: item.filter ?? "",
      item,
      status: catalog.statusOf(ovl, "items", item.id),
      kind: "item",
    }),
    catalog.tombstoneIds(ovl, "items"),
    (id) => ({
      key: id,
      // A tombstone only ever hides a shipped item, so its name is still in `base()`.
      name: catalog.base().items.find((item) => item.id === id)?.name ?? id,
      filter: "-",
      item: null,
      status: "removed",
      kind: "item",
    }),
  );
}

/** Same shape as `itemRowsFrom`, one row per bonus rather than per item, so the same
 * list/search/keyboard-nav code serves both without knowing which it's showing. */
function bonusRowsFrom(catalogDb: Db, ovl: CatalogOverlay): BonusRow[] {
  return editorRows<Bonus, BonusRow>(
    catalogDb.bonuses,
    (bonus) => ({
      key: bonus.id,
      name: bonus.name || bonus.id,
      filter: `${(bonus.grants ?? []).length} grant(s)`,
      bonus,
      status: catalog.statusOf(ovl, "bonuses", bonus.id),
      kind: "bonus",
    }),
    catalog.tombstoneIds(ovl, "bonuses"),
    (id) => ({
      key: id,
      name: id,
      filter: "-",
      bonus: null,
      status: "removed",
      kind: "bonus",
    }),
  );
}

/** Same shape as `itemRowsFrom`/`bonusRowsFrom`, one row per section preset. */
function presetRowsFrom(catalogDb: Db, ovl: CatalogOverlay): PresetRow[] {
  return editorRows<SectionPreset, PresetRow>(
    catalogDb.presets,
    (preset) => ({
      key: preset.id,
      name: preset.label || preset.id,
      filter: preset.section,
      preset,
      status: catalog.statusOf(ovl, "sectionPresets", preset.id),
      kind: "sectionPreset",
    }),
    catalog.tombstoneIds(ovl, "sectionPresets"),
    (id) => {
      const shipped = catalog
        .base()
        .sectionPresets.find((preset) => preset.id === id);
      return {
        key: id,
        name: shipped?.label ?? id,
        filter: shipped?.section ?? "-",
        preset: null,
        status: "removed",
        kind: "sectionPreset",
      };
    },
  );
}

/** Same shape again, one row per authorable slot. Only `build_parameter` slots are listed:
 * the other four variants aren't overlay-editable (see `CatalogOverlay.slots`), so showing
 * them would offer an edit that cannot be saved. */
function slotRowsFrom(catalogDb: Db, ovl: CatalogOverlay): SlotRow[] {
  return editorRows<BuildParameterSlot, SlotRow>(
    // Authored, not resolved: SlotForm edits what was written, so a slot deriving its options
    // from items must not arrive at the form with those options baked in as inline rows.
    catalogDb.authoredSlots.filter(
      (slot): slot is BuildParameterSlot => slot.type === "build_parameter",
    ),
    (slot) => ({
      key: slot.id,
      name: slot.label || slot.id,
      filter: slot.path,
      slot,
      status: catalog.statusOf(ovl, "slots", slot.id),
      kind: "slot",
    }),
    catalog.tombstoneIds(ovl, "slots"),
    (id) => ({
      key: id,
      name: catalog.base().slots.find((slot) => slot.id === id)?.label ?? id,
      filter: "-",
      slot: null,
      status: "removed",
      kind: "slot",
    }),
  );
}

const rows = computed<EditorRow[]>(() =>
  SECTIONS[section.value].rowsFrom(db.value, overlay.value),
);

/** The Parameters tab's count badge, which has to be right while a different section is
 *  showing. Authored-and-filtered plus tombstones, so it can't be read off `db` directly. */
const slotRowCount = computed(
  () => slotRowsFrom(db.value, overlay.value).length,
);

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
  if (selectedBySection.items == null) return null;
  return db.value.get(selectedBySection.items);
});

const selectedBonus = computed(() => {
  if (selectedBySection.bonuses == null) return null;
  return db.value.bonusById.get(selectedBySection.bonuses) ?? null;
});

const selectedPreset = computed(() => {
  if (selectedBySection.sectionPresets == null) return null;
  return (
    db.value.presets.find((p) => p.id === selectedBySection.sectionPresets) ??
    null
  );
});

const selectedSlot = computed(() => {
  if (selectedBySection.slots == null) return null;
  const slot = db.value.authoredSlots.find(
    (candidate) => candidate.id === selectedBySection.slots,
  );
  return slot?.type === "build_parameter" ? slot : null;
});

/** The status badge for whichever entity is currently selected. One computed rather than
 *  four: `EntryStatus` doesn't vary by entity type, and only one form is ever showing. */
const selectedStatus = computed(() => {
  const id = selectedBySection[section.value];
  return id == null
    ? "base"
    : catalog.statusOf(overlay.value, section.value, id);
});

const filters = computed<string[]>(() =>
  [
    ...new Set<string>(
      db.value.items
        .map((item) => item.filter)
        .filter((f): f is string => Boolean(f)),
    ),
  ].sort(),
);

/** Every known bonus id, for id-collision avoidance and the `excludes` vocabulary. */
const allBonusIds = computed<string[]>(() =>
  [...new Set<string>(db.value.bonuses.map((bonus) => bonus.id))].sort(),
);

/** Every known bonus as a BonusComboBox choice, listed by name the way its rows lead. */
const bonusOptions = computed<BonusOption[]>(() =>
  db.value.bonuses
    .map((bonus) => ({ value: bonus.id, label: bonus.name ?? bonus.id }))
    .sort((a, b) => a.label.localeCompare(b.label)),
);

const tagList = computed<string[]>(() =>
  [...db.value.itemsByTag.keys()].sort(),
);

const changedCount = computed(
  () =>
    Object.keys(overlay.value.items ?? {}).length +
    Object.keys(overlay.value.bonuses ?? {}).length +
    Object.keys(overlay.value.sectionPresets ?? {}).length +
    Object.keys(overlay.value.slots ?? {}).length,
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
  for (const value of Object.values(overlay.value.slots ?? {})) {
    if (value !== null) count += 1;
  }
  return count;
});

const hasUnsavedDraft = (row: EditorRow) => {
  if (row.kind === "bonus" && row.key === selectedBySection.bonuses)
    return bonusForm.value?.dirty ?? false;
  if (
    row.kind === "sectionPreset" &&
    row.key === selectedBySection.sectionPresets
  )
    return presetForm.value?.dirty ?? false;
  if (row.kind === "slot" && row.key === selectedBySection.slots)
    return slotForm.value?.dirty ?? false;
  return false;
};

/** All existing ids across base + every layer + the selected build's catalog, for id
 * allocation. See decision 12 and phase 2b §2.5. */
const allocatableIds = computed(() => {
  const ids = new Set<string>(layers.allocatableIds());
  const build = engine.db.value.items.map((item) => item.id);
  for (const id of build) ids.add(id);
  for (const preset of engine.db.value.presets) ids.add(preset.id);
  for (const slot of engine.db.value.slots) ids.add(slot.id);
  return [...ids];
});

const findings = computed(() =>
  catalog.validate(
    db.value.items,
    db.value.bonuses,
    undefined,
    db.value.presets,
    db.value.authoredSlots,
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

/** The router-params patch for making `id` the selection in `group`: its own key set, every
 *  *other* section's key nulled out. `slot` is deliberately never included in that clearing,
 *  since it is only ever written by the slots section itself. */
function routeParamsFor(
  group: CatalogGroup,
  id: string | null,
): router.RouterParams {
  const params: router.RouterParams = { item: null, bonus: null, preset: null };
  params[SECTIONS[group].routerKey] = id;
  return params;
}

/** Just this section's own key, without `routeParamsFor`'s clearing of the others: a save or
 *  delete inside a section never changes which section is showing. */
function routeParamFor(
  group: CatalogGroup,
  id: string | null,
): router.RouterParams {
  return { [SECTIONS[group].routerKey]: id };
}

/** Whether `source.status` names one of `statusFilterOptions`' own values. */
function isValidStatusFilter(value: unknown) {
  return statusFilterOptions.some((option) => option.value === value);
}

/** The section/selection fields `restoreSelection` reads. Not `Record<string, string>`: only
 *  a type without an index signature of its own accepts both a parsed route and
 *  `LayerEditorUiState` without a cast. */
interface SelectionSource {
  section?: string;
  item?: string;
  bonus?: string;
  preset?: string;
  slot?: string;
}

/** Applies `source`'s section/selection fields (a parsed route, or the per-layer `ui` store)
 *  to `section`/`selectedBySection`, shared by `onPopState` and `onMounted`. An id that no
 *  longer resolves in `db` is dropped, so a stale or hand-edited URL can't select something
 *  that isn't there. */
function restoreSelection(source: SelectionSource) {
  for (const group of ["bonuses", "sectionPresets", "slots"] as const) {
    if (source.section !== group) continue;
    section.value = group;
    const id = source[SECTIONS[group].routerKey];
    selectedBySection[group] =
      id && SECTIONS[group].existsIn(db.value, id) ? id : null;
    return;
  }
  section.value = "items";
  selectedBySection.items =
    source.item && SECTIONS.items.existsIn(db.value, source.item)
      ? source.item
      : null;
}

/** Back/forward landed on this component while it was already mounted (still in the
 * editor, just a different item/bonus/section/status filter/query). A fresh mount reads the
 * same params in `onMounted`. */
function onPopState() {
  // A duplicate draft's seed is only ever meant for the mount it was set up for -- back/
  // forward must never resurrect it onto an unrelated blank draft.
  duplicateItemSeed.value = null;
  duplicateBonusSeed.value = null;
  duplicatePresetSeed.value = null;
  const route = router.parse();
  restoreSelection(route);
  statusFilter.value = isValidStatusFilter(route.status) ? route.status : "all";
  query.value = route.q ?? "";
}

function switchSection(target: CatalogGroup) {
  if (section.value === target) return;
  section.value = target;
  router.apply({
    section: target === "items" ? null : target,
    ...routeParamsFor(target, selectedBySection[target]),
  });
}

function select(row: EditorRow, { push = true }: { push?: boolean } = {}) {
  if (row.status === "removed") return;
  const group = GROUP_OF_KIND[row.kind];
  selectedBySection[group] = row.key;
  router.apply(routeParamsFor(group, row.key), { push });
}

const selectedKey = computed(() => selectedBySection[section.value]);

/** Blanks `group`'s selection so its form mounts as an empty draft. The counter is what
 *  forces that remount even when the selection was already null. */
function newEntry(group: CatalogGroup) {
  selectedBySection[group] = null;
  newItemCounter.value++;
  router.apply(routeParamFor(group, null));
}

function newItem() {
  duplicateItemSeed.value = null;
  newEntry("items");
}

function newBonus() {
  duplicateBonusSeed.value = null;
  newEntry("bonuses");
}

/** The entry list's "create" click, dispatched to the current section's own `createNew`:
 *  each clears a differently-typed duplicate seed, the template needs only one handler. */
function createEntry() {
  SECTIONS[section.value].createNew();
}

/** Opens a new item draft pre-filled from the currently selected item -- an explicit Save
 *  is still required, and that Save is what mints the copy's id (from whatever name ends
 *  up in the draft, so retyping the name before saving is what changes it). */
function duplicateItem() {
  const item = selected.value;
  if (!item) return;
  duplicateItemSeed.value = item;
  selectedBySection.items = null;
  newItemCounter.value++;
  router.apply({ item: null });
  showNotice(`Duplicating "${item.name}". Edit and save to create a copy.`);
}

/** Opens a new item draft seeded from a pasted tooltip. Like "Duplicate", the seed is only
 *  a draft -- an explicit Save is what mints the item, so every parsed value stays editable
 *  and anything the parser could not read is simply an empty field. */
function createFromTooltip(draft: Partial<Item>) {
  section.value = "items";
  selectedBySection.items = null;
  duplicateItemSeed.value = { id: "", name: "", ...draft } as Item;
  newItemCounter.value++;
  router.apply({ item: null });
  showTooltipImport.value = false;
  showNotice(
    `Filled ${Object.keys(draft).length} field(s) from the tooltip. Review and save to create the item.`,
  );
}

/** How the tooltip window should name the item its "apply" buttons write into, or null when
 *  no item form is on screen to receive them. A new unsaved draft counts: applying is how a
 *  draft started from one screenshot picks up a value read off the next. */
const applyTarget = computed(() => {
  if (section.value !== "items") return null;
  return selected.value ? `"${selected.value.name}"` : "the new item";
});

/** Sends values read off a tooltip into the item form beside the window. The form merges them
 *  into its own draft, which means an existing item takes them as an ordinary live edit --
 *  covered by the layer's history like any other -- and a new draft simply gains them. */
function applyFromTooltip({
  patch,
  label,
}: {
  patch: Partial<Item>;
  label: string;
}) {
  form.value?.applyPatch(patch);
  showNotice(`Applied ${label} from the tooltip to ${applyTarget.value}`);
}

function duplicateBonus() {
  const bonus = selectedBonus.value;
  if (!bonus) return;
  duplicateBonusSeed.value = bonus;
  selectedBySection.bonuses = null;
  newItemCounter.value++;
  router.apply({ bonus: null });
  showNotice(
    `Duplicating "${bonus.name || bonus.id}". Edit and save to create a copy.`,
  );
}

function newPreset() {
  duplicatePresetSeed.value = null;
  newEntry("sectionPresets");
}

function newSlot() {
  newEntry("slots");
}

// --- overlay writes ---------------------------------------------------------------------
// One save/live-edit/delete/revert over whichever overlay group SECTIONS names. Only the
// payload each form emits stays per-section, as the thin wrappers further down.

/** Writes `entity` into `group` and selects it. `label` comes from the entity rather than
 *  `labelIn`, since a brand-new entry is not in `db` until this write lands. */
function saveEntry(
  group: CatalogGroup,
  id: string,
  entity: Item | Bonus | SectionPreset | BuildParameterSlot,
  label: string,
) {
  const { noun } = SECTIONS[group];
  commit(
    `save-${group}:${id}`,
    `Save ${noun} "${label}"`,
    catalog.upsert(overlay.value, group, id, entity),
  );
  selectedBySection[group] = id;
  router.apply(routeParamFor(group, id));
  showNotice(`Saved ${noun} "${label}"`);
}

/** Live-edit handler: debounced changes from an existing entry go here. `label` is the
 *  form's own "what changed" text, which becomes the undo step's label. */
function updateEntry(
  group: CatalogGroup,
  id: string,
  entity: Item | Bonus | SectionPreset | BuildParameterSlot,
  label: string,
) {
  commit(
    `edit-${group}:${id}`,
    label,
    catalog.upsert(overlay.value, group, id, entity),
  );
}

function deleteEntry(group: CatalogGroup) {
  const { noun, labelIn } = SECTIONS[group];
  const id = selectedBySection[group]!;
  const label = labelIn(db.value, id) ?? id;
  commit(
    `delete-${group}:${id}`,
    `Delete ${noun} "${label}"`,
    catalog.remove(overlay.value, group, id),
  );
  selectedBySection[group] = null;
  router.apply(routeParamFor(group, null));
  showNotice(`Removed ${noun} "${label}"`);
}

function revertEntry(group: CatalogGroup) {
  const { noun, labelIn } = SECTIONS[group];
  const id = selectedBySection[group]!;
  const label = labelIn(db.value, id) ?? id;
  commit(
    `revert-${group}:${id}`,
    `Revert ${noun} "${label}"`,
    catalog.revert(overlay.value, group, id),
  );
  showNotice(`Reverted ${noun} "${label}" to the shipped version`);
}

function restore(row: EditorRow) {
  const group = GROUP_OF_KIND[row.kind];
  const { noun } = SECTIONS[group];
  commit(
    `restore-${group}:${row.key}`,
    `Restore ${noun} "${row.name}"`,
    catalog.revert(overlay.value, group, row.key),
  );
  showNotice(`Restored ${noun} "${row.name}"`);
}

async function resetAll(event: MouseEvent) {
  const { ok } = await confirm.askUnless(event.shiftKey, {
    title: "Discard changes",
    message: `Discard all ${changedCount.value} unsaved change${changedCount.value === 1 ? "" : "s"} in this layer?`,
    confirmLabel: "Discard",
    note: confirm.UNDO_NOTE,
  });
  if (!ok) return;
  commit(null, "Discard all changes", catalog.emptyOverlay());
  const cleared: router.RouterParams = {};
  for (const group of Object.keys(SECTIONS) as CatalogGroup[]) {
    selectedBySection[group] = null;
    Object.assign(cleared, routeParamFor(group, null));
  }
  router.apply(cleared);
  showNotice("Discarded every change. The layer is back to the shipped data.");
}

/** Shows `id` in `group`, switching section if needed. */
function jumpTo(group: CatalogGroup, id: string) {
  section.value = group;
  selectedBySection[group] = id;
  router.apply({
    section: group === "items" ? null : group,
    ...routeParamsFor(group, id),
  });
}

/** Jump to whatever a validation finding points at. Findings carry `kind` precisely so this
 * doesn't have to guess from the id/name shape. */
function selectFinding(finding: LintFinding) {
  if (!finding.name) return;
  jumpTo(GROUP_OF_KIND[finding.kind], finding.name);
}

/** A bonus form's "Granted by" link: open that item. */
const openItem = (itemId: string) => jumpTo("items", itemId);

// The per-section wrappers: each names the payload its own form emits, then defers.
const onSave = ({ item }: { item: Item }) =>
  saveEntry("items", item.id, item, item.name);
const onUpdateItem = ({ item, label }: { item: Item; label: string }) =>
  updateEntry("items", item.id, item, label);
const onDelete = () => deleteEntry("items");
const onRevert = () => revertEntry("items");

const onSaveBonusTop = ({ id, bonus }: { id: string; bonus: Bonus }) =>
  saveEntry("bonuses", id, bonus, bonus.name || id);
const onUpdateBonusTop = ({
  id,
  bonus,
  label,
}: {
  id: string;
  bonus: Bonus;
  label: string;
}) => updateEntry("bonuses", id, bonus, label);
const onDeleteBonusTop = () => deleteEntry("bonuses");
const onRevertBonusTop = () => revertEntry("bonuses");

const onSavePreset = ({ preset }: { preset: SectionPreset }) =>
  saveEntry("sectionPresets", preset.id, preset, preset.label || preset.id);
const onUpdatePreset = ({
  preset,
  label,
}: {
  preset: SectionPreset;
  label: string;
}) => updateEntry("sectionPresets", preset.id, preset, label);
const onDeletePreset = () => deleteEntry("sectionPresets");
const onRevertPreset = () => revertEntry("sectionPresets");

const onSaveSlot = ({ slot }: { slot: BuildParameterSlot }) =>
  saveEntry("slots", slot.id, slot, slot.label || slot.id);
const onUpdateSlot = ({
  slot,
  label,
}: {
  slot: BuildParameterSlot;
  label: string;
}) => updateEntry("slots", slot.id, slot, label);
const onDeleteSlot = () => deleteEntry("slots");
const onRevertSlot = () => revertEntry("slots");

// --- bonuses nested in the item form ------------------------------------------------------
// ItemForm's bonus sub-editor writes the same overlay group as the Bonuses section, but must
// leave the selection and the URL alone: the item stays selected, so `saveEntry`/`deleteEntry`
// would move focus off it.

function onSaveBonus({ id, bonus }: { id: string; bonus: Bonus }) {
  const label = bonus.name || id;
  commit(
    `save-bonuses:${id}`,
    `Save bonus "${label}"`,
    catalog.upsert(overlay.value, "bonuses", id, bonus),
  );
  showNotice(`Saved bonus "${label}"`);
}

/** Live-edit handler for that sub-editor. ItemBonuses emits no "what changed" text of its
 *  own, so the undo step is labeled from the bonus itself. */
function onUpdateBonus({ id, bonus }: { id: string; bonus: Bonus }) {
  updateEntry("bonuses", id, bonus, `Edit bonus "${bonus.name || id}"`);
}

function onDeleteBonus(id: string) {
  const label = SECTIONS.bonuses.labelIn(db.value, id) ?? id;
  commit(
    `delete-bonuses:${id}`,
    `Delete bonus "${label}"`,
    catalog.remove(overlay.value, "bonuses", id),
  );
  showNotice(`Removed bonus "${label}"`);
}

async function importOverlay(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    commit(null, "Import overlay", catalog.normalizeOverlay(parsed));
    showNotice("Overlay imported");
  } catch (error: unknown) {
    showNotice(
      `Could not read that overlay: ${error instanceof Error ? error.message : String(error)}`,
    );
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
// has been cleared by `onUnmounted` below. `selectedBySection` is a reactive object, not a
// ref, so it deep-watches by default even inside this array of sources.
watch(
  [section, selectedBySection, statusFilter, query],
  ([sec, sel, status, q]) => {
    ui.value.section = sec;
    ui.value.item = sel.items ?? "";
    ui.value.bonus = sel.bonuses ?? "";
    ui.value.preset = sel.sectionPresets ?? "";
    ui.value.slot = sel.slots ?? "";
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
    routed.slot ||
    routed.section ||
    routed.status ||
    routed.q,
  );
}

onMounted(() => {
  const routed = router.parse();
  const routedActive = hasRoutedLayerState(routed);
  const source = routedActive ? routed : ui.value;
  // Restore what this layer had open, unless a new-item seed outranks it (first branch).
  // When the layer changes, keep the `item` param if the new layer's composed catalog
  // still has that id, otherwise drop it (phase 6 §2.3).
  if (newPresetSeed) {
    // BuildSection's "Create new from current": the pre-filled draft *is* the point of the
    // jump, so it outranks whatever this layer had open -- same reasoning as `newItemSeed`.
    section.value = "sectionPresets";
    selectedBySection.sectionPresets = null;
    ui.value.section = "sectionPresets";
    ui.value.preset = "";
    showNotice("New preset from the current build. Name it and save.");
  } else if (newItemSeed) {
    // BuildEditor's Ctrl/Cmd+click on an empty slot row: the blank draft *is* the point of the
    // jump, so restoring whatever this layer had open before would throw it away. The per-layer
    // memory is rewritten to match, since that is what a later remount restores from.
    section.value = "items";
    ui.value.section = "items";
    ui.value.item = "";
    const narrowedTo = [newItemSeed.filter, ...(newItemSeed.tags ?? [])]
      .filter(Boolean)
      .join(", ");
    showNotice(`New item, pre-filled for "${narrowedTo}"`);
  } else {
    restoreSelection(source);
  }
  if (isValidStatusFilter(source.status)) statusFilter.value = source.status;
  if (source.q) query.value = source.q;
});

useEventListener(window, "popstate", onPopState);

onUnmounted(() => {
  router.apply(
    {
      item: null,
      bonus: null,
      preset: null,
      slot: null,
      section: null,
      status: null,
      q: null,
    },
    { push: false },
  );
});
</script>

<template>
  <div
    class="flex min-h-0 min-w-0 flex-1 flex-col p-3"
    data-undo-scope="editor"
  >
    <!-- Layer header strip -->
    <div class="mb-2 flex flex-none flex-wrap items-center gap-1.5">
      <div class="flex items-center gap-1.5">
        <BaseCheckbox
          data-testid="layer-enabled"
          :model-value="props.layer.enabled"
          @update:model-value="
            (v) =>
              typeof v === 'boolean' &&
              layers.setLayerEnabled(props.layer.id, v)
          "
        />
        <strong>{{ props.layer.name }}</strong>
        <span class="text-muted tabular-nums"
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
          <span class="opacity-75 tabular-nums">{{ db.items.length }}</span>
        </TabButton>
        <TabButton
          :active="section === 'bonuses'"
          @click="switchSection('bonuses')"
        >
          Bonuses
          <span class="opacity-75 tabular-nums">{{ db.bonuses.length }}</span>
        </TabButton>
        <TabButton
          :active="section === 'sectionPresets'"
          @click="switchSection('sectionPresets')"
        >
          Presets
          <span class="opacity-75 tabular-nums">{{ db.presets.length }}</span>
        </TabButton>
        <TabButton
          :active="section === 'slots'"
          data-testid="tab-slots"
          @click="switchSection('slots')"
        >
          Parameters
          <span class="opacity-75 tabular-nums">{{ slotRowCount }}</span>
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

      <BaseButton
        :active="showExport"
        data-testid="layer-export-toggle"
        @click="showExport = !showExport"
        ><Download />Export…</BaseButton
      >
      <BaseButton as="label"
        ><Upload />Import
        <input type="file" accept=".json" hidden @change="importOverlay"
      /></BaseButton>
      <BaseButton
        :active="showTooltipImport"
        data-testid="tooltip-import-toggle"
        @click="showTooltipImport = !showTooltipImport"
        ><ClipboardPaste />From screenshot...</BaseButton
      >

      <BaseButton :disabled="!changedCount" @click="resetAll">
        <RotateCcw />
        Discard changes…
      </BaseButton>

      <span class="mx-1 h-4 w-px bg-line"></span>
    </div>

    <!-- Disabled layer banner -->
    <div
      v-if="!props.layer.enabled"
      class="mb-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-warn"
    >
      This layer is disabled; its changes are not currently applied to the
      build. Enable it to see its effects.
    </div>

    <LayerExportModal
      v-if="showExport"
      v-model="exportTab"
      :overlay="overlay"
      @notice="showNotice"
      @close="showExport = false"
    />

    <TooltipImportModal
      v-if="showTooltipImport"
      :apply-target="applyTarget"
      @create="createFromTooltip"
      @apply="applyFromTooltip"
      @close="showTooltipImport = false"
    />

    <LayerValidationDrawer
      v-if="findings.length"
      :findings="findings"
      @select="selectFinding"
    />

    <div class="flex min-h-0 flex-1 flex-col items-stretch gap-3 lg:flex-row">
      <!-- Narrowed or collapsed, the list hands its width to the form beside it -- the same
           trade the build editor's rails offer. The gutter holds the toggle either way. -->
      <div
        class="flex min-h-0 flex-none items-stretch"
        :class="entriesCollapsed && 'rounded-md border border-line bg-surface'"
        :style="entriesStyle"
        :data-testid="
          entriesCollapsed ? 'layer-entries-collapsed' : 'layer-entries-column'
        "
      >
        <LayerEntryList
          v-if="!entriesCollapsed"
          v-model:query="query"
          v-model:status-filter="statusFilter"
          class="min-w-0 flex-1"
          :rows="filtered"
          :section="section"
          :selected-key="selectedKey"
          :status-filter-options="statusFilterOptions"
          :has-unsaved-draft="hasUnsavedDraft"
          @select="select"
          @create="createEntry"
          @restore="restore"
        />
        <RailGutter
          rail="layerEntries"
          side="left"
          label="the entry list"
          :collapsed="entriesCollapsed"
          :resizable="sideBySide"
        />
      </div>

      <div
        class="min-w-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface px-3 pb-3"
      >
        <ItemForm
          v-if="section === 'items'"
          ref="form"
          :key="`item:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selected"
          :duplicate-from="duplicateItemSeed"
          :status="selectedStatus"
          :db="db"
          :filters="filters"
          :all-bonus-ids="allBonusIds"
          :tags="tagList"
          :bonus-options="bonusOptions"
          :allocatable-ids="allocatableIds"
          @save="onSave"
          @update:item="onUpdateItem"
          @delete="onDelete"
          @duplicate="duplicateItem"
          @revert="onRevert"
          @save-bonus="onSaveBonus"
          @delete-bonus="onDeleteBonus"
          @update-bonus="onUpdateBonus"
          @open-item="openItem"
        />
        <BonusForm
          v-else-if="section === 'bonuses'"
          ref="bonusForm"
          :key="`bonus:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedBonus"
          :duplicate-from="duplicateBonusSeed"
          :status="selectedStatus"
          :db="db"
          :all-bonus-ids="allBonusIds"
          :tags="tagList"
          :bonus-options="bonusOptions"
          :allocatable-ids="allocatableIds"
          @save="onSaveBonusTop"
          @update:bonus="onUpdateBonusTop"
          @delete="onDeleteBonusTop"
          @duplicate="duplicateBonus"
          @revert="onRevertBonusTop"
          @open-item="openItem"
        />
        <SlotForm
          v-else-if="section === 'slots'"
          ref="slotForm"
          :key="`slot:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedSlot"
          :status="selectedStatus"
          :db="db"
          :allocatable-ids="allocatableIds"
          @save="onSaveSlot"
          @update:slot="onUpdateSlot"
          @delete="onDeleteSlot"
          @revert="onRevertSlot"
        />
        <PresetForm
          v-else
          ref="presetForm"
          :key="`preset:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedPreset"
          :duplicate-from="duplicatePresetSeed"
          :status="selectedStatus"
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
