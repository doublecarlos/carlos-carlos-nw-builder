<script setup lang="ts">
// Recursive editor for a `when` predicate tree (conditions.ts) -- leaves plus `all`/`any`/`not`
// groups, nested up to `MAX_DEPTH` levels. A "rows list" (this component's `rows` prop) is the
// editing-side stand-in for one when-object: a flat AND of leaves and groups, exactly mirroring
// what conditions.ts's `walk()` does with an object's keys. A group's branches are each their
// own rows list, so nesting is just this component containing itself -- a SFC can recurse into
// itself by its own inferred name with no self-registration needed (unlike the old build, which
// had no global component registry and so had to attach itself to its own `components`).
import { computed } from 'vue';
import ComboBox from './ui/ComboBox.vue';
import IconButton from './ui/IconButton.vue';
import FormField from './ui/FormField.vue';
import { NW_SLOTS } from '../data';
import { LEAF_TYPES, MAX_DEPTH, newLeafRow, newGroupRow, cloneRow, type ConditionRow } from '../condition-draft';
import type { BuildParameterSlot } from '../types';

const props = withDefaults(defineProps<{
  // Mutated in place -- same convention as BonusRows' `rows` prop.
  rows: ConditionRow[];
  depth?: number;
  setIds?: string[];
}>(), {
  depth: 0,
  setIds: () => [],
});

const maxNestDepth = MAX_DEPTH - 1;
const canNest = computed(() => props.depth < maxNestDepth);
const typeOptions = LEAF_TYPES.map((t) => ({ value: t, label: t }));
const setComboOptions = computed(() => props.setIds.map((s) => ({ value: s, label: s })));

function opLabel(op?: string) {
  if (op === 'not') return 'not';
  return op === 'any' ? 'any of' : 'all of';
}

function addLeaf() { props.rows.push(newLeafRow()); }
function addGroup(op: string, index?: number) {
  const insertIndex = (index === undefined || index === null) ? props.rows.length : index + 1;
  props.rows.splice(insertIndex, 0, newGroupRow(op));
}
function removeRow(index: number) { props.rows.splice(index, 1); }
function insertLeaf(index: number) { props.rows.splice(index + 1, 0, newLeafRow()); }
function duplicateRow(index: number) { props.rows.splice(index + 1, 0, cloneRow(props.rows[index])); }

function moveRow(index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= props.rows.length) return;
  const [item] = props.rows.splice(index, 1);
  props.rows.splice(to, 0, item);
}

// These five all operate on a group row's `branches` -- always set for a `kind: 'group'` row
// (newGroupRow), so a non-null assertion is safe even though the type keeps it optional (a
// leaf row has no `branches` at all).
function addBranch(row: ConditionRow) { row.branches!.push([]); }
function removeBranch(row: ConditionRow, index: number) { row.branches!.splice(index, 1); }
function insertBranch(row: ConditionRow, index: number) { row.branches!.splice(index + 1, 0, []); }
function duplicateBranch(row: ConditionRow, index: number) {
  row.branches!.splice(index + 1, 0, row.branches![index].map(cloneRow));
}

function moveBranch(row: ConditionRow, index: number, delta: number) {
  const to = index + delta;
  const branches = row.branches!;
  if (to < 0 || to >= branches.length) return;
  const [item] = branches.splice(index, 1);
  branches.splice(to, 0, item);
}

// Each leaf type carries different fields; reset to the new type's defaults.
function changeType(row: ConditionRow) {
  const fresh = newLeafRow(row.type);
  Object.keys(row).forEach((key) => { if (key !== 'uid' && key !== 'kind') delete row[key]; });
  Object.assign(row, fresh, { uid: row.uid });
}

// Each condition leaf's valid values come from the matching `options` build_parameter slot in
// slots.json -- the same source of truth the Options section itself renders from, so a value
// typo'd here can't drift from what's actually selectable in a build.
const PATH_FOR_TYPE: Record<string, string> = {
  role: 'role', class: 'class', combatType: 'combatType',
  location: 'location', damageType: 'damageType',
};

function optionsForCombo(type?: string) {
  if (type === 'toggle') {
    return NW_SLOTS.slots
      .filter((slot): slot is BuildParameterSlot => (
        slot.type === 'build_parameter' && slot.path.startsWith('toggles.')
      ))
      .map((slot) => ({ value: slot.path.slice('toggles.'.length), label: slot.label }));
  }
  const path = type ? PATH_FOR_TYPE[type] : undefined;
  const slot = path ? NW_SLOTS.slots.find((s) => s.type === 'build_parameter' && s.path === path) : undefined;
  return (slot as BuildParameterSlot | undefined)?.options ?? [];
}

