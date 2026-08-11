<script setup lang="ts">
// Recursive editor for a `when` predicate tree (conditions.ts) -- leaves plus `all`/`any`/`not`
// groups, nested up to `MAX_DEPTH` levels. A "rows list" (this component's `rows` prop) is the
// editing-side stand-in for one when-object: a flat AND of leaves and groups, exactly mirroring
// what conditions.ts's `walk()` does with an object's keys. A group's branches are each their
// own rows list, so nesting is just this component containing itself -- a SFC can recurse into
// itself by its own inferred name with no self-registration needed.
import { computed } from "vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import {
  Ampersand,
  CircleAlert,
  CirclePlus,
  Copy,
  GripVertical,
  Plus,
  Split,
  Trash,
} from "@lucide/vue";
import FormField from "../ui/FormField.vue";
import { NW_SLOTS } from "../../data/data";
import {
  LEAF_TYPES,
  MAX_DEPTH,
  newLeafRow,
  newGroupRow,
  cloneRow,
  isDescendantPath,
  type ConditionRow,
} from "../../engine/condition-draft";
import type { BuildParameterSlot } from "../../types";
import {
  useDragHandle,
  useDropList,
  reorderIndex,
  type DragSource,
} from "../../composables/useDragAndDrop";

/** Where one row currently lives, for cross-tree drag-and-drop transfers -- `treeId` picks
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
  /** A condition row was dropped into a different rows-list than the one it came from --
   *  possibly a different branch of the same tree, a different grant/variant's tree, or (via
   *  ItemBonuses' cross-bonus registry) a different bonus entirely. The outermost ConditionRows
   *  instance can't resolve this alone (removal happens in an array it doesn't own), so it
   *  bubbles all the way up to whichever component owns the store -- every intermediate
   *  ConditionRows instance just re-emits its children's `transfer` unchanged. */
  transfer: [
    payload: { source: ConditionTreeLocation; target: ConditionTreeLocation },
  ];
  /** Same as `transfer`, but for a whole branch dropped into a different group's branches --
   *  see `branchesDropList` below. */
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
    bonusIds?: string[];
    /** Identifies which condition tree `path` is root-relative to -- opaque to this component,
     *  interpreted by whichever ancestor owns the store (see `transfer` above). */
    treeId?: string;
    /** This rows-list's own coordinates from the tree root: `[]` at the root, `[i, bi]` for
     *  the `bi`-th branch of `rows[i]`, and so on recursively. */
    path?: number[];
  }>(),
  {
    depth: 0,
    bonusIds: () => [],
    treeId: "",
    path: () => [],
  },
);

const maxNestDepth = MAX_DEPTH - 1;
const canNest = computed(() => props.depth < maxNestDepth);
const labels: Record<string, string> = {
  bonusOccurrences: "occurrences",
};
const typeOptions = LEAF_TYPES.map((t) => ({
  value: t,
  label: labels[t] ?? t,
}));
const bonusComboOptions = computed(() =>
  props.bonusIds.map((s) => ({ value: s, label: s })),
);

function opLabel(op?: string) {
  if (op === "not") return "not";
  return op === "any" ? "any of" : "all of";
}

function replaceRows(update: ConditionRow[]) {
  emit("update", update);
}

