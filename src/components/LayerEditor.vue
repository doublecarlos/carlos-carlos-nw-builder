<script setup lang="ts">
// The layer editor: browse/add/edit/remove everything one layer can author (items, bonuses,
// filters, sections, slots and presets), lint the composed catalog, and export the results.
//
// Takes the selected Layer as a prop and writes through `layers.updateOverlay`. When the
// layer is disabled, the editor shows a muted banner saying its changes are not applied.
//
// The editor never writes to disk, since this is a static client app. It edits the layer's
// overlay (see catalog.ts) and hands you the file contents to paste back.
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onScopeDispose,
  onUnmounted,
  provide,
  reactive,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import BaseModal from "./ui/BaseModal.vue";
import * as viewport from "../stores/viewport";
import * as confirm from "../stores/confirm";
import * as draftGuard from "../stores/draftGuard";
import ItemForm from "./game/ItemForm.vue";
import BonusForm from "./game/BonusForm.vue";
import FilterForm from "./game/FilterForm.vue";
import PresetForm from "./game/PresetForm.vue";
import SectionForm from "./game/SectionForm.vue";
import SlotForm from "./game/SlotForm.vue";
import LayerExportModal from "./game/LayerExportModal.vue";
/** Async so the window and the tooltip parser it pulls in stay out of the main chunk
 *  alongside the OCR engine it loads. It only ever renders behind a `v-if`.
 *
 *  The template shows a placeholder modal until the chunk arrives, since otherwise the
 *  button appears to do nothing at all. */
const tooltipImportLoaded = ref(false);
const TooltipImportModal = defineAsyncComponent(() =>
  import("./game/TooltipImportModal.vue").then((mod) => {
    tooltipImportLoaded.value = true;
    return mod;
  }),
);
import LayerValidationDrawer from "./game/LayerValidationDrawer.vue";
import LayerEntryList from "./game/LayerEntryList.vue";
import LayerSlotOutline from "./game/LayerSlotOutline.vue";
import LayerActionsMenu from "./game/LayerActionsMenu.vue";
import HistoryButtons from "./ui/HistoryButtons.vue";
import IconButton from "./ui/IconButton.vue";
import RailGutter from "./ui/RailGutter.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import TabStrip from "./ui/TabStrip.vue";
import { FORM_BAR_CONTEXT } from "../lib/form-bar-context";
import TabButton from "./ui/TabButton.vue";
import {
  Download,
  Redo2,
  RotateCcw,
  TriangleAlert,
  Undo2,
  Upload,
} from "@lucide/vue";
import * as catalog from "../data/catalog";
import { isRetired } from "../data/db";
import { showNotice } from "../stores/notice";
import { navigation } from "../lib/navigation";
import type { Route, RoutePatch } from "../lib/route-model";
import * as engine from "../stores/resolved";
import * as history from "../stores/history";
import * as layers from "../stores/layers";
import * as layerEditorUi from "../stores/layerEditorUi";
import * as rails from "../stores/rails";
import { matchesQuery } from "../lib/text-filter";
import {
  defaultItemListFilter,
  keepsItem,
  type ItemListFilter,
} from "../lib/item-list-filter";
import { editorDb } from "../lib/editor-db";
import { viewportKind } from "../lib/shell-layout";
import { layerEditorLayout, viewOf } from "../lib/layer-editor-layout";
import { useItemUndoRedo } from "../composables/useUndoRedo";
import { provideEditorDb } from "../composables/useEditorDb";
import type {
  CatalogGroup,
  CatalogOverlay,
  Db,
  Item,
  Bonus,
  BonusOption,
  FilterDef,
  SectionPreset,
  Slot,
  SlotSection,
  LintFinding,
  Layer,
} from "../types";
import type {
  EditorRow,
  ItemRow,
  BonusRow,
  FilterRow,
} from "./game/LayerEntryList.vue";
import type { OutlineKind, OutlineMove, OutlineRow } from "../lib/slot-outline";

const storedEntriesCollapsed = rails.collapsed("layerEntries");
const entriesWidth = rails.width("layerEntries");

// The two panes only sit side by side from `lg` up; below it they stack, and a pinned width
// would be a width on a full-bleed row. Matches the `lg:flex-row` on their container.
const sideBySide = viewport.isDesktop;

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

/** The editor's own catalog, see `editorDb`. */
const db = computed(() =>
  editorDb(engine.overlays.value, () => engine.db.value, overlay.value),
);

// Nested controls that offer catalog-derived choices read this editor's catalog, not the engine's.
provideEditorDb(db);

/** This layer's own remembered section/filter/selection -- see the store's own doc comment.
 *  A computed, not a plain const: the nav can switch `props.layer` directly from one layer
 *  to another without this component unmounting, and a stale binding would leak writes into
 *  the previous layer's stored state. */
const ui = computed(() => layerEditorUi.getState(props.layer.id));

/** The phone's master-detail half, which the route decides. */
const view = computed(() => viewOf(navigation.route.value));

const layout = computed(() =>
  layerEditorLayout(
    viewportKind(viewport.isDesktop.value, viewport.isPhone.value),
    view.value,
  ),
);

/** A phone's open form has the pane to itself: the layer header, tabs and banners belong to
 *  the list, and the form's own bar carries Back. */
const formOnly = computed(() => layout.value.form && layout.value.back);

provide(
  FORM_BAR_CONTEXT,
  computed(() =>
    formOnly.value
      ? {
          back: () => void backToList(),
          actions: [
            {
              key: "undo",
              label: "Undo",
              icon: Undo2,
              disabled: !canUndo.value,
              run: () => undo(),
            },
            {
              key: "redo",
              label: "Redo",
              icon: Redo2,
              disabled: !canRedo.value,
              run: () => redo(),
            },
          ],
        }
      : null,
  ),
);

/** The stored collapse applies only where the list is a rail; a phone's list always shows. */
const entriesCollapsed = computed(
  () => layout.value.entriesRail && storedEntriesCollapsed.value,
);

/** Only an open rail in a side-by-side layout gets a width of its own. */
const entriesStyle = computed(() =>
  sideBySide.value && !entriesCollapsed.value
    ? { width: `${entriesWidth.value}px` }
    : undefined,
);

/** The form bar's Back from a phone's form to its list. Leaving unmounts the form, so a dirty
 *  draft asks first. The list keeps its entry marked, but the route stops naming it, so a
 *  reload lands where the user was. */
async function backToList() {
  if (!(await draftGuard.confirmDiscard())) return;
  await navigation.retreat(routeParamsFor(activeGroup.value, null));
}