// --- the generic `param` leaf -----------------------------------------------------------
// Every build_parameter slot is a candidate key; the comparison control shown depends on the
// selected one's `paramType`, same source of truth `optionsForCombo` above already uses for the
// dedicated leaves.
const paramSlots = NW_SLOTS.slots.filter((slot): slot is BuildParameterSlot => slot.type === 'build_parameter');
const paramKeyOptions = paramSlots.map((slot) => ({ value: slot.path, label: `${slot.label} (${slot.path})` }));

function paramSlotFor(key?: string) {
  return paramSlots.find((slot) => slot.path === key);
}

/** Options for a `param` leaf's "equals" combo, when the addressed slot is a `list`. */
function paramValueOptions(key?: string) {
  return paramSlotFor(key)?.options ?? [];
}

/** Picking a key resets the comparison to match its `paramType` -- the old fields would
 * otherwise carry over nonsensically (e.g. a leftover `atLeast` after switching to a boolean). */
function changeParamKey(row: ConditionRow, key: string) {
  row.key = key;
  const slot = paramSlotFor(key);
  row.form = slot?.paramType === 'boolean' ? 'boolean' : slot?.paramType === 'list' ? 'string' : 'number';
  row.atLeast = null;
  row.below = null;
  row.is = null;
  row.equals = '';
}
</script>

