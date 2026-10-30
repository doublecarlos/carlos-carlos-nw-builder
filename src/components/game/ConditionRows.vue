<script setup lang="ts">
// Recursive editor for a `when` predicate tree (conditions.ts): leaves plus `all`/`any`/`not`
// groups, nested up to `MAX_DEPTH` levels. A "rows list" (this component's `rows` prop) is the
// editing-side stand-in for one when-object: a flat AND of leaves and groups, exactly mirroring
// what conditions.ts's `walk()` does with an object's keys. A group's branches are each their
// own rows list, so nesting is just this component containing itself. A SFC can recurse into
// itself by its own inferred name with no self-registration needed.
//
// A leaf's own controls are ConditionLeafFields. From md up they sit inline in the leaf's row.
// On a phone each leaf is one line of summary text instead, and tapping it opens that leaf's
// controls stacked in a bottom sheet. Groups keep their block on both, drawn slimmer on a
// phone so three levels still fit the narrowest screen.
import {
  computed,
  onBeforeUnmount,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import IconButton from "../ui/IconButton.vue";
import DragHandle from "../ui/DragHandle.vue";
import DropIndicator from "../ui/DropIndicator.vue";
import BaseSheet from "../ui/BaseSheet.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseMenu from "../ui/BaseMenu.vue";
import BaseMenuItem from "../ui/BaseMenuItem.vue";
import ConditionLeafFields from "./ConditionLeafFields.vue";
import {
  Ampersand,
  ChevronRight,
  CircleAlert,
  CirclePlus,
  Copy,
  Plus,
  Split,
  Trash,
} from "@lucide/vue";
import {
  LEAF_TYPES,
  MAX_DEPTH,
  newLeafRow,
  newGroupRow,
  cloneRow,
  isDescendantPath,
  type ConditionRow,
} from "../../engine/condition-draft";
import {
  summarizeLeaf,
  type ConditionSummary,
} from "../../lib/condition-summary";
import { useConditionSummaryContext } from "../../composables/useConditionSummaryContext";
import { holdBack } from "../../lib/back-to-close";
import { isPhone } from "../../stores/viewport";
import type { BonusOption } from "../../types";
import type { InputOption } from "../../lib/bonus-draft";
import {
  dragSource,
  useDragHandle,
  useDropList,
  reorderIndex,
  type DragSource,
} from "../../composables/useDragAndDrop";

/** Where one row currently lives, for cross-tree drag-and-drop transfers. `treeId` picks
 *  which grant/variant condition tree `path` is root-relative to (see condition-draft.ts's
 *  "path addressing"). Named distinctly from stores/bonus-draft.ts's `ConditionLocation`
 *  since this component doesn't know about grants/variants at all, only trees-by-id. */
export interface ConditionTreeLocation {
  treeId: string;
  path: number[];
}

/** Where one *branch* currently lives, for the same kind of cross-tree drag-and-drop transfer
 *  as `ConditionTreeLocation`, but addressing a whole branch of a group row rather than a
 *  single row. `groupPath` is a `ConditionTreeLocation`-style path to the group row itself
 *  (not one of its branches); `branchIndex` then picks the branch. */
export interface ConditionBranchTreeLocation {
  treeId: string;
  groupPath: number[];
  branchIndex: number;
}

const emit = defineEmits<{
  update: [rows: ConditionRow[]];
  /** A condition row was dropped into a different rows-list than the one it came from:
   *  possibly a different branch of the same tree, a different grant/variant's tree, or (via
   *  ItemBonuses' cross-bonus registry) a different bonus entirely. The outermost ConditionRows
   *  instance can't resolve this alone (removal happens in an array it doesn't own), so it
   *  bubbles all the way up to whichever component owns the store. Every intermediate
   *  ConditionRows instance just re-emits its children's `transfer` unchanged. */
  transfer: [
    payload: { source: ConditionTreeLocation; target: ConditionTreeLocation },
  ];
  /** Same as `transfer`, but for a whole branch dropped into a different group's branches.
   *  See `branchesDropList` below. */
  transferBranch: [
    payload: {
      source: ConditionBranchTreeLocation;
      target: ConditionBranchTreeLocation;
    },
  ];
}>();

const props = withDefaults(
  defineProps<{
    // Sent as `update:rows` by the component; parent replaces its own array reference.
    rows: ConditionRow[];
    depth?: number;
    /** Every known bonus, for the occurrences leaf's picker. */
    bonusOptions?: BonusOption[];
    /** The edited bonus's own inputs, for the `input` leaf's picker. */
    inputOptions?: InputOption[];
    /** Identifies which condition tree `path` is root-relative to. Opaque to this component,
     *  interpreted by whichever ancestor owns the store (see `transfer` above). */
    treeId?: string;
    /** This rows-list's own coordinates from the tree root: `[]` at the root, `[i, bi]` for
     *  the `bi`-th branch of `rows[i]`, and so on recursively. */
    path?: number[];
    /** Shown beside the add controls while the list is empty, saying what no condition means. */
    emptyText?: string;
    /** The leaf types offered, for a condition that cannot read every leaf. */
    leafTypes?: readonly string[];
  }>(),
  {
    depth: 0,
    emptyText: "",
    leafTypes: () => LEAF_TYPES,
    bonusOptions: () => [],
    inputOptions: () => [],
    treeId: "",
    path: () => [],
  },
);

const maxNestDepth = MAX_DEPTH - 1;
const canNest = computed(() => props.depth < maxNestDepth);
function opLabel(op?: string) {
  if (op === "not") return "not";
  return op === "any" ? "any of" : "all of";
}

function replaceRows(update: ConditionRow[]) {
  emit("update", update);
}

/** Returns the new row, so the phone can open it straight in the editor. */
function addLeaf(): ConditionRow {
  const row = newLeafRow();
  replaceRows([...props.rows, row]);
  return row;
}
function addGroup(op: string, index?: number) {
  const insertIndex =
    index === undefined || index === null ? props.rows.length : index + 1;
  replaceRows([
    ...props.rows.slice(0, insertIndex),
    newGroupRow(op),
    ...props.rows.slice(insertIndex),
  ]);
}
function removeRow(index: number) {
  replaceRows(props.rows.filter((_, i) => i !== index));
}
function duplicateRow(index: number): ConditionRow {
  const copy = cloneRow(props.rows[index]);
  replaceRows([
    ...props.rows.slice(0, index + 1),
    copy,
    ...props.rows.slice(index + 1),
  ]);
  return copy;
}

/** `toIndex` is relative to this rows list as it stands now (before the moved row is
 *  removed), the same contract as drag-and-drop's drop-index math. */
function moveRowTo(index: number, toIndex: number) {
  const clamped = Math.max(0, Math.min(props.rows.length, toIndex));
  const insertAt = reorderIndex(index, clamped);
  if (insertAt === index) return;
  const items = props.rows.slice();
  const [item] = items.splice(index, 1);
  items.splice(insertAt, 0, item);
  replaceRows(items);
}

// Drag-and-drop: reorder within this rows list, or transfer into a different one.
// A drop landing in this same rows list (same treeId + path) is a local reorder, handled by
// drag-and-drop alone (no move-up/down buttons at this level). A drop landing anywhere else, a
// different grant/variant's tree or a different bonus entirely, can't be resolved here (this
// component only ever sees its own `rows` array, never the tree it's part of), so it's
// reported upward via `transfer` instead. This is also how dragging a condition into a nested
// block works: a group's branch is rendered as its own nested ConditionRows instance (even
// while empty), so dropping onto it is just an ordinary cross-container transfer targeting
// that branch's path.
const containerId = computed(() => `${props.treeId}:${props.path.join(".")}`);

// Built once per rendered list, not once per template read (this is read from three spots).
// The `computed` stays correct even if `containerId` later changes, since the only reactive
// read here is `containerId.value` (a sibling group dragged past this one shifts `path`).
const rowsDropList = computed(() => {
  const id = containerId.value;
  return useDropList({
    containerId: id,
    accepts: (source) => source.kind === "condition-row",
    onDrop: (source, index) => {
      if (source.containerId === id) {
        moveRowTo(source.index, index);
        return;
      }
      const from = source.data as ConditionTreeLocation | undefined;
      if (!from) return;
      // Refuse to drop a group onto (or into) its own branch, which would nest it inside itself.
      if (isDescendantPath(from.path, props.path)) return;
      emit("transfer", {
        source: from,
        target: { treeId: props.treeId, path: [...props.path, index] },
      });
    },
  });
});
function dragHandleProps(index: number) {
  return useDragHandle((): DragSource => ({
    kind: "condition-row",
    containerId: containerId.value,
    key: props.rows[index]?.uid ?? String(index),
    index,
    data: {
      treeId: props.treeId,
      path: [...props.path, index],
    } satisfies ConditionTreeLocation,
  }));
}
function forwardTransfer(payload: {
  source: ConditionTreeLocation;
  target: ConditionTreeLocation;
}) {
  emit("transfer", payload);
}
function forwardBranchTransfer(payload: {
  source: ConditionBranchTreeLocation;
  target: ConditionBranchTreeLocation;
}) {
  emit("transferBranch", payload);
}

// These four all operate on a group row's `branches` (always set for a `kind: 'group'` row,
// guaranteed by newGroupRow). We replace the affected row with a new copy that has the
// updated branches, then re-emit the full rows array so the parent sees the change.
function replaceRowAndUpdateBranches(
  rowIndex: number,
  update: ConditionRow["branches"],
) {
  replaceRows(
    props.rows.map((row, i) =>
      i === rowIndex ? { ...row, branches: update } : row,
    ),
  );
}

function removeBranch(row: ConditionRow, index: number) {
  const rowIndex = props.rows.indexOf(row);
  if (rowIndex === -1) return;
  replaceRowAndUpdateBranches(
    rowIndex,
    row.branches!.filter((_, i) => i !== index),
  );
}
function insertBranch(row: ConditionRow, index: number) {
  const rowIndex = props.rows.indexOf(row);
  if (rowIndex === -1) return;
  replaceRowAndUpdateBranches(rowIndex, [
    ...row.branches!.slice(0, index + 1),
    [],
    ...row.branches!.slice(index + 1),
  ]);
}
function duplicateBranch(row: ConditionRow, index: number) {
  const rowIndex = props.rows.indexOf(row);
  if (rowIndex === -1) return;
  replaceRowAndUpdateBranches(rowIndex, [
    ...row.branches!.slice(0, index + 1),
    row.branches![index].map(cloneRow),
    ...row.branches!.slice(index + 1),
  ]);
}

/** `toIndex` is relative to `row.branches` as it stands now, before the moved branch is
 *  removed: the same contract as `moveRowTo`'s and drag-and-drop's drop-index math. */
function moveBranchTo(row: ConditionRow, index: number, toIndex: number) {
  const rowIndex = props.rows.indexOf(row);
  if (rowIndex === -1) return;
  const clamped = Math.max(0, Math.min((row.branches ?? []).length, toIndex));
  const insertAt = reorderIndex(index, clamped);
  if (insertAt === index) return;
  const branches = row.branches!.slice();
  const [item] = branches.splice(index, 1);
  branches.splice(insertAt, 0, item);
  replaceRowAndUpdateBranches(rowIndex, branches);
}

// A branch dropped onto its own group's branches list reorders locally (moveBranchTo, same as
// rowsDropList's same-container case for rows). A branch dropped onto a *different* group's
// branches list, possibly in a different grant/variant's tree or a different bonus entirely,
// can't be resolved here (this component only sees the one group's `branches` it's rendering),
// so it bubbles up via `transferBranch`, mirroring `transfer` above. A `not` group always has
// exactly one branch (see newGroupRow), so it's never a valid transfer target. It is excluded
// via `accepts` rather than left to fail inside `onDrop`, so it also never shows as a target.
//
// One `useDropList` per group row, cached by uid (a map, since several group rows can exist
// at once). `replaceRowAndUpdateBranches` replaces a group row with a new object, same uid, on
// every branch edit, so the closures below re-resolve the row by uid on each access rather
// than closing over the reference that was live when the cache entry was built.
const branchDropLists = new Map<string, ReturnType<typeof useDropList>>();
function rowByUid(uid: string): ConditionRow | undefined {
  return props.rows.find((r) => r.uid === uid);
}
function branchesDropList(row: ConditionRow) {
  let list = branchDropLists.get(row.uid);
  if (!list) {
    const uid = row.uid;
    const id = `branches:${props.treeId}:${uid}`;
    list = useDropList({
      containerId: id,
      accepts: (source) =>
        source.kind === "condition-branch" && rowByUid(uid)?.op !== "not",
      onDrop: (source, index) => {
        const current = rowByUid(uid);
        if (!current) return;
        const rowIndex = props.rows.indexOf(current);
        if (rowIndex === -1) return;
        if (source.containerId === id) {
          moveBranchTo(current, source.index, index);
          return;
        }
        const from = source.data as ConditionBranchTreeLocation | undefined;
        if (!from) return;
        const targetGroupPath = [...props.path, rowIndex];
        // Refuse to drop a branch into (or as a branch of) a group nested inside its own
        // content, which would nest it inside itself. `from.groupPath`/`branchIndex` together
        // address the branch's own rows-list, the same way a dragged row's `path` does.
        if (
          isDescendantPath(
            [...from.groupPath, from.branchIndex],
            targetGroupPath,
          )
        )
          return;
        emit("transferBranch", {
          source: from,
          target: {
            treeId: props.treeId,
            groupPath: targetGroupPath,
            branchIndex: index,
          },
        });
      },
    });
    branchDropLists.set(uid, list);
  }
  return list;
}
function branchDragHandleProps(
  row: ConditionRow,
  groupIndex: number,
  branchIndex: number,
) {
  return useDragHandle((): DragSource => ({
    kind: "condition-branch",
    containerId: `branches:${props.treeId}:${row.uid}`,
    key: String(branchIndex),
    index: branchIndex,
    data: {
      treeId: props.treeId,
      groupPath: [...props.path, groupIndex],
      branchIndex,
    } satisfies ConditionBranchTreeLocation,
  }));
}

// Phone: summary lines, and one leaf at a time in the editor sheet.
// Edits in the sheet apply live, as the inline row's do: the form's draft is the commit
// boundary, with its own Save, Revert and undo, so the sheet only needs Done to close.

const summaryContext = useConditionSummaryContext(() => ({
  bonuses: props.bonusOptions,
  inputs: props.inputOptions,
}));
const summaries = computed(() => {
  const out = new Map<string, ConditionSummary>();
  if (!isPhone.value) return out;
  for (const row of props.rows)
    if (row.kind === "leaf")
      out.set(row.uid, summarizeLeaf(row, summaryContext.value));
  return out;
});

/** The leaf open in the sheet. Set before a just-added row reaches `rows`, so the sheet's
 *  open state follows this alone and its content follows the row once it arrives. */
const editingUid = ref<string | null>(null);
const sheetOpen = computed(() => isPhone.value && editingUid.value !== null);
const editingIndex = computed(() =>
  sheetOpen.value
    ? props.rows.findIndex(
        (row) => row.uid === editingUid.value && row.kind === "leaf",
      )
    : -1,
);
const editing = computed(() =>
  editingIndex.value === -1 ? null : props.rows[editingIndex.value],
);

function openEditor(uid: string) {
  editingUid.value = uid;
}
function closeEditor() {
  editingUid.value = null;
}

// A row replaced from outside (undo, a revert) is no longer the one being edited.
watch(
  () => props.rows,
  (rows) => {
    if (editingUid.value && !rows.some((row) => row.uid === editingUid.value))
      closeEditor();
  },
);
watch(isPhone, (phone) => {
  if (!phone) closeEditor();
});

// The phone's Back closes the sheet (lib/back-to-close.ts). A picker opened inside it holds
// Back above it, so Back closes that picker first.
let releaseBack: (() => Promise<void>) | null = null;
watch(
  sheetOpen,
  (shown) => {
    if (shown) {
      releaseBack = holdBack(closeEditor);
      return;
    }
    void releaseBack?.();
    releaseBack = null;
  },
  { flush: "sync" },
);
onBeforeUnmount(() => void releaseBack?.());

function deleteEditing() {
  const index = editingIndex.value;
  closeEditor();
  if (index !== -1) removeRow(index);
}
function duplicateEditing() {
  const index = editingIndex.value;
  if (index !== -1) openEditor(duplicateRow(index).uid);
}

const addMenu = useTemplateRef<InstanceType<typeof BaseMenu>>("addMenu");
/** Tells this list's "+" apart from a nested list's in the menu's click-outside ignore. */
const addMenuId = useId();
function addFromMenu(what: "leaf" | "all" | "any" | "not") {
  addMenu.value?.close();
  if (what === "leaf") openEditor(addLeaf().uid);
  else addGroup(what);
}
</script>

<template>
  <!-- One row per direct child of the list, ruled off like a table so a run of conditions
       reads as rows instead of a wrapped paragraph of buttons. -->
  <div v-bind="rowsDropList.listProps()" class="relative flex flex-col">
    <DropIndicator :pos="rowsDropList.separatorStyle.value" />

    <div
      v-for="(row, i) in rows"
      :key="row.uid"
      data-testid="condition-row"
      class="border-y-2 border-line/50 py-1"
      :class="[
        dragSource?.containerId === containerId &&
          dragSource?.key === row.uid &&
          'is-drag-source opacity-50',
      ]"
      v-bind="rowsDropList.rowProps(i)"
    >
      <div
        v-if="row.kind === 'leaf' && isPhone"
        class="flex min-w-0 items-center gap-1.5"
      >
        <DragHandle
          tooltip="Drag to reorder or move to another condition group"
          data-testid="condition-drag-handle"
          v-bind="dragHandleProps(i)"
        />
        <button
          type="button"
          data-testid="condition-summary"
          class="flex min-h-tap min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1 text-left hover:bg-surface-2"
          :data-incomplete="summaries.get(row.uid)?.complete ? undefined : ''"
          @click="openEditor(row.uid)"
        >
          <CircleAlert
            v-if="!summaries.get(row.uid)?.complete"
            class="size-[14px] flex-none text-warn"
          />
          <span
            class="min-w-0 flex-1 break-words"
            data-testid="condition-summary-text"
            >{{ summaries.get(row.uid)?.text }}</span
          >
          <span
            v-if="!summaries.get(row.uid)?.complete"
            class="flex-none text-warn"
            >incomplete</span
          >
          <ChevronRight class="size-[14px] flex-none text-muted" />
        </button>
      </div>

      <div
        v-else-if="row.kind === 'leaf'"
        class="flex flex-wrap items-center gap-1.5"
      >
        <DragHandle
          tooltip="Drag to reorder or move to another condition group"
          data-testid="condition-drag-handle"
          v-bind="dragHandleProps(i)"
        />
        <IconButton title="Duplicate" @click="duplicateRow(i)"
          ><Copy
        /></IconButton>
        <IconButton title="Remove condition" @click="removeRow(i)"
          ><Trash
        /></IconButton>

        <ConditionLeafFields
          :row="row"
          :bonus-options="bonusOptions"
          :input-options="inputOptions"
          :leaf-types="leafTypes"
        />
      </div>

      <div v-else class="flex flex-wrap items-center gap-1.5 mb-1">
        <!-- A condition tree can sit on either a plain or already-recessed background
             depending where it's embedded, so the fill mixes in the current text color at
             low alpha rather than a fixed surface color. It reads as a step down from
             whatever it's sitting on either way. On a phone the frame thins to its left rule
             alone, so nesting costs a few pixels a level instead of a card's padding. -->
        <div
          data-testid="condition-group-box"
          :class="
            isPhone
              ? 'w-full rounded-r-md border-l-2 border-l-muted bg-text/5 my-0.5 pl-1.5 pr-0.5 pb-0.5 pt-0.5'
              : 'w-full rounded-md border border-line border-l-4 border-l-muted bg-text/5 my-0.5 px-2 pb-0.5 pt-1'
          "
        >
          <div class="flex flex-wrap items-center gap-1 mb-0.5">
            <DragHandle
              tooltip="Drag to reorder or move to another condition group"
              data-testid="condition-drag-handle"
              v-bind="dragHandleProps(i)"
            />
            <span
              data-testid="condition-op-label"
              class="rounded bg-surface-2 px-1.5 font-semibold uppercase tracking-wide"
              >{{ opLabel(row.op) }}</span
            >
            <span v-if="isPhone" class="flex-1" />
            <IconButton title="Duplicate" @click="duplicateRow(i)"
              ><Copy
            /></IconButton>
            <IconButton title="Remove condition" @click="removeRow(i)"
              ><Trash
            /></IconButton>
          </div>
          <div
            v-bind="branchesDropList(row).listProps()"
            class="relative flex flex-col divide-y divide-dashed divide-line"
          >
            <DropIndicator :pos="branchesDropList(row).separatorStyle.value" />

            <div
              v-for="(branch, bi) in row.branches"
              :key="bi"
              data-testid="condition-branch"
              class="py-0.5"
              :class="[
                dragSource?.containerId === `branches:${treeId}:${row.uid}` &&
                  dragSource?.key === String(bi) &&
                  'is-drag-source opacity-50',
              ]"
              v-bind="branchesDropList(row).rowProps(bi)"
            >
              <div
                v-if="row.op !== 'not'"
                class="my-1 flex items-center gap-0.5"
              >
                <DragHandle
                  data-testid="condition-branch-drag-handle"
                  v-bind="branchDragHandleProps(row, i, bi)"
                />
                <span class="my-0.5 uppercase pr-1">
                  Condition {{ bi + 1 }}
                </span>
                <IconButton
                  title="Duplicate branch"
                  @click="duplicateBranch(row, bi)"
                  ><Copy
                /></IconButton>
                <IconButton title="Insert branch" @click="insertBranch(row, bi)"
                  ><CirclePlus
                /></IconButton>
                <IconButton
                  v-if="(row.branches ?? []).length > 1"
                  title="Remove branch"
                  @click="removeBranch(row, bi)"
                  ><Trash
                /></IconButton>
                <hr class="flex-1" />
              </div>
              <ConditionRows
                :rows="branch"
                :depth="depth + 1"
                :bonus-options="bonusOptions"
                :input-options="inputOptions"
                :leaf-types="leafTypes"
                :tree-id="treeId"
                :path="[...path, i, bi]"
                :class="isPhone ? '' : 'ml-4 border-l-1 border-solid pl-2'"
                @update="(updated) => (row.branches![bi] = updated)"
                @transfer="forwardTransfer"
                @transfer-branch="forwardBranchTransfer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- On a phone one "+" offers what the desktop's four buttons do, and a new condition
         opens straight in the editor. -->
    <div
      v-if="isPhone"
      data-testid="condition-empty-drop"
      class="mt-1 flex flex-wrap items-center gap-1 rounded-md p-0.5"
    >
      <BaseMenu
        ref="addMenu"
        fit-content
        align="left"
        label="Add a condition"
        panel-class="flex min-w-48 flex-col p-1"
        :ignore="[`[data-add-menu='${addMenuId}']`]"
      >
        <template #trigger="{ toggle, attrs }">
          <IconButton
            title="Add"
            data-testid="condition-add"
            :data-add-menu="addMenuId"
            v-bind="attrs"
            @click="toggle"
            ><Plus
          /></IconButton>
        </template>
        <BaseMenuItem
          :icon="Plus"
          data-testid="condition-add-leaf"
          @click="addFromMenu('leaf')"
          >Condition</BaseMenuItem
        >
        <template v-if="canNest">
          <BaseMenuItem
            :icon="Ampersand"
            data-testid="condition-add-all"
            @click="addFromMenu('all')"
            >"All of" group</BaseMenuItem
          >
          <BaseMenuItem
            :icon="Split"
            data-testid="condition-add-any"
            @click="addFromMenu('any')"
            >"Any of" group</BaseMenuItem
          >
          <BaseMenuItem
            :icon="CircleAlert"
            data-testid="condition-add-not"
            @click="addFromMenu('not')"
            >"Not" group</BaseMenuItem
          >
        </template>
      </BaseMenu>
      <span v-if="emptyText && !rows.length" class="ml-1 text-muted">{{
        emptyText
      }}</span>
    </div>
    <div
      v-else
      data-testid="condition-empty-drop"
      class="mt-1 flex flex-wrap items-center gap-1 rounded-md p-0.5"
    >
      <IconButton title="Add condition" @click="addLeaf"><Plus /></IconButton>
      <template v-if="canNest">
        <IconButton
          title='Add "All of" condition group'
          @click="addGroup('all')"
          ><Ampersand
        /></IconButton>
        <IconButton
          title='Add "Any of" condition group'
          @click="addGroup('any')"
          ><Split
        /></IconButton>
        <IconButton title='Add "Not" condition group' @click="addGroup('not')"
          ><CircleAlert
        /></IconButton>
      </template>
      <span v-if="emptyText && !rows.length" class="ml-1 text-muted">{{
        emptyText
      }}</span>
    </div>

    <BaseSheet
      v-if="sheetOpen"
      side="bottom"
      title="Edit condition"
      data-testid="condition-editor"
      @close="closeEditor"
    >
      <div
        class="flex min-h-0 flex-1 flex-wrap content-start gap-x-2 gap-y-3 overflow-y-auto p-3"
        data-testid="condition-editor-fields"
      >
        <ConditionLeafFields
          v-if="editing"
          :row="editing"
          :bonus-options="bonusOptions"
          :input-options="inputOptions"
          :leaf-types="leafTypes"
          stacked
        />
      </div>
      <div class="flex flex-none items-center gap-2 border-t border-line p-2">
        <BaseButton
          danger
          data-testid="condition-editor-delete"
          @click="deleteEditing"
          ><Trash /> Delete</BaseButton
        >
        <BaseButton
          data-testid="condition-editor-duplicate"
          @click="duplicateEditing"
          ><Copy /> Duplicate</BaseButton
        >
        <BaseButton
          variant="primary"
          class="ml-auto"
          data-testid="condition-editor-done"
          @click="closeEditor"
          >Done</BaseButton
        >
      </div>
    </BaseSheet>
  </div>
</template>