/** Writes this editor's route params. `transient` keeps a step like arrow-key browsing off
 *  history. */
function writeRoute(params: RoutePatch, { transient = false } = {}) {
  navigation.write(params, { transient });
}

const query = ref("");
const statusFilter = ref("all"); // all | changed | added | edited | removed
const itemFilter = ref<ItemListFilter>(defaultItemListFilter());

/** An overlay group, as the editor authors it: each has a form and a tab. */
type EditorGroup = CatalogGroup;

/** One entry per overlay group; adding a group is an entry here plus its form in the template.
 *  Several groups can share a `tab`. `labelIn` returns null for an id that no longer resolves. */
interface GroupDef {
  group: EditorGroup;
  tab: string;
  routerKey: "item" | "bonus" | "preset" | "slot" | "filter" | "sectionId";
  noun: string;
  existsIn(db: Db, id: string): boolean;
  labelIn(db: Db, id: string): string | null;
  /** The flat list's rows. Absent for the Slots tab's groups, which render as an outline. */
  rowsFrom?(db: Db, overlay: CatalogOverlay): EditorRow[];
  /** Clears this group's own duplicate seed before blanking the selection. */
  createNew(): void;
}
const GROUPS: Record<EditorGroup, GroupDef> = {
  items: {
    group: "items",
    tab: "items",
    routerKey: "item",
    noun: "item",
    existsIn: (db, id) => Boolean(db.get(id)),
    labelIn: (db, id) => db.get(id)?.name ?? null,
    rowsFrom: itemRowsFrom,
    createNew: () => newItem(),
  },
  bonuses: {
    group: "bonuses",
    tab: "bonuses",
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
  filters: {
    group: "filters",
    tab: "filters",
    routerKey: "filter",
    noun: "filter",
    existsIn: (db, id) => filterNames(db).includes(id),
    labelIn: (db, id) => (filterNames(db).includes(id) ? id : null),
    rowsFrom: filterRowsFrom,
    createNew: () => newFilter(),
  },
  sections: {
    group: "sections",
    tab: "slots",
    routerKey: "sectionId",
    noun: "section",
    existsIn: (db, id) => db.sections.some((section) => section.id === id),
    labelIn: (db, id) => {
      const section = db.sections.find((candidate) => candidate.id === id);
      return section ? section.label || section.id : null;
    },
    createNew: () => newSection(),
  },
  slots: {
    group: "slots",
    tab: "slots",
    routerKey: "slot",
    noun: "slot",
    existsIn: (db, id) => db.slotById.has(id),
    labelIn: (db, id) => {
      const slot = db.authoredSlots.find((candidate) => candidate.id === id);
      return slot ? slot.label || slot.id : null;
    },
    createNew: () => newSlot(),
  },
  sectionPresets: {
    group: "sectionPresets",
    tab: "slots",
    routerKey: "preset",
    noun: "preset",
    existsIn: (db, id) => db.presets.some((preset) => preset.id === id),
    labelIn: (db, id) => {
      const preset = db.presets.find((candidate) => candidate.id === id);
      return preset ? preset.label || preset.id : null;
    },
    createNew: () => newPreset(),
  },
};

/** The tabs across the top, in render order. The id is the `section` route param; the first
 *  tab is the default and leaves the param off the URL. */
interface TabDef {
  id: string;
  label: string;
  testid: string;
  countIn(db: Db, overlay: CatalogOverlay): number;
  /** Authors data whose shape may still change, so the tab shows a warning. */
  advanced?: boolean;
}
const TABS: TabDef[] = [
  {
    id: "items",
    label: "Items",
    testid: "tab-items",
    countIn: (db) => db.items.length,
  },
  {
    id: "bonuses",
    label: "Bonuses",
    testid: "tab-bonuses",
    countIn: (db) => db.bonuses.length,
  },
  {
    id: "filters",
    label: "Filters",
    testid: "tab-filters",
    countIn: (db, ovl) => filterRowsFrom(db, ovl).length,
    advanced: true,
  },
  {
    id: "slots",
    label: "Slots",
    testid: "tab-slots",
    // Every outline row, across all three of the tab's groups.
    countIn: (db) =>
      db.sections.length + db.authoredSlots.length + db.presets.length,
    advanced: true,
  },
];

const EDITOR_GROUPS = Object.keys(GROUPS) as EditorGroup[];

/** The groups a tab hosts, in `GROUPS` order. */
const groupsOfTab = (tab: string) =>
  EDITOR_GROUPS.filter((group) => GROUPS[group].tab === tab);

const tab = ref<string>(TABS[0].id);

const tabIsAdvanced = computed(
  () => TABS.find((entry) => entry.id === tab.value)?.advanced ?? false,
);

/** The Slots tab group last shown, used when nothing is selected. */
const slotsGroup = ref<EditorGroup>("slots");

/** The group whose rows and form the active tab is showing. */
const activeGroup = computed<EditorGroup>(() => {
  const groups = groupsOfTab(tab.value);
  if (groups.includes(slotsGroup.value)) return slotsGroup.value;
  return groups[0] ?? "items";
});

/** Maps the singular row/lint kind ("sectionPreset") to its plural overlay group name. */
const GROUP_OF_KIND: Record<LintFinding["kind"], EditorGroup> = {
  item: "items",
  bonus: "bonuses",
  filter: "filters",
  sectionPreset: "sectionPresets",
  slot: "slots",
  section: "sections",
};

/** This layer's current selection, one id per overlay group. */
const selectedBySection = reactive<Record<EditorGroup, string | null>>({
  items: null,
  bonuses: null,
  filters: null,
  sections: null,
  sectionPresets: null,
  slots: null,
});

/** The layer's own history, with an open form's draft steps in front of it. The buttons act on
 *  it whatever has focus; only the keyboard follows the undo scope. */
const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } =
  useItemUndoRedo();

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
const duplicateSlotSeed = ref<Slot | null>(null);
/** The section the outline's "New" menu named, read once by the blank draft it opens. */
const newEntrySection = ref("");

const form = ref<InstanceType<typeof ItemForm> | null>(null);
const bonusForm = ref<InstanceType<typeof BonusForm> | null>(null);
const filterForm = ref<InstanceType<typeof FilterForm> | null>(null);
const presetForm = ref<InstanceType<typeof PresetForm> | null>(null);
const sectionForm = ref<InstanceType<typeof SectionForm> | null>(null);
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

