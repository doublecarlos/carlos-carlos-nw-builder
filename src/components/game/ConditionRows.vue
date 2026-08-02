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
  ArrowDown,
  ArrowUp,
  CircleAlert,
  CirclePlus,
  Copy,
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
  type ConditionRow,
} from "../../engine/condition-draft";
import type { BuildParameterSlot } from "../../types";

const emit = defineEmits<{
  update: [rows: ConditionRow[]];
}>();

const props = withDefaults(
  defineProps<{
    // Sent as `update:rows` by the component; parent replaces its own array reference.
    rows: ConditionRow[];
    depth?: number;
    setIds?: string[];
  }>(),
  {
    depth: 0,
    setIds: () => [],
  },
);

const maxNestDepth = MAX_DEPTH - 1;
const canNest = computed(() => props.depth < maxNestDepth);
const typeOptions = LEAF_TYPES.map((t) => ({ value: t, label: t }));
const setComboOptions = computed(() =>
  props.setIds.map((s) => ({ value: s, label: s })),
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
function insertLeaf(index: number) {
  replaceRows([
    ...props.rows.slice(0, index + 1),
    newLeafRow(),
    ...props.rows.slice(index + 1),
  ]);
}
function duplicateRow(index: number) {
  replaceRows([
    ...props.rows.slice(0, index + 1),
    cloneRow(props.rows[index]),
    ...props.rows.slice(index + 1),
  ]);
}

function moveRow(index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= props.rows.length) return;
  const items = props.rows.slice();
  const [item] = items.splice(index, 1);
  items.splice(to, 0, item);
  replaceRows(items);
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

function moveBranch(row: ConditionRow, index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= row.branches!.length) return;
  const rowIndex = props.rows.indexOf(row);
  if (rowIndex === -1) return;
  const branches = row.branches!.slice();
  const [item] = branches.splice(index, 1);
  branches.splice(to, 0, item);
  replaceRowAndUpdateBranches(rowIndex, branches);
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
  location: "location",
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
      class="border-y border-line/50 py-1"
    >
      <div
        v-if="row.kind === 'leaf'"
        class="flex flex-wrap items-center gap-1.5"
      >
        <IconButton title="Move up" :disabled="i === 0" @click="moveRow(i, -1)"
          ><ArrowUp
        /></IconButton>
        <IconButton
          title="Move down"
          :disabled="i === rows.length - 1"
          @click="moveRow(i, 1)"
          ><ArrowDown
        /></IconButton>
        <IconButton title="Duplicate" @click="duplicateRow(i)"
          ><Copy
        /></IconButton>
        <IconButton title="Add condition" @click="insertLeaf(i)"
          ><Plus
        /></IconButton>
        <IconButton
          v-if="canNest"
          title='Add "All of" condition group'
          @click="addGroup('all', i)"
          ><Ampersand
        /></IconButton>
        <IconButton
          v-if="canNest"
          title='Add "Any of" condition group'
          @click="addGroup('any', i)"
          ><Split
        /></IconButton>
        <IconButton
          v-if="canNest"
          title='Add "Not" condition group'
          @click="addGroup('not', i)"
          ><CircleAlert
        /></IconButton>
        <IconButton title="Remove condition" @click="removeRow(i)"
          ><Trash
        /></IconButton>

        <FormField label="Condition" class="min-w-0">
          <ComboBox
            class="w-28"
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
        <template v-else-if="row.type === 'pieces'">
          <FormField label="Set" class="min-w-0">
            <ComboBox
              class="w-44"
              :model-value="row.set"
              :options="setComboOptions"
              placeholder="— set —"
              @update:model-value="(v) => (row.set = v)"
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
        <IconButton title="Move up" :disabled="i === 0" @click="moveRow(i, -1)"
          ><ArrowUp
        /></IconButton>
        <IconButton
          title="Move down"
          :disabled="i === rows.length - 1"
          @click="moveRow(i, 1)"
          ><ArrowDown
        /></IconButton>
        <IconButton title="Duplicate" @click="duplicateRow(i)"
          ><Copy
        /></IconButton>
        <IconButton title="Add condition" @click="insertLeaf(i)"
          ><Plus
        /></IconButton>
        <IconButton
          v-if="canNest"
          title='Add "All of" condition group'
          @click="addGroup('all', i)"
          ><Ampersand
        /></IconButton>
        <IconButton
          v-if="canNest"
          title='Add "Any of" condition group'
          @click="addGroup('any', i)"
          ><Split
        /></IconButton>
        <IconButton
          v-if="canNest"
          title='Add "Not" condition group'
          @click="addGroup('not', i)"
          ><CircleAlert
        /></IconButton>
        <IconButton title="Remove condition" @click="removeRow(i)"
          ><Trash
        /></IconButton>

        <!-- A condition tree can sit on either a plain or already-recessed background
             depending where it's embedded, so the fill mixes in the current text colour at
             low alpha rather than a fixed surface colour -- it reads as a step down from
             whatever it's sitting on either way. -->
        <div
          class="w-full rounded-md border border-line border-l-4 border-l-muted bg-text/5 my-0.5 px-2 pb-0.5 pt-1"
        >
          <div class="flex flex-wrap items-center gap-1 mb-0.5">
            <span
              class="rounded bg-surface-2 px-1.5 text-sm font-semibold uppercase tracking-wide"
              >{{ opLabel(row.op) }}</span
            >
          </div>
          <div class="flex flex-col divide-y divide-dashed divide-line">
            <div v-for="(branch, bi) in row.branches" :key="bi" class="py-0.5">
              <div
                v-if="row.op !== 'not' && bi > 0"
                class="my-0.5 text-sm uppercase text-muted"
              >
                {{ row.op === "any" ? "or" : "and" }}
              </div>
              <ConditionRows
                :rows="branch"
                :depth="depth + 1"
                :set-ids="setIds"
                @update="(updated) => (row.branches![bi] = updated)"
              />
              <div
                v-if="row.op !== 'not'"
                class="my-1 flex items-center gap-0.5"
              >
                <span class="text-sm text-muted">Branch: </span>
                <IconButton
                  title="Move branch up"
                  :disabled="bi === 0"
                  @click="moveBranch(row, bi, -1)"
                  ><ArrowUp
                /></IconButton>
                <IconButton
                  title="Move branch down"
                  :disabled="bi === (row.branches ?? []).length - 1"
                  @click="moveBranch(row, bi, 1)"
                  ><ArrowDown
                /></IconButton>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!rows.length" class="mt-1 flex flex-wrap gap-1">
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
