<script setup lang="ts">
// Recursive editor for a `when` predicate tree (conditions.ts) -- leaves plus `all`/`any`/`not`
// groups, nested up to `MAX_DEPTH` levels. A "rows list" (this component's `rows` prop) is the
// editing-side stand-in for one when-object: a flat AND of leaves and groups, exactly mirroring
// what conditions.ts's `walk()` does with an object's keys. A group's branches are each their
// own rows list, so nesting is just this component containing itself -- a SFC can recurse into
// itself by its own inferred name with no self-registration needed (unlike the old build, which
// had no global component registry and so had to attach itself to its own `components`).
import { computed } from 'vue';
import ComboBox from './ComboBox.vue';
import IconButton from './IconButton.vue';
import { NW_SCHEMA } from '../data';
import { LEAF_TYPES, MAX_DEPTH, newLeafRow, newGroupRow, cloneRow, type ConditionRow } from '../condition-draft';

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

function opLabel(op: string) {
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

function addBranch(row: any) { row.branches.push([]); }
function removeBranch(row: any, index: number) { row.branches.splice(index, 1); }
function insertBranch(row: any, index: number) { row.branches.splice(index + 1, 0, []); }
function duplicateBranch(row: any, index: number) {
  row.branches.splice(index + 1, 0, row.branches[index].map(cloneRow));
}

function moveBranch(row: any, index: number, delta: number) {
  const to = index + delta;
  if (to < 0 || to >= row.branches.length) return;
  const [item] = row.branches.splice(index, 1);
  row.branches.splice(to, 0, item);
}

// Each leaf type carries different fields; reset to the new type's defaults.
function changeType(row: any) {
  const fresh = newLeafRow(row.type);
  Object.keys(row).forEach((key) => { if (key !== 'uid' && key !== 'kind') delete row[key]; });
  Object.assign(row, fresh, { uid: row.uid });
}

function optionsFor(type: string): string[] {
  const context = NW_SCHEMA.context;
  if (type === 'toggle') return context.toggles;
  if (type === 'role') return context.roles;
  if (type === 'class') return context.classes;
  if (type === 'combatType') return context.combatTypes;
  if (type === 'location') return context.locations;
  if (type === 'damageType') return context.damageTypes;
  return [];
}

function optionsForCombo(type: string) {
  return optionsFor(type).map((o) => ({ value: o, label: o }));
}
</script>

<template>
  <div class="cond-list">
    <div v-for="(row, i) in rows" :key="row.uid" class="cond-item">
      <div v-if="row.kind === 'leaf'" class="cond-row">
        <IconButton icon="arrow-up" title="Move up" :disabled="i === 0" @click="moveRow(i, -1)" />
        <IconButton icon="arrow-down" title="Move down" :disabled="i === rows.length - 1" @click="moveRow(i, 1)" />
        <IconButton icon="copy" title="Duplicate" @click="duplicateRow(i)" />
        <IconButton icon="plus" title="Add condition" @click="insertLeaf(i)" />
        <IconButton v-if="canNest" icon="ampersand" title='Add &quot;All of&quot; condition group' @click="addGroup('all', i)" />
        <IconButton v-if="canNest" icon="split" title='Add &quot;Any of&quot; condition group' @click="addGroup('any', i)" />
        <IconButton v-if="canNest" icon="circle-alert" title='Add &quot;Not&quot; condition group' @click="addGroup('not', i)" />
        <IconButton icon="trash" title="Remove condition" @click="removeRow(i)" />

        <label class="field"><span class="field-label">Condition</span>
          <ComboBox class="combo--cond-type" :model-value="row.type" :options="typeOptions"
                    @update:model-value="v => { row.type = v; changeType(row) }" /></label>

        <template v-if="row.type === 'duration'">
          <label class="field"><span class="field-label">At least (s)</span>
            <input type="number" v-model.number="row.atLeast"></label>
          <label class="field"><span class="field-label">Below (s)</span>
            <input type="number" v-model.number="row.below"></label>
        </template>
        <template v-else-if="row.type === 'pieces'">
          <label class="field"><span class="field-label">Set</span>
            <ComboBox class="combo--set" :model-value="row.set" :options="setComboOptions"
                      placeholder="— set —" @update:model-value="v => row.set = v" /></label>
          <label class="field"><span class="field-label">At least (s)</span>
            <input type="number" v-model.number="row.atLeast"></label>
          <label class="field"><span class="field-label">Below (s)</span>
            <input type="number" v-model.number="row.below"></label>
        </template>
        <template v-else-if="row.type === 'equipped'">
          <label class="field"><span class="field-label">Tag</span>
            <input type="text" v-model="row.tag" list="nw-tags"></label>
          <label class="field"><span class="field-label">Or exact item name</span>
            <input type="text" v-model="row.item"></label>
          <label class="field"><span class="field-label">At least (s)</span>
            <input type="number" v-model.number="row.atLeast"></label>
          <label class="field"><span class="field-label">Below (s)</span>
            <input type="number" v-model.number="row.below"></label>
        </template>
        <template v-else>
          <label class="field"><span class="field-label">Value</span>
            <ComboBox v-if="optionsFor(row.type).length" class="combo--cond-value"
                      :model-value="row.value" :options="optionsForCombo(row.type)"
                      @update:model-value="v => row.value = v" />
            <input v-else type="text" v-model="row.value"></label>
        </template>
      </div>

      <div v-else class="branch-row">
        <IconButton icon="arrow-up" title="Move up" :disabled="i === 0" @click="moveRow(i, -1)" />
        <IconButton icon="arrow-down" title="Move down" :disabled="i === rows.length - 1" @click="moveRow(i, 1)" />
        <IconButton icon="copy" title="Duplicate" @click="duplicateRow(i)" />
        <IconButton icon="plus" title="Add condition" @click="insertLeaf(i)" />
        <IconButton v-if="canNest" icon="ampersand" title='Add &quot;All of&quot; condition group' @click="addGroup('all', i)" />
        <IconButton v-if="canNest" icon="split" title='Add &quot;Any of&quot; condition group' @click="addGroup('any', i)" />
        <IconButton v-if="canNest" icon="circle-alert" title='Add &quot;Not&quot; condition group' @click="addGroup('not', i)" />
        <IconButton icon="trash" title="Remove condition" @click="removeRow(i)" />

        <div class="cond-group">
          <div class="cond-group-head">
            <span class="cond-group-op">{{ opLabel(row.op) }}</span>
          </div>
          <div v-for="(branch, bi) in row.branches" :key="bi" class="cond-branch">
            <div v-if="row.op !== 'not' && bi > 0" class="cond-branch-op">
              {{ row.op === 'any' ? 'or' : 'and' }}
            </div>
            <ConditionRows :rows="branch" :depth="depth + 1" :set-ids="setIds" />
            <div v-if="row.op !== 'not'" class="cond-branch-actions">
              <span class="hint">Branch: </span>
              <IconButton icon="arrow-up" title="Move branch up" :disabled="bi === 0"
                          @click="moveBranch(row, bi, -1)" />
              <IconButton icon="arrow-down" title="Move branch down" :disabled="bi === row.branches.length - 1"
                          @click="moveBranch(row, bi, 1)" />
              <IconButton icon="copy" title="Duplicate branch" @click="duplicateBranch(row, bi)" />
              <IconButton icon="circle-plus" title="Insert branch" @click="insertBranch(row, bi)" />
              <IconButton v-if="row.branches.length > 1" icon="trash" title="Remove branch"
                          @click="removeBranch(row, bi)" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!rows.length" class="cond-add">
      <IconButton icon="plus" title="Add condition" @click="addLeaf" />
      <template v-if="canNest">
        <IconButton icon="ampersand" title='Add &quot;All of&quot; condition group' @click="addGroup('all')" />
        <IconButton icon="split" title='Add &quot;Any of&quot; condition group' @click="addGroup('any')" />
        <IconButton icon="circle-alert" title='Add &quot;Not&quot; condition group' @click="addGroup('not')" />
      </template>
    </div>
  </div>
</template>