/** Every category the editor knows: the declared ones plus every one in use. */
function filterNames(catalogDb: Db): string[] {
  return [
    ...new Set<string>([
      ...catalogDb.filters.map((filter) => filter.id),
      ...catalog.usedFilters(catalogDb.items, catalogDb.authoredSlots),
    ]),
  ].sort();
}

/** One row per category. An undeclared one is a `base` row; a tombstoned declaration shows as
 *  removed even while items still use the category. */
function filterRowsFrom(catalogDb: Db, ovl: CatalogOverlay): FilterRow[] {
  const counts = new Map<string, number>();
  for (const item of catalogDb.items) {
    if (item.filter)
      counts.set(item.filter, (counts.get(item.filter) ?? 0) + 1);
  }
  const declared = new Map(
    catalogDb.filters.map((filter) => [filter.id, filter]),
  );
  const tombstones = catalog.tombstoneIds(ovl, "filters");
  const removed = new Set(tombstones);
  return editorRows<string, FilterRow>(
    filterNames(catalogDb).filter((name) => !removed.has(name)),
    (name) => ({
      key: name,
      name,
      filter: `${counts.get(name) ?? 0} item(s)`,
      def: declared.get(name) ?? null,
      status: catalog.statusOf(ovl, "filters", name),
      kind: "filter",
    }),
    tombstones,
    (id) => ({
      key: id,
      name: id,
      // Not rendered for removed rows, but search still reads it.
      filter: "-",
      def: null,
      status: "removed",
      kind: "filter",
    }),
  );
}

const rows = computed<EditorRow[]>(
  () => GROUPS[activeGroup.value].rowsFrom?.(db.value, overlay.value) ?? [],
);

/** The tab strip, with counts that stay current while another tab is showing. */
const tabs = computed(() =>
  TABS.map((entry) => ({
    ...entry,
    count: entry.countIn(db.value, overlay.value),
  })),
);