function addLeaf() {
  replaceRows([...props.rows, newLeafRow()]);
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
function duplicateRow(index: number) {
  replaceRows([
    ...props.rows.slice(0, index + 1),
    cloneRow(props.rows[index]),
    ...props.rows.slice(index + 1),
  ]);
}

/** `toIndex` is relative to this rows list as it stands now (before the moved row is
 *  removed) -- same contract as drag-and-drop's drop-index math. */
function moveRowTo(index: number, toIndex: number) {
  const clamped = Math.max(0, Math.min(props.rows.length, toIndex));
  const insertAt = reorderIndex(index, clamped);
  if (insertAt === index) return;
  const items = props.rows.slice();
  const [item] = items.splice(index, 1);
  items.splice(insertAt, 0, item);
  replaceRows(items);
}

// --- drag-and-drop: reorder within this rows list, or transfer into a different one --------
// A drop landing in this same rows list (same treeId + path) is a local reorder, handled by
// drag-and-drop alone (no move-up/down buttons at this level). A drop landing anywhere else -- a
// different grant/variant's tree, a different bonus entirely -- can't be resolved here (this
// component only ever sees its own `rows` array, never the tree it's part of), so it's
// reported upward via `transfer` instead. This is also how dragging a condition into a nested
// block works: a group's branch is rendered as its own nested ConditionRows instance (even
// while empty), so dropping onto it is just an ordinary cross-container transfer targeting
// that branch's path.
const containerId = computed(() => `${props.treeId}:${props.path.join(".")}`);

function dropList() {
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
      // Refuse to drop a group onto (or into) its own branch -- would nest it inside itself.
      if (isDescendantPath(from.path, props.path)) return;
      emit("transfer", {
        source: from,
        target: { treeId: props.treeId, path: [...props.path, index] },
      });
    },
  });
}
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
 *  removed -- same contract as `moveRowTo`'s and drag-and-drop's drop-index math. */
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
// dropList()'s same-container case for rows). A branch dropped onto a *different* group's
// branches list -- possibly a different grant/variant's tree, or a different bonus entirely --
// can't be resolved here (this component only sees the one group's `branches` it's rendering),
// so it bubbles up via `transferBranch`, mirroring `transfer` above. A `not` group always has
// exactly one branch (see newGroupRow), so it's never a valid transfer target -- excluded via
// `accepts` rather than left to fail inside `onDrop`, so it also never shows as a drop target.
function branchesDropList(row: ConditionRow, groupIndex: number) {
  const id = `branches:${props.treeId}:${row.uid}`;
  return useDropList({
    containerId: id,
    accepts: (source) => source.kind === "condition-branch" && row.op !== "not",
    onDrop: (source, index) => {
      if (source.containerId === id) {
        moveBranchTo(row, source.index, index);
        return;
      }
      const from = source.data as ConditionBranchTreeLocation | undefined;
      if (!from) return;
      const targetGroupPath = [...props.path, groupIndex];
      // Refuse to drop a branch into (or as a branch of) a group nested inside its own
      // content -- would nest it inside itself. `from.groupPath`/`branchIndex` together
      // address the branch's own rows-list, the same way a dragged row's `path` does.
      if (
        isDescendantPath([...from.groupPath, from.branchIndex], targetGroupPath)
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

// Each leaf type carries different fields; reset to the new type's defaults.
function changeType(row: ConditionRow) {
  const fresh = newLeafRow(row.type);
  Object.keys(row).forEach((key) => {
    if (key !== "uid" && key !== "kind")
      delete (row as unknown as Record<string, unknown>)[key];
  });
  Object.assign(row, fresh, { uid: row.uid });
}

// Each condition leaf's valid values come from the matching `options` build_parameter slot in
// slots.json -- the same source of truth the Options section itself renders from, so a value
// typo'd here can't drift from what's actually selectable in a build.
const PATH_FOR_TYPE: Record<string, string> = {
  role: "role",
  class: "class",
  combatType: "combatType",
  damageType: "damageType",
};

function optionsForCombo(type?: string) {
  if (type === "toggle") {
    return NW_SLOTS.slots
      .filter(
        (slot): slot is BuildParameterSlot =>
          slot.type === "build_parameter" && slot.path.startsWith("toggles."),
      )
      .map((slot) => ({
        value: slot.path.slice("toggles.".length),
        label: slot.label,
      }));
  }
  const path = type ? PATH_FOR_TYPE[type] : undefined;
  const slot = path
    ? NW_SLOTS.slots.find(
        (s) => s.type === "build_parameter" && s.path === path,
      )
    : undefined;
  // Drop a slot's own "— none —" row: "" is a build-editor value, not a condition
  // value -- a `class: ""` leaf would serialise to nothing anyway (`fromCsv`).
  return ((slot as BuildParameterSlot | undefined)?.options ?? []).filter(
    (o) => o.value,
  );
}

// --- the generic `param` leaf -----------------------------------------------------------
// Every build_parameter slot is a candidate key; the comparison control shown depends on the
// selected one's `paramType`, same source of truth `optionsForCombo` above already uses for the
// dedicated leaves.
const paramSlots = NW_SLOTS.slots.filter(
  (slot): slot is BuildParameterSlot => slot.type === "build_parameter",
);
const paramKeyOptions = paramSlots.map((slot) => ({
  value: slot.path,
  label: `${slot.label} (${slot.path})`,
}));

function paramSlotFor(key?: string) {
  return paramSlots.find((slot) => slot.path === key);
}

/** Options for a `param` leaf's "equals" combo, when the addressed slot is a `list`. */
function paramValueOptions(key?: string) {
  return (paramSlotFor(key)?.options ?? []).filter((o) => o.value);
}

/** Picking a key resets the comparison to match its `paramType` -- the old fields would
 * otherwise carry over nonsensically (e.g. a leftover `atLeast` after switching to a boolean). */
function changeParamKey(row: ConditionRow, key: string) {
  row.key = key;
  const slot = paramSlotFor(key);
  row.form =
    slot?.paramType === "boolean"
      ? "boolean"
      : slot?.paramType === "list"
        ? "string"
        : "number";
  row.atLeast = null;
  row.below = null;
  row.is = null;
  row.equals = "";
}
</script>

<template>
  <!-- One row per direct child of the list -- ruled off like a table so a run of conditions
       reads as rows instead of a wrapped paragraph of buttons. -->
  <div class="flex flex-col">
    <div
      v-for="(row, i) in rows"
      :key="row.uid"
      data-testid="condition-row"
      class="border-y-2 border-line/50 py-1"
      :class="[
        dropList().indicatorAt(i) === 'before' && '!border-t-accent',
        dropList().indicatorAt(i) === 'after' && '!border-b-accent',
      ]"
      v-bind="dropList().rowProps(i)"
    >
      <div
        v-if="row.kind === 'leaf'"
        class="flex flex-wrap items-center gap-1.5"
      >
        <span
          data-testid="condition-drag-handle"
          title="Drag to reorder or move into a block"
          class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
          v-bind="dragHandleProps(i)"
        >
          <GripVertical />
        </span>
        <IconButton title="Duplicate" @click="duplicateRow(i)"
          ><Copy
        /></IconButton>
        <IconButton title="Remove condition" @click="removeRow(i)"
          ><Trash
        /></IconButton>

        <FormField label="Condition" class="min-w-0">
          <ComboBox
            class="w-30"
            :model-value="row.type"
            :options="typeOptions"
            @update:model-value="
              (v) => {
                row.type = v;
                changeType(row);
              }
            "
          />
        </FormField>

        <template v-if="row.type === 'duration'">
          <FormField label="At least (s)" class="min-w-0"
            ><input
              v-model.number="row.atLeast"
              class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="number"
          /></FormField>
          <FormField label="Below (s)" class="min-w-0"
            ><input
              v-model.number="row.below"
              class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="number"
          /></FormField>
        </template>
        <template v-else-if="row.type === 'bonusOccurrences'">
          <FormField label="Bonus" class="min-w-0">
            <ComboBox
              class="w-44"
              :model-value="row.bonus"
              :options="bonusComboOptions"
              placeholder="— bonus —"
              @update:model-value="(v) => (row.bonus = v)"
            />
          </FormField>
          <FormField label="At least (s)" class="min-w-0"
            ><input
              v-model.number="row.atLeast"
              class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="number"
          /></FormField>
          <FormField label="Below (s)" class="min-w-0"
            ><input
              v-model.number="row.below"
              class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="number"
          /></FormField>
        </template>
        <template v-else-if="row.type === 'equipped'">
          <FormField label="Tag" class="min-w-0"
            ><input
              v-model="row.tag"
              class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="text"
              list="nw-tags"
          /></FormField>
          <FormField label="Or exact item id" class="min-w-0"
            ><input
              v-model="row.item"
              class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="text"
          /></FormField>
          <FormField label="At least (s)" class="min-w-0"
            ><input
              v-model.number="row.atLeast"
              class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="number"
          /></FormField>
          <FormField label="Below (s)" class="min-w-0"
            ><input
              v-model.number="row.below"
              class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="number"
          /></FormField>
        </template>
        <template v-else-if="row.type === 'param'">
          <FormField label="Parameter" class="min-w-0">
            <ComboBox
              class="w-48"
              :model-value="row.key"
              :options="paramKeyOptions"
              placeholder="— parameter —"
              @update:model-value="(v) => changeParamKey(row, v)"
            />
          </FormField>
          <template v-if="row.form === 'boolean'">
            <FormField label="Is" class="min-w-0">
              <ComboBox
                class="w-24"
                :model-value="
                  row.is === true ? 'on' : row.is === false ? 'off' : ''
                "
                :options="[
                  { value: 'on', label: 'on' },
                  { value: 'off', label: 'off' },
                ]"
                placeholder="— is —"
                @update:model-value="(v) => (row.is = v === 'on')"
              />
            </FormField>
          </template>
          <template v-else-if="row.form === 'string'">
            <FormField label="Equals" class="min-w-0">
              <ComboBox
                v-if="paramValueOptions(row.key).length"
                class="w-38"
                :model-value="row.equals"
                :options="paramValueOptions(row.key)"
                @update:model-value="(v) => (row.equals = v)"
              />
              <input
                v-else
                v-model="row.equals"
                class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="text"
              />
            </FormField>
          </template>
          <template v-else>
            <FormField label="At least" class="min-w-0"
              ><input
                v-model.number="row.atLeast"
                class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="number"
                step="any"
            /></FormField>
            <FormField label="Below" class="min-w-0"
              ><input
                v-model.number="row.below"
                class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                type="number"
                step="any"
            /></FormField>
          </template>
        </template>
        <template v-else-if="row.type === 'proc'">
          <!-- The per-grant toggle itself is keyed automatically (bonus.ts) -- both fields
               here are optional refinements, not the condition itself. -->
          <FormField label="Checkbox label" class="min-w-0">
            <input
              v-model="row.procLabel"
              class="w-56 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="text"
              placeholder="defaults to the bonus name"
            />
          </FormField>
          <FormField label="Starts" class="min-w-0">
            <ComboBox
              class="w-24"
              :model-value="
                row.procDefault === true
                  ? 'on'
                  : row.procDefault === false
                    ? 'off'
                    : ''
              "
              :options="[
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ]"
              placeholder="on"
              @update:model-value="
                (v) => (row.procDefault = v === '' ? null : v === 'on')
              "
            />
          </FormField>
        </template>
        <template v-else>
          <FormField label="Value" class="min-w-0">
            <ComboBox
              v-if="optionsForCombo(row.type).length"
              class="w-38"
              :model-value="row.value"
              :options="optionsForCombo(row.type)"
              @update:model-value="(v) => (row.value = v)"
            />
            <input
              v-else
              v-model="row.value"
              class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
              type="text"
            />
          </FormField>
        </template>
      </div>

      <div v-else class="flex flex-wrap items-center gap-1.5 mb-1">
        <!-- A condition tree can sit on either a plain or already-recessed background
             depending where it's embedded, so the fill mixes in the current text colour at
             low alpha rather than a fixed surface colour -- it reads as a step down from
             whatever it's sitting on either way. -->
        <div
          data-testid="condition-group-box"
          class="w-full rounded-md border border-line border-l-4 border-l-muted bg-text/5 my-0.5 px-2 pb-0.5 pt-1"
        >
          <div class="flex flex-wrap items-center gap-1 mb-0.5">
            <span
              data-testid="condition-drag-handle"
              title="Drag to reorder or move into a block"
              class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
              v-bind="dragHandleProps(i)"
            >
              <GripVertical />
            </span>
            <span
              data-testid="condition-op-label"
              class="rounded bg-surface-2 px-1.5 text-sm font-semibold uppercase tracking-wide"
              >{{ opLabel(row.op) }}</span
            >
            <IconButton title="Duplicate" @click="duplicateRow(i)"
              ><Copy
            /></IconButton>
            <IconButton title="Remove condition" @click="removeRow(i)"
              ><Trash
            /></IconButton>
          </div>
          <div class="flex flex-col divide-y divide-dashed divide-line">
            <div
              v-for="(branch, bi) in row.branches"
              :key="bi"
              data-testid="condition-branch"
              class="py-0.5 border-y-2 border-transparent"
              :class="[
                branchesDropList(row, i).indicatorAt(bi) === 'before' &&
                  '!border-t-accent',
                branchesDropList(row, i).indicatorAt(bi) === 'after' &&
                  '!border-b-accent',
              ]"
              v-bind="branchesDropList(row, i).rowProps(bi)"
            >
              <div
                v-if="row.op !== 'not'"
                class="my-1 flex items-center gap-0.5"
              >
                <span
                  data-testid="condition-branch-drag-handle"
                  title="Drag to reorder"
                  class="cursor-grab text-muted hover:text-accent [&_svg]:size-[14px]"
                  v-bind="branchDragHandleProps(row, i, bi)"
                >
                  <GripVertical />
                </span>
                <span class="my-0.5 text-sm uppercase pr-1">
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
                :bonus-ids="bonusIds"
                :tree-id="treeId"
                :path="[...path, i, bi]"
                class="ml-4 border-l-1 border-solid pl-2"
                @update="(updated) => (row.branches![bi] = updated)"
                @transfer="forwardTransfer"
                @transfer-branch="forwardBranchTransfer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      data-testid="condition-empty-drop"
      class="mt-1 flex flex-wrap items-center gap-1 rounded-md border-2 border-dashed border-transparent p-0.5"
      :class="
        dropList().isActiveContainer.value && !rows.length && '!border-accent'
      "
      v-bind="rows.length ? {} : dropList().emptyProps()"
    >
      <span
        v-if="dropList().isActiveContainer.value && !rows.length"
        class="text-sm text-muted"
        >Drop here</span
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
    </div>
  </div>
</template>