<template>
  <!-- One row per direct child of the list -- ruled off like a table so a run of conditions
       reads as rows instead of a wrapped paragraph of buttons. -->
  <div class="flex flex-col">
    <div v-for="(row, i) in rows" :key="row.uid" class="border-y border-line/50 py-1">
      <div v-if="row.kind === 'leaf'" class="flex flex-wrap items-center gap-1.5">
        <IconButton icon="arrow-up" title="Move up" :disabled="i === 0" @click="moveRow(i, -1)" />
        <IconButton icon="arrow-down" title="Move down" :disabled="i === rows.length - 1" @click="moveRow(i, 1)" />
        <IconButton icon="copy" title="Duplicate" @click="duplicateRow(i)" />
        <IconButton icon="plus" title="Add condition" @click="insertLeaf(i)" />
        <IconButton v-if="canNest" icon="ampersand" title='Add &quot;All of&quot; condition group' @click="addGroup('all', i)" />
        <IconButton v-if="canNest" icon="split" title='Add &quot;Any of&quot; condition group' @click="addGroup('any', i)" />
        <IconButton v-if="canNest" icon="circle-alert" title='Add &quot;Not&quot; condition group' @click="addGroup('not', i)" />
        <IconButton icon="trash" title="Remove condition" @click="removeRow(i)" />

        <FormField label="Condition" class="min-w-0">
          <ComboBox class="w-28" :model-value="row.type" :options="typeOptions"
                    @update:model-value="v => { row.type = v; changeType(row) }" />
        </FormField>

        <template v-if="row.type === 'duration'">
          <FormField label="At least (s)" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" v-model.number="row.atLeast"></FormField>
          <FormField label="Below (s)" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" v-model.number="row.below"></FormField>
        </template>
        <template v-else-if="row.type === 'pieces'">
          <FormField label="Set" class="min-w-0">
            <ComboBox class="w-44" :model-value="row.set" :options="setComboOptions"
                      placeholder="— set —" @update:model-value="v => row.set = v" />
          </FormField>
          <FormField label="At least (s)" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" v-model.number="row.atLeast"></FormField>
          <FormField label="Below (s)" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" v-model.number="row.below"></FormField>
        </template>
        <template v-else-if="row.type === 'equipped'">
          <FormField label="Tag" class="min-w-0"><input class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="text" v-model="row.tag" list="nw-tags"></FormField>
          <FormField label="Or exact item name" class="min-w-0"><input class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="text" v-model="row.item"></FormField>
          <FormField label="At least (s)" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" v-model.number="row.atLeast"></FormField>
          <FormField label="Below (s)" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" v-model.number="row.below"></FormField>
        </template>
        <template v-else-if="row.type === 'param'">
          <FormField label="Parameter" class="min-w-0">
            <ComboBox class="w-48" :model-value="row.key" :options="paramKeyOptions"
                      placeholder="— parameter —" @update:model-value="v => changeParamKey(row, v)" />
          </FormField>
          <template v-if="row.form === 'boolean'">
            <FormField label="Is" class="min-w-0">
              <ComboBox class="w-24" :model-value="row.is === true ? 'on' : row.is === false ? 'off' : ''"
                        :options="[{ value: 'on', label: 'on' }, { value: 'off', label: 'off' }]"
                        placeholder="— is —" @update:model-value="v => row.is = v === 'on'" />
            </FormField>
          </template>
          <template v-else-if="row.form === 'string'">
            <FormField label="Equals" class="min-w-0">
              <ComboBox v-if="paramValueOptions(row.key).length" class="w-38"
                        :model-value="row.equals" :options="paramValueOptions(row.key)"
                        @update:model-value="v => row.equals = v" />
              <input v-else class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="text" v-model="row.equals">
            </FormField>
          </template>
          <template v-else>
            <FormField label="At least" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" step="any" v-model.number="row.atLeast"></FormField>
            <FormField label="Below" class="min-w-0"><input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="number" step="any" v-model.number="row.below"></FormField>
          </template>
        </template>
        <template v-else>
          <FormField label="Value" class="min-w-0">
            <ComboBox v-if="optionsForCombo(row.type).length" class="w-38"
                      :model-value="row.value" :options="optionsForCombo(row.type)"
                      @update:model-value="v => row.value = v" />
            <input v-else class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent" type="text" v-model="row.value">
          </FormField>
        </template>
      </div>

      <div v-else class="flex flex-wrap items-center gap-1.5 mb-1">
        <IconButton icon="arrow-up" title="Move up" :disabled="i === 0" @click="moveRow(i, -1)" />
        <IconButton icon="arrow-down" title="Move down" :disabled="i === rows.length - 1" @click="moveRow(i, 1)" />
        <IconButton icon="copy" title="Duplicate" @click="duplicateRow(i)" />
        <IconButton icon="plus" title="Add condition" @click="insertLeaf(i)" />
        <IconButton v-if="canNest" icon="ampersand" title='Add &quot;All of&quot; condition group' @click="addGroup('all', i)" />
        <IconButton v-if="canNest" icon="split" title='Add &quot;Any of&quot; condition group' @click="addGroup('any', i)" />
        <IconButton v-if="canNest" icon="circle-alert" title='Add &quot;Not&quot; condition group' @click="addGroup('not', i)" />
        <IconButton icon="trash" title="Remove condition" @click="removeRow(i)" />

        <!-- A condition tree can sit on either a plain or already-recessed background
             depending where it's embedded, so the fill mixes in the current text colour at
             low alpha rather than a fixed surface colour -- it reads as a step down from
             whatever it's sitting on either way. -->
        <div class="w-full rounded-md border border-line border-l-4 border-l-muted bg-text/5 my-0.5 px-2 pb-0.5 pt-1">
          <div class="flex flex-wrap items-center gap-1 mb-0.5">
            <span class="rounded bg-surface-2 px-1.5 text-sm font-semibold uppercase tracking-wide">{{ opLabel(row.op) }}</span>
          </div>
          <div class="flex flex-col divide-y divide-dashed divide-line">
            <div v-for="(branch, bi) in row.branches" :key="bi" class="py-0.5">
              <div v-if="row.op !== 'not' && bi > 0" class="my-0.5 text-sm uppercase text-muted">
                {{ row.op === 'any' ? 'or' : 'and' }}
              </div>
              <ConditionRows :rows="branch" :depth="depth + 1" :set-ids="setIds" />
              <div v-if="row.op !== 'not'" class="my-1 flex items-center gap-0.5">
                <span class="text-sm text-muted">Branch: </span>
                <IconButton icon="arrow-up" title="Move branch up" :disabled="bi === 0"
                            @click="moveBranch(row, bi, -1)" />
                <IconButton icon="arrow-down" title="Move branch down" :disabled="bi === (row.branches ?? []).length - 1"
                            @click="moveBranch(row, bi, 1)" />
                <IconButton icon="copy" title="Duplicate branch" @click="duplicateBranch(row, bi)" />
                <IconButton icon="circle-plus" title="Insert branch" @click="insertBranch(row, bi)" />
                <IconButton v-if="(row.branches ?? []).length > 1" icon="trash" title="Remove branch"
                            @click="removeBranch(row, bi)" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!rows.length" class="mt-1 flex flex-wrap gap-1">
      <IconButton icon="plus" title="Add condition" @click="addLeaf" />
      <template v-if="canNest">
        <IconButton icon="ampersand" title='Add &quot;All of&quot; condition group' @click="addGroup('all')" />
        <IconButton icon="split" title='Add &quot;Any of&quot; condition group' @click="addGroup('any')" />
        <IconButton icon="circle-alert" title='Add &quot;Not&quot; condition group' @click="addGroup('not')" />
      </template>
    </div>
  </div>
</template>