const filtered = computed(() => {
  return rows.value.filter((row) => {
    if (statusFilter.value === "changed" && row.status === "base") return false;
    if (
      ["added", "edited", "removed"].includes(statusFilter.value) &&
      row.status !== statusFilter.value
    )
      return false;
    if (
      row.kind === "item" &&
      !keepsItem(
        itemFilter.value,
        row.item,
        row.item ? isRetired(db.value, row.item.id) : false,
      )
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

const selectedSlot = computed<Slot | null>(
  () =>
    db.value.authoredSlots.find(
      (candidate) => candidate.id === selectedBySection.slots,
    ) ?? null,
);

const selectedSection = computed<SlotSection | null>(
  () =>
    db.value.sections.find(
      (candidate) => candidate.id === selectedBySection.sections,
    ) ?? null,
);

/** What the outline shows as open. Only one Slots tab group is selected at a time. */
const outlineSelection = computed<{ kind: OutlineKind; key: string } | null>(
  () => {
    for (const [kind, group] of [
      ["section", "sections"],
      ["slot", "slots"],
      ["sectionPreset", "sectionPresets"],
    ] as [OutlineKind, EditorGroup][]) {
      const key = selectedBySection[group];
      if (key) return { kind, key };
    }
    return null;
  },
);

/** The declaration behind the selected category, or null if it has none yet. */
const selectedFilter = computed(
  () =>
    db.value.filters.find(
      (filter) => filter.id === selectedBySection.filters,
    ) ?? null,
);
const selectedFilterId = computed(() => selectedBySection.filters);

/** The status badge for whichever entity is currently selected. One computed rather than
 *  one per group: `EntryStatus` doesn't vary by entity type, and only one form is ever
 *  showing. */
const selectedStatus = computed(() => {
  const id = selectedBySection[activeGroup.value];
  return id == null
    ? "base"
    : catalog.statusOf(overlay.value, activeGroup.value, id);
});

/** The item form's category choices, the same list the Filters tab shows. */
const filters = computed<string[]>(() => filterNames(db.value));

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

const changedCount = computed(() => catalog.changedCount(overlay.value));

/** Entry count badge: non-tombstone entries in the overlay. */
const entryCount = computed(() => catalog.entryCount(overlay.value));

/** Whether each group's open form has unsaved edits. ItemForm exposes no `dirty`. */
const draftDirty: Partial<Record<EditorGroup, () => boolean>> = {
  bonuses: () => bonusForm.value?.dirty ?? false,
  filters: () => filterForm.value?.dirty ?? false,
  sections: () => sectionForm.value?.dirty ?? false,
  sectionPresets: () => presetForm.value?.dirty ?? false,
  slots: () => slotForm.value?.dirty ?? false,
};

const hasUnsavedDraft = (row: EditorRow | OutlineRow) => {
  const group = GROUP_OF_KIND[row.kind];
  if (row.key !== selectedBySection[group]) return false;
  return draftDirty[group]?.() ?? false;
};

/** Per group, every id a new entry must not collide with: every layer's overlay, enabled or
 *  not, plus the composed db. Groups are separate id spaces, so an item and its bonus can
 *  share an id. */
const allocatableIds = computed(() => {
  const { items, bonuses, presets, slots, sections, filters } = engine.db.value;
  const composed: Record<EditorGroup, { id: string }[]> = {
    items,
    bonuses,
    sectionPresets: presets,
    slots,
    sections,
    filters,
  };
  return Object.fromEntries(
    catalog.GROUPS.map((group) => [
      group,
      [
        ...new Set([
          ...layers.allocatableIds(group),
          ...composed[group].map((entry) => entry.id),
        ]),
      ],
    ]),
  ) as Record<EditorGroup, string[]>;
});

const findings = computed(() =>
  catalog.validate(
    db.value.items,
    db.value.bonuses,
    undefined,
    db.value.presets,
    db.value.authoredSlots,
    db.value.sections,
    db.value.filters,
    overlay.value.sectionOrder,
  ),
);

const errorCount = computed(
  () => findings.value.filter((f) => f.level === "error").length,
);
const warnCount = computed(
  () => findings.value.filter((f) => f.level === "warn").length,
);

// --- routing --------------------------------------------------------------------------
// This component owns the `item`/`bonus`/`filter`/`preset`/`slot`/`sectionId`/`section`/
// `status`/`q` params; `section` is the tab, `sectionId` a selected layout section.
// `select`'s `push` flag keeps arrow-key browsing out of the back/forward history.

/** The router params that select `id` in `group` and clear every other group's key. */
function routeParamsFor(group: EditorGroup, id: string | null): RoutePatch {
  const params: RoutePatch = { new: null };
  for (const other of EDITOR_GROUPS) params[GROUPS[other].routerKey] = null;
  params[GROUPS[group].routerKey] = id;
  return params;
}

/** Only this group's own key, for saves and deletes that stay on the same tab. */
function routeParamFor(group: EditorGroup, id: string | null): RoutePatch {
  return { [GROUPS[group].routerKey]: id, new: null };
}

/** The params of `group`'s new draft. */
const newDraftParams = (group: EditorGroup): RoutePatch => ({
  ...routeParamsFor(group, null),
  new: group,
});

/** Whether `source.status` names one of `statusFilterOptions`' own values. */
function isValidStatusFilter(value: unknown) {
  return statusFilterOptions.some((option) => option.value === value);
}

/** The tab/selection fields `restoreSelection` reads. Not `Record<string, string>`: only
 *  a type without an index signature of its own accepts both a parsed route and
 *  `LayerEditorUiState` without a cast. */
interface SelectionSource {
  section?: string;
  item?: string;
  bonus?: string;
  preset?: string;
  slot?: string;
  sectionId?: string;
  filter?: string;
  /** The group whose new draft is open. In the URL only. */
  new?: string;
  /** Stored per layer, never in the URL: the Slots tab group last shown. */
  slotsGroup?: string;
}

/** Applies a parsed route or the stored `ui` state to `tab`/`selectedBySection`. An unknown tab
 *  falls back to the first one, and an id that no longer resolves is dropped. */
function restoreSelection(source: SelectionSource) {
  const target = TABS.find((entry) => entry.id === source.section) ?? TABS[0];
  tab.value = target.id;
  const groups = groupsOfTab(target.id);
  const fresh = groups.find((group) => group === source.new);
  for (const group of groups) {
    const id = source[GROUPS[group].routerKey];
    selectedBySection[group] =
      !fresh && id && GROUPS[group].existsIn(db.value, id) ? id : null;
  }
  // A new draft, else the selected group, decides which form opens; otherwise the tab's last
  // shown group.
  const chosen =
    fresh ??
    groups.find((group) => selectedBySection[group]) ??
    groups.find((group) => group === source.slotsGroup);
  if (chosen) slotsGroup.value = chosen;
}

/** Clears every duplicate seed: one belongs only to the draft it was set up for. */
function dropSeeds() {
  duplicateItemSeed.value = null;
  duplicateBonusSeed.value = null;
  duplicatePresetSeed.value = null;
  duplicateSlotSeed.value = null;
}

/** Applies a route to this layer's tab, selection and list filters. */
function applyRoute(route: Route) {
  restoreSelection(route);
  // A fresh blank form, never a draft left from before.
  if (route.new) newItemCounter.value++;
  statusFilter.value =
    route.status && isValidStatusFilter(route.status) ? route.status : "all";
  query.value = route.q ?? "";
}

/** Names what this editor shows in the URL without a history step, after a remount or a layer
 *  switch restored it from memory. A phone names the entry only if its form was showing. */
function syncRoute(formShowing: boolean) {
  const group = activeGroup.value;
  writeRoute(
    {
      section: tabParam(tab.value),
      ...routeParamsFor(
        group,
        formShowing || !layout.value.back ? selectedBySection[group] : null,
      ),
      status: statusFilter.value === "all" ? null : statusFilter.value,
      q: query.value || null,
    },
    { transient: true },
  );
}

/** A traversal to another layer, for the layer watcher below to restore from. */
let arrivingRoute: Route | null = null;

// Back or Forward within this layer applies here. One that switches layers lands through the
// layer watcher, and a fresh mount reads the route in `onMounted`.
onScopeDispose(
  navigation.onTraverse((route) => {
    dropSeeds();
    if (route.layer !== props.layer.id) {
      arrivingRoute = route;
      return;
    }
    applyRoute(route);
  }),
);

/** The `section` param for a tab: the default tab leaves it off the URL entirely. */
const tabParam = (target: string) => (target === TABS[0].id ? null : target);

async function switchTab(target: string) {
  if (tab.value === target) return;
  if (!(await draftGuard.confirmDiscard())) return;
  tab.value = target;
  // A phone lands on the new tab's list, the way into any of its entries.
  const group = groupsOfTab(target)[0];
  writeRoute({
    section: tabParam(target),
    ...routeParamsFor(
      group,
      layout.value.back ? null : selectedBySection[group],
    ),
  });
}

async function select(
  row: EditorRow | OutlineRow,
  { transient = false }: { transient?: boolean } = {},
) {
  if (row.status === "removed") return;
  const group = GROUP_OF_KIND[row.kind];
  if (activeGroup.value === group && selectedBySection[group] === row.key) {
    // A phone's marked row reopens its form, and the route names the entry again.
    if (view.value === "list")
      writeRoute(routeParamsFor(group, row.key), { transient });
    return;
  }
  if (!(await draftGuard.confirmDiscard())) return;
  // Clear the sibling groups too, or their forms would stay selected behind the new one.
  for (const sibling of groupsOfTab(GROUPS[group].tab))
    selectedBySection[sibling] = null;
  selectedBySection[group] = row.key;
  slotsGroup.value = group;
  writeRoute(routeParamsFor(group, row.key), { transient });
}

const selectedKey = computed(() => selectedBySection[activeGroup.value]);

/** Blanks `group`'s selection so its form mounts as an empty draft. The counter is what
 *  forces that remount even when the selection was already null. */
async function newEntry(group: EditorGroup) {
  if (!(await draftGuard.confirmDiscard())) return;
  for (const sibling of groupsOfTab(GROUPS[group].tab))
    selectedBySection[sibling] = null;
  slotsGroup.value = group;
  newItemCounter.value++;
  writeRoute(newDraftParams(group));
}

function newItem() {
  duplicateItemSeed.value = null;
  newEntry("items");
}

function newBonus() {
  duplicateBonusSeed.value = null;
  newEntry("bonuses");
}

function newFilter() {
  newEntry("filters");
}

/** The entry list's "create" click, dispatched to the active group's `createNew`. */
function createEntry() {
  GROUPS[activeGroup.value].createNew();
}

/** Opens a new item draft pre-filled from the currently selected item -- an explicit Save
 *  is still required, and that Save is what mints the copy's id (from whatever name ends
 *  up in the draft, so retyping the name before saving is what changes it). */
async function duplicateItem() {
  const item = selected.value;
  if (!item) return;
  if (!(await draftGuard.confirmDiscard())) return;
  duplicateItemSeed.value = item;
  selectedBySection.items = null;
  newItemCounter.value++;
  writeRoute(newDraftParams("items"));
  showNotice(`Duplicating "${item.name}". Edit and save to create a copy.`);
}

/** Opens a new item draft seeded from a pasted tooltip. Like "Duplicate", the seed is only
 *  a draft -- an explicit Save is what mints the item, so every parsed value stays editable
 *  and anything the parser could not read is simply an empty field. */
async function createFromTooltip(draft: Partial<Item>) {
  if (!(await draftGuard.confirmDiscard())) return;
  tab.value = "items";
  selectedBySection.items = null;
  duplicateItemSeed.value = { id: "", name: "", ...draft } as Item;
  newItemCounter.value++;
  writeRoute(newDraftParams("items"));
  showTooltipImport.value = false;
  showNotice(
    `Filled ${Object.keys(draft).length} field(s) from the tooltip. Review and save to create the item.`,
  );
}

/** How the tooltip window should name the item its "apply" buttons write into, or null when
 *  no item form is on screen to receive them. A new unsaved draft counts: applying is how a
 *  draft started from one screenshot picks up a value read off the next. */
const applyTarget = computed(() => {
  if (activeGroup.value !== "items") return null;
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

async function duplicateBonus() {
  const bonus = selectedBonus.value;
  if (!bonus) return;
  if (!(await draftGuard.confirmDiscard())) return;
  duplicateBonusSeed.value = bonus;
  selectedBySection.bonuses = null;
  newItemCounter.value++;
  writeRoute(newDraftParams("bonuses"));
  showNotice(
    `Duplicating "${bonus.name || bonus.id}". Edit and save to create a copy.`,
  );
}

function newPreset() {
  duplicatePresetSeed.value = null;
  newEntry("sectionPresets");
}

function newSection() {
  newEntry("sections");
}

function newSlot() {
  duplicateSlotSeed.value = null;
  newEntry("slots");
}

/** Opens a new slot draft pre-filled from the selected one. Save mints the copy's id. */
async function duplicateSlot() {
  const slot = selectedSlot.value;
  if (!slot) return;
  if (!(await draftGuard.confirmDiscard())) return;
  duplicateSlotSeed.value = slot;
  selectedBySection.slots = null;
  slotsGroup.value = "slots";
  newItemCounter.value++;
  writeRoute(newDraftParams("slots"));
  showNotice(
    `Duplicating "${slot.label || slot.id}". Edit and save to create a copy.`,
  );
}

// --- overlay writes ---------------------------------------------------------------------
// Save/live-edit/delete/revert, shared by every group in GROUPS.

/** Writes `entity` into `group` and selects it. `label` comes from the entity rather than
 *  `labelIn`, since a brand-new entry is not in `db` until this write lands. */
function saveEntry(
  group: EditorGroup,
  id: string,
  entity: catalog.CatalogEntry,
  label: string,
) {
  const { noun } = GROUPS[group];
  commit(
    `save-${group}:${id}`,
    `Save ${noun} "${label}"`,
    catalog.upsert(overlay.value, group, id, entity),
  );
  selectedBySection[group] = id;
  // A saved draft is now the entry: the same place, named.
  writeRoute(routeParamFor(group, id), { transient: true });
  showNotice(`Saved ${noun} "${label}"`);
}

/** Live-edit handler: debounced changes from an existing entry go here. `label` is the
 *  form's own "what changed" text, which becomes the undo step's label. */
function updateEntry(
  group: EditorGroup,
  id: string,
  entity: catalog.CatalogEntry,
  label: string,
) {
  commit(
    `edit-${group}:${id}`,
    label,
    catalog.upsert(overlay.value, group, id, entity),
  );
}

/** Leaves a deleted entry's form for the list, the way Back would: its place is gone. */
function leaveDeleted(group: EditorGroup) {
  void navigation.retreat(routeParamFor(group, null));
}

function deleteEntry(group: EditorGroup) {
  const { noun, labelIn } = GROUPS[group];
  const id = selectedBySection[group]!;
  const label = labelIn(db.value, id) ?? id;
  commit(
    `delete-${group}:${id}`,
    `Delete ${noun} "${label}"`,
    catalog.remove(overlay.value, group, id),
  );
  selectedBySection[group] = null;
  leaveDeleted(group);
  showNotice(`Removed ${noun} "${label}"`);
}

function revertEntry(group: EditorGroup) {
  const { noun, labelIn } = GROUPS[group];
  const id = selectedBySection[group]!;
  const label = labelIn(db.value, id) ?? id;
  commit(
    `revert-${group}:${id}`,
    `Revert ${noun} "${label}"`,
    catalog.revert(overlay.value, group, id),
  );
  showNotice(`Reverted ${noun} "${label}" to the shipped version`);
}

function restore(row: EditorRow | OutlineRow) {
  const group = GROUP_OF_KIND[row.kind];
  const { noun } = GROUPS[group];
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
    note: confirm.undoNote(),
  });
  if (!ok) return;
  commit(null, "Discard all changes", catalog.emptyOverlay());
  for (const group of EDITOR_GROUPS) selectedBySection[group] = null;
  void navigation.retreat(routeParamsFor(activeGroup.value, null));
  showNotice("Discarded every change. The layer is back to the shipped data.");
}

/** Shows `id` in `group`, switching tab if needed. */
async function jumpTo(group: EditorGroup, id: string) {
  if (!(await draftGuard.confirmDiscard())) return;
  const target = GROUPS[group].tab;
  tab.value = target;
  for (const sibling of groupsOfTab(target)) selectedBySection[sibling] = null;
  selectedBySection[group] = id;
  slotsGroup.value = group;
  writeRoute({
    section: tabParam(target),
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

/** The item form's "edit filter" link: open that category's metadata. */
const openFilter = (filter: string) => jumpTo("filters", filter);

// Per-group wrappers typing each form's payload.
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

async function onDeleteBonusTop(event?: MouseEvent) {
  const bonus = selectedBonus.value;
  if (!bonus) return;
  const label = bonus.name || bonus.id;
  const members = db.value.bonusMembers.get(bonus.id) ?? [];
  const { ok, checked } = await confirm.askUnless(event?.shiftKey ?? false, {
    title: "Delete bonus",
    message: `Delete bonus “${label}”?`,
    confirmLabel: "Delete",
    danger: true,
    note: confirm.undoNote(),
    checkbox: members.length
      ? {
          label: `Also unlink from ${members.length} item${members.length === 1 ? "" : "s"}`,
          checked: true,
        }
      : undefined,
  });
  if (!ok) return;
  let next = overlay.value;
  if (checked) next = catalog.unlinkBonus(next, db.value.items, bonus.id);
  commit(
    `delete-bonuses:${bonus.id}`,
    `Delete bonus "${label}"`,
    catalog.remove(next, "bonuses", bonus.id),
  );
  selectedBySection.bonuses = null;
  leaveDeleted("bonuses");
  showNotice(`Removed bonus "${label}"`);
}
const onRevertBonusTop = () => revertEntry("bonuses");

const onSaveFilter = ({ filter }: { filter: FilterDef }) =>
  saveEntry("filters", filter.id, filter, filter.id);
const onUpdateFilter = ({
  filter,
  label,
}: {
  filter: FilterDef;
  label: string;
}) => updateEntry("filters", filter.id, filter, label);
const onDeleteFilter = () => deleteEntry("filters");
const onRevertFilter = () => revertEntry("filters");

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

const onSaveSlot = ({ slot }: { slot: Slot }) =>
  saveEntry("slots", slot.id, slot, slot.label || slot.id);
const onUpdateSlot = ({ slot, label }: { slot: Slot; label: string }) =>
  updateEntry("slots", slot.id, slot, label);
const onDeleteSlot = () => deleteEntry("slots");
const onRevertSlot = () => revertEntry("slots");

const onSaveSection = ({ section }: { section: SlotSection }) =>
  saveEntry("sections", section.id, section, section.label || section.id);
const onUpdateSection = ({
  section,
  label,
}: {
  section: SlotSection;
  label: string;
}) => updateEntry("sections", section.id, section, label);
const onRevertSection = () => revertEntry("sections");

/** Deleting a section offers to delete its slots and presets too. Declining leaves them
 *  orphaned, which lint reports. */
async function onDeleteSection(event?: MouseEvent) {
  const section = selectedSection.value;
  if (!section) return;
  const label = section.label || section.id;
  const members = [
    ...db.value.authoredSlots.filter((slot) => slot.section === section.id),
    ...db.value.presets.filter((preset) => preset.section === section.id),
  ];
  const { ok, checked } = await confirm.askUnless(event?.shiftKey ?? false, {
    title: "Delete section",
    message: `Delete section “${label}”?`,
    confirmLabel: "Delete",
    danger: true,
    note: confirm.undoNote(),
    checkbox: members.length
      ? {
          label: `Also delete its slots and presets (${members.length})`,
          checked: true,
        }
      : undefined,
  });
  if (!ok) return;
  let next = overlay.value;
  if (checked)
    next = catalog.removeSectionMembers(
      next,
      db.value.authoredSlots,
      db.value.presets,
      section.id,
    );
  commit(
    `delete-sections:${section.id}`,
    `Delete section "${label}"`,
    catalog.remove(next, "sections", section.id),
  );
  selectedBySection.sections = null;
  leaveDeleted("sections");
  showNotice(`Removed section "${label}"`);
}

// --- the Slots tab's outline --------------------------------------------------------------
// Selection and restore share the flat list's handlers; creating and reordering are specific
// to the outline.

/** The outline's "New" menu: opens the group's blank draft. The chosen section is stored
 *  separately, since clearing the selection loses it. */
function createInOutline({
  kind,
  sectionId,
}: {
  kind: OutlineKind;
  sectionId: string;
}) {
  newEntrySection.value = sectionId;
  if (kind === "section") newSection();
  else if (kind === "slot") newSlot();
  else newPreset();
}

/** A reorder from the outline, written straight to the overlay as one undo step. A no-op move
 *  leaves the overlay unchanged and adds no step. */
function moveInOutline(move: OutlineMove) {
  const layout = { sections: db.value.sections, slots: db.value.authoredSlots };
  const [label, next] =
    move.kind === "section"
      ? [
          `Move section "${GROUPS.sections.labelIn(db.value, move.key) ?? move.key}"`,
          catalog.moveSection(overlay.value, layout, move.key, move.index),
        ]
      : [
          `Move slot "${db.value.slotById.get(move.key)?.label || move.key}"`,
          catalog.moveSlot(
            overlay.value,
            layout,
            move.key,
            move.sectionId,
            move.index,
          ),
        ];
  if (next === overlay.value) return;
  commit(null, label, next);
}

// --- bonuses nested in the item form ------------------------------------------------------
// ItemForm's bonus sub-editor writes the same overlay group as the Bonuses tab, but must
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
  const label = GROUPS.bonuses.labelIn(db.value, id) ?? id;
  commit(
    `delete-bonuses:${id}`,
    `Delete bonus "${label}"`,
    catalog.remove(overlay.value, "bonuses", id),
  );
  showNotice(`Removed bonus "${label}"`);
}

const overlayFileInput = useTemplateRef("overlayFileInput");

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
  writeRoute({ status: value === "all" ? null : value });
});
watch(query, (value) => {
  writeRoute({ q: value || null });
});

// Mirror every field this component owns into the per-layer store, so a later remount (a
// round trip through the build editor) has something to restore from once the URL itself
// has been cleared by `onUnmounted` below. `selectedBySection` is a reactive object, not a
// ref, so it deep-watches by default even inside this array of sources.
watch(
  [tab, slotsGroup, selectedBySection, statusFilter, query, itemFilter],
  ([activeTab, group, sel, status, q, items]) => {
    ui.value.section = activeTab;
    ui.value.slotsGroup = group;
    ui.value.item = sel.items ?? "";
    ui.value.bonus = sel.bonuses ?? "";
    ui.value.filter = sel.filters ?? "";
    ui.value.preset = sel.sectionPresets ?? "";
    ui.value.slot = sel.slots ?? "";
    ui.value.sectionId = sel.sections ?? "";
    ui.value.status = status === "all" ? "" : status;
    ui.value.q = q;
    ui.value.itemFilter = items;
  },
);

/** Whether the URL itself carries any of this component's own params: true for a deep link or
 *  a back/forward navigation, false for a plain remount after switching editors (those params
 *  were wiped on the way out). Only in the true case should the URL outrank the per-layer
 *  store below. */
function hasRoutedLayerState(routed: Route) {
  return Boolean(
    routed.item ||
    routed.bonus ||
    routed.filter ||
    routed.preset ||
    routed.slot ||
    routed.sectionId ||
    routed.new ||
    routed.section ||
    routed.status ||
    routed.q,
  );
}

/** Restores this layer from the route when it names something here, else from the per-layer
 *  store, and has the URL name what shows. */
function restoreLayer(routed: Route) {
  if (hasRoutedLayerState(routed)) {
    applyRoute(routed);
    syncRoute(viewOf(routed) === "detail");
  } else {
    const showing = ui.value.view === "detail";
    restoreSelection(ui.value);
    statusFilter.value = isValidStatusFilter(ui.value.status)
      ? ui.value.status
      : "all";
    query.value = ui.value.q;
    syncRoute(showing);
  }
  itemFilter.value = ui.value.itemFilter;
}

onMounted(() => {
  // Restore what this layer had open, unless a seed outranks it. When the layer changes, keep
  // the `item` param if the new layer's composed catalog still has that id, otherwise drop it.
  if (newPresetSeed) {
    // BuildSection's "Create new from current": the pre-filled draft *is* the point of the
    // jump, so it outranks whatever this layer had open, the same as `newItemSeed`.
    tab.value = "slots";
    slotsGroup.value = "sectionPresets";
    selectedBySection.sectionPresets = null;
    ui.value.section = "slots";
    ui.value.slotsGroup = "sectionPresets";
    ui.value.preset = "";
    writeRoute(
      { section: "slots", ...newDraftParams("sectionPresets") },
      { transient: true },
    );
    showNotice("New preset from the current build. Name it and save.");
  } else if (newItemSeed) {
    showNewItemSeed(newItemSeed);
  } else {
    restoreLayer(navigation.route.value);
  }
  itemFilter.value = ui.value.itemFilter;
});

// The per-layer store remembers which half a phone showed, for a later remount.
watch(view, (next) => (ui.value.view = next));

// A nav pick can switch `props.layer` without remounting this component. Reset the local
// selection to the new layer's own state (and force a fresh blank form), so the previous
// layer's open draft does not linger into the new one. A traversal brings the route it
// landed on.
watch(
  () => props.layer.id,
  () => {
    dropSeeds();
    newItemCounter.value++;
    const routed = arrivingRoute;
    arrivingRoute = null;
    restoreLayer(routed ?? {});
  },
);

/** A seeded new-item draft: the blank draft *is* the point of the jump, so restoring whatever
 *  this layer had open before would throw it away. The per-layer memory is rewritten to match,
 *  since that is what a later remount restores from. */
function showNewItemSeed(seed: Item) {
  tab.value = "items";
  ui.value.section = "items";
  ui.value.item = "";
  writeRoute(
    { section: tabParam("items"), ...newDraftParams("items") },
    { transient: true },
  );
  const narrowedTo = [seed.filter, ...(seed.tags ?? [])]
    .filter(Boolean)
    .join(", ");
  showNotice(`New item, pre-filled for "${narrowedTo}"`);
}

// A seed sent while this editor is already showing. Registered after the layer watcher so a
// seed that arrives with a layer switch lands on the new layer's reset state. The sender has
// already confirmed any discard, through the selection change.
watch(layerEditorUi.newItemSeed, () => {
  const seed = layerEditorUi.takeNewItemSeed();
  if (!seed) return;
  for (const sibling of groupsOfTab(GROUPS.items.tab))
    selectedBySection[sibling] = null;
  slotsGroup.value = "items";
  duplicateItemSeed.value = seed;
  newItemCounter.value++;
  showNewItemSeed(seed);
});

onUnmounted(() => {
  writeRoute(
    {
      item: null,
      bonus: null,
      filter: null,
      preset: null,
      slot: null,
      sectionId: null,
      new: null,
      section: null,
      status: null,
      q: null,
    },
    { transient: true },
  );
});
</script>

<template>
  <div
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    :class="formOnly ? 'p-1.5' : 'p-3'"
    data-undo-scope="editor"
  >
    <!-- Layer header strip -->
    <div
      v-if="!formOnly"
      class="mb-2 flex flex-none flow-wrap items-center gap-1.5"
    >
      <!-- With the actions in a menu, this row keeps the menu at its end and the tabs wrap
           below it. -->
      <div
        class="flex min-w-0 items-center gap-1.5"
        :class="layout.actions === 'menu' && 'w-full'"
      >
        <BaseCheckbox
          data-testid="layer-enabled"
          :model-value="props.layer.enabled"
          @update:model-value="
            (v) =>
              typeof v === 'boolean' &&
              layers.setLayerEnabled(props.layer.id, v)
          "
        />
        <strong class="min-w-0 truncate">{{ props.layer.name }}</strong>
        <span class="flex-none text-muted tabular-nums"
          >{{ entryCount }} entr{{ entryCount === 1 ? "y" : "ies" }}</span
        >
        <template v-if="layout.actions === 'menu'">
          <span class="flex-1"></span>
          <LayerActionsMenu
            :can-undo="canUndo"
            :can-redo="canRedo"
            :undo-label="undoLabel"
            :redo-label="redoLabel"
            :can-discard="Boolean(changedCount)"
            @undo="undo()"
            @redo="redo()"
            @export="showExport = true"
            @import="importOverlay"
            @discard="resetAll"
          />
        </template>
      </div>

      <span
        v-if="layout.actions === 'bar'"
        class="mx-1 h-4 w-px bg-line"
      ></span>

      <TabStrip>
        <TabButton
          v-for="entry in tabs"
          :key="entry.id"
          :active="tab === entry.id"
          :data-testid="entry.testid"
          @click="switchTab(entry.id)"
        >
          {{ entry.label }}
          <!-- Left out on a phone, so the four tabs fit one row. -->
          <span class="opacity-75 tabular-nums max-md:hidden">{{
            entry.count
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

      <span
        v-if="layout.actions === 'bar'"
        class="inline-flex flow-wrap gap-1.5 items-center text-lg"
      >
        <HistoryButtons
          testid="editor"
          :can-undo="canUndo"
          :can-redo="canRedo"
          :undo-label="undoLabel"
          :redo-label="redoLabel"
          @undo="undo()"
          @redo="redo()"
        />

        <span class="mx-1 h-4 w-px bg-line"></span>

        <IconButton
          title="Export…"
          data-testid="layer-export-toggle"
          @click="showExport = !showExport"
          ><Download
        /></IconButton>
        <IconButton
          title="Import"
          data-testid="layer-import"
          @click="overlayFileInput?.click()"
          ><Upload
        /></IconButton>
        <input
          ref="overlayFileInput"
          type="file"
          accept=".json"
          hidden
          @change="importOverlay"
        />

        <span class="mx-1 h-4 w-px bg-line"></span>

        <IconButton
          title="Discard changes"
          :disabled="!changedCount"
          @click="resetAll"
          ><RotateCcw
        /></IconButton>
      </span>
    </div>

    <!-- Disabled layer banner -->
    <div
      v-if="!props.layer.enabled && !formOnly"
      class="mb-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-warn"
    >
      This layer is disabled; its changes are not currently applied to the
      build. Enable it to see its effects.
    </div>

    <p
      v-if="tabIsAdvanced && !formOnly"
      class="mb-2 flex items-center gap-1.5 text-warn"
      data-testid="advanced-tab-warning"
    >
      <TriangleAlert class="size-4 flex-none" />
      Editing these is an advanced feature and may break in future app versions.
    </p>

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
    <BaseModal
      v-if="showTooltipImport && !tooltipImportLoaded"
      title="Read an item from a tooltip"
      panel-class="w-[760px] max-w-[92vw]"
      @close="showTooltipImport = false"
    >
      <p class="p-4 text-muted">Loading…</p>
    </BaseModal>

    <LayerValidationDrawer
      v-if="findings.length && !formOnly"
      :findings="findings"
      @select="selectFinding"
    />

    <div class="flex min-h-0 flex-1 flex-col items-stretch gap-3 lg:flex-row">
      <!-- Narrowed or collapsed, the list hands its width to the form beside it -- the same
           trade the build editor's rails offer. The gutter holds the toggle either way. A
           phone's list has the pane to itself, so it fills it and scrolls inside. Stacked on
           a tablet, the list is capped so the form below keeps most of the height, and the
           margin keeps a touch-sized toggle from poking past the page's edge. -->
      <div
        v-if="layout.list"
        class="flex min-h-0 items-stretch md:max-lg:mr-2 md:max-lg:max-h-[40%] [view-transition-name:rail-entries]"
        :class="[
          layout.form ? 'flex-none' : 'flex-1',
          entriesCollapsed && 'rounded-md border border-line bg-surface',
        ]"
        :style="entriesStyle"
        :data-testid="
          entriesCollapsed ? 'layer-entries-collapsed' : 'layer-entries-column'
        "
      >
        <LayerSlotOutline
          v-if="!entriesCollapsed && tab === 'slots'"
          v-model:query="query"
          v-model:status-filter="statusFilter"
          class="min-w-0 flex-1"
          :db="db"
          :overlay="overlay"
          :selected="outlineSelection"
          :status-filter-options="statusFilterOptions"
          :has-unsaved-draft="hasUnsavedDraft"
          @select="select"
          @create="createInOutline"
          @restore="restore"
          @move="moveInOutline"
        />
        <LayerEntryList
          v-else-if="!entriesCollapsed"
          v-model:query="query"
          v-model:status-filter="statusFilter"
          v-model:item-filter="itemFilter"
          class="min-w-0 flex-1"
          :rows="filtered"
          :categories="filters"
          :section="activeGroup"
          :selected-key="selectedKey"
          :status-filter-options="statusFilterOptions"
          :has-unsaved-draft="hasUnsavedDraft"
          @select="select"
          @create="createEntry"
          @restore="restore"
        />
        <RailGutter
          v-if="layout.entriesRail"
          rail="layerEntries"
          side="left"
          label="the entry list"
          :collapsed="entriesCollapsed"
          :resizable="sideBySide"
        />
      </div>

      <div
        v-if="layout.form"
        class="min-w-0 flex-1 overflow-y-auto rounded-md border border-line bg-surface px-3 pb-3"
        data-testid="layer-form-pane"
      >
        <ItemForm
          v-if="activeGroup === 'items'"
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
          :allocatable-ids="allocatableIds.items"
          :allocatable-bonus-ids="allocatableIds.bonuses"
          @save="onSave"
          @update:item="onUpdateItem"
          @delete="onDelete"
          @duplicate="duplicateItem"
          @revert="onRevert"
          @save-bonus="onSaveBonus"
          @delete-bonus="onDeleteBonus"
          @update-bonus="onUpdateBonus"
          @open-item="openItem"
          @open-filter="openFilter"
          @tooltip-import="showTooltipImport = !showTooltipImport"
        />
        <BonusForm
          v-else-if="activeGroup === 'bonuses'"
          ref="bonusForm"
          :key="`bonus:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedBonus"
          :duplicate-from="duplicateBonusSeed"
          :status="selectedStatus"
          :db="db"
          :all-bonus-ids="allBonusIds"
          :tags="tagList"
          :bonus-options="bonusOptions"
          :allocatable-ids="allocatableIds.bonuses"
          @save="onSaveBonusTop"
          @update:bonus="onUpdateBonusTop"
          @delete="onDeleteBonusTop"
          @duplicate="duplicateBonus"
          @revert="onRevertBonusTop"
          @open-item="openItem"
        />
        <FilterForm
          v-else-if="activeGroup === 'filters'"
          ref="filterForm"
          :key="`filter:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedFilter"
          :fixed-id="selectedFilterId"
          :status="selectedStatus"
          :db="db"
          :allocatable-ids="allocatableIds.filters"
          @save="onSaveFilter"
          @update:filter="onUpdateFilter"
          @delete="onDeleteFilter"
          @revert="onRevertFilter"
        />
        <SectionForm
          v-else-if="activeGroup === 'sections'"
          ref="sectionForm"
          :key="`section:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedSection"
          :status="selectedStatus"
          :db="db"
          :allocatable-ids="allocatableIds.sections"
          @save="onSaveSection"
          @update:section="onUpdateSection"
          @delete="onDeleteSection"
          @revert="onRevertSection"
          @open-slot="(id) => jumpTo('slots', id)"
          @open-preset="(id) => jumpTo('sectionPresets', id)"
        />
        <SlotForm
          v-else-if="activeGroup === 'slots'"
          ref="slotForm"
          :key="`slot:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedSlot"
          :duplicate-from="duplicateSlotSeed"
          :default-section="newEntrySection"
          :status="selectedStatus"
          :db="db"
          :allocatable-ids="allocatableIds.slots"
          @save="onSaveSlot"
          @update:slot="onUpdateSlot"
          @delete="onDeleteSlot"
          @duplicate="duplicateSlot"
          @revert="onRevertSlot"
        />
        <PresetForm
          v-else
          ref="presetForm"
          :key="`preset:${selectedKey ?? `__new__${newItemCounter}`}`"
          :source="selectedPreset"
          :duplicate-from="duplicatePresetSeed"
          :default-section="newEntrySection"
          :status="selectedStatus"
          :db="db"
          :allocatable-ids="allocatableIds.sectionPresets"
          @save="onSavePreset"
          @update:preset="onUpdatePreset"
          @delete="onDeletePreset"
          @revert="onRevertPreset"
        />
      </div>
    </div>
  </div>
</template>
