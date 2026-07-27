// Recursive editor for a `when` predicate tree (conditions.js) -- leaves plus `all`/`any`/`not`
// groups, nested up to `MAX_DEPTH` levels. A "rows list" (this component's `rows` prop) is the
// editing-side stand-in for one when-object: a flat AND of leaves and groups, exactly mirroring
// what `conditions.js` `walk()` does with an object's keys. A group's branches are each their
// own rows list, so nesting is just this component containing itself.
//
// The draft <-> `when` conversion lives on `window.NW.conditionDraft` so bonus-rows.js (flat
// stat payloads, variants) can build and read the tree without importing the component.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.conditionDraft = (() => {
  'use strict';

  // Every leaf `conditions.js` understands. `all`/`any`/`not` are handled structurally, not
  // as leaves -- see below.
  const LEAF_TYPES = ['toggle', 'role', 'class', 'combatType', 'location', 'damageType',
    'duration', 'pieces', 'equipped'];

  // Caps how many `all`/`any`/`not` groups can nest inside one another. Purely a UI guard
  // against runaway trees -- `conditions.js` itself has no such limit.
  const MAX_DEPTH = 5;

  const uid = () => `c${Math.random().toString(36).slice(2, 8)}`;
  const fromCsv = (text) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  // --- leaf <-> row --------------------------------------------------------------------

  function leafFromSpec(type, spec) {
    if (type === 'duration') {
      const range = typeof spec === 'number' ? { atLeast: spec } : (spec ?? {});
      return { type, atLeast: range.atLeast ?? null, below: range.below ?? null };
    }
    if (type === 'pieces') return { type, set: spec?.set ?? '', atLeast: spec?.atLeast ?? 1 };
    if (type === 'equipped') {
      return { type, tag: spec?.tag ?? '', item: spec?.item ?? '', atLeast: spec?.atLeast ?? 1 };
    }
    return { type, value: Array.isArray(spec) ? spec.join(', ') : String(spec ?? '') };
  }

  /** Returns `undefined` for a row that is still blank -- callers skip those. */
  function leafToSpec(row) {
    if (row.type === 'duration') {
      const range = {};
      if (row.atLeast != null && row.atLeast !== '') range.atLeast = Number(row.atLeast);
      if (row.below != null && row.below !== '') range.below = Number(row.below);
      return Object.keys(range).length ? range : undefined;
    }
    if (row.type === 'pieces') {
      return row.set ? { set: row.set, atLeast: Number(row.atLeast) || 1 } : undefined;
    }
    if (row.type === 'equipped') {
      if (row.tag) return { tag: row.tag, atLeast: Number(row.atLeast) || 1 };
      if (row.item) return { item: row.item, atLeast: Number(row.atLeast) || 1 };
      return undefined;
    }
    const values = fromCsv(row.value);
    if (!values.length) return undefined;
    return values.length === 1 ? values[0] : values;
  }

  const newLeafRow = (type = 'toggle') => ({ uid: uid(), kind: 'leaf', ...leafFromSpec(type) });

  const newGroupRow = (op = 'all') => ({
    uid: uid(),
    kind: 'group',
    op,
    branches: op === 'not' ? [[]] : [[], []],
  });

  /** Deep clone with fresh `uid`s throughout, so a duplicated row's Vue `:key`s never collide
   * with the original's (which would make edits on one bleed into the other). */
  function cloneRow(row) {
    if (row.kind === 'group') {
      return { uid: uid(), kind: 'group', op: row.op, branches: row.branches.map((b) => b.map(cloneRow)) };
    }
    return { ...row, uid: uid() };
  }

  // --- tree <-> when-object --------------------------------------------------------------

  /** `when`-object -> rows list, one level. Each `all`/`any`/`not` recurses into its branches. */
  function whenToRows(when, depth = 0) {
    return Object.entries(when ?? {}).map(([key, spec]) => {
      if (key === 'not') {
        return { uid: uid(), kind: 'group', op: 'not', branches: [whenToRows(spec, depth + 1)] };
      }
      if (key === 'all' || key === 'any') {
        return {
          uid: uid(),
          kind: 'group',
          op: key,
          branches: (spec ?? []).map((w) => whenToRows(w, depth + 1)),
        };
      }
      return { uid: uid(), kind: 'leaf', ...leafFromSpec(key, spec) };
    });
  }

  /**
   * Rows list -> `when`-object. Object keys are unique, so two rows that want the same key
   * (two `equipped` leaves, two sibling `any` groups, a leaf colliding with an existing key)
   * cannot both be assigned directly -- they are folded into a synthetic `all` array instead,
   * which is semantically identical (`all` just ANDs its entries) and never drops data.
   */
  function rowsToWhen(rows) {
    const buckets = new Map();
    const push = (key, value) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(value);
    };

    for (const row of rows ?? []) {
      if (row.kind === 'group') {
        if (row.op === 'not') {
          const inner = rowsToWhen(row.branches[0]);
          if (Object.keys(inner).length) push('not', inner);
        } else {
          const branchWhens = row.branches.map(rowsToWhen).filter((w) => Object.keys(w).length);
          if (branchWhens.length) push(row.op, branchWhens);
        }
      } else {
        const spec = leafToSpec(row);
        if (spec !== undefined) push(row.type, spec);
      }
    }

    const when = {};
    const allExtra = [];
    for (const [key, values] of buckets) {
      if (key === 'all') { allExtra.push(...values.flat()); continue; }
      if (values.length === 1) { when[key] = values[0]; continue; }
      allExtra.push(...values.map((v) => ({ [key]: v })));
    }
    if (allExtra.length) when.all = allExtra;
    return when;
  }

  /** Can this `when`-object be edited by the tree, within `MAX_DEPTH` levels of nesting? */
  function whenIsRepresentable(when, depth = 0) {
    if (when == null) return true;
    if (typeof when !== 'object' || Array.isArray(when)) return false;
    if (depth >= MAX_DEPTH) return Object.keys(when).length === 0;
    return Object.entries(when).every(([key, spec]) => {
      if (key === 'not') return whenIsRepresentable(spec, depth + 1);
      if (key === 'all' || key === 'any') {
        return Array.isArray(spec) && spec.every((w) => whenIsRepresentable(w, depth + 1));
      }
      return LEAF_TYPES.includes(key);
    });
  }

  return {
    LEAF_TYPES, MAX_DEPTH,
    newLeafRow, newGroupRow, cloneRow,
    whenToRows, rowsToWhen, whenIsRepresentable,
  };
})();

window.NW.components.ConditionRows = (() => {
  'use strict';

  const cd = () => window.NW.conditionDraft;

  const ConditionRows = {
    name: 'ConditionRows',

    components: {
      ComboBox: window.NW.components.ComboBox,
      IconButton: window.NW.components.IconButton,
    },

    props: {
      // Mutated in place -- same convention as BonusRows' `rows` prop.
      rows: { type: Array, required: true },
      depth: { type: Number, default: 0 },
      setIds: { type: Array, default: () => [] },
    },

    computed: {
      maxNestDepth: () => cd().MAX_DEPTH - 1,
      canNest() { return this.depth < this.maxNestDepth; },
      typeOptions: () => cd().LEAF_TYPES.map((t) => ({ value: t, label: t })),
      setComboOptions() { return this.setIds.map((s) => ({ value: s, label: s })); },
    },

    methods: {
      opLabel(op) {
        if (op === 'not') return 'not';
        return op === 'any' ? 'any of' : 'all of';
      },

      addLeaf() { this.rows.push(cd().newLeafRow()); },
      addGroup(op, index) {
        const insertIndex = (index === undefined || index === null) ? this.rows.length : index + 1;
        this.rows.splice(insertIndex, 0, cd().newGroupRow(op));
      },
      removeRow(index) { this.rows.splice(index, 1); },
      insertLeaf(index) { this.rows.splice(index + 1, 0, cd().newLeafRow()); },
      duplicateRow(index) { this.rows.splice(index + 1, 0, cd().cloneRow(this.rows[index])); },

      moveRow(index, delta) {
        const to = index + delta;
        if (to < 0 || to >= this.rows.length) return;
        const [item] = this.rows.splice(index, 1);
        this.rows.splice(to, 0, item);
      },

      addBranch(row) { row.branches.push([]); },
      removeBranch(row, index) { row.branches.splice(index, 1); },
      insertBranch(row, index) { row.branches.splice(index + 1, 0, []); },
      duplicateBranch(row, index) {
        row.branches.splice(index + 1, 0, row.branches[index].map(cd().cloneRow));
      },

      moveBranch(row, index, delta) {
        const to = index + delta;
        if (to < 0 || to >= row.branches.length) return;
        const [item] = row.branches.splice(index, 1);
        row.branches.splice(to, 0, item);
      },

      // Each leaf type carries different fields; reset to the new type's defaults.
      changeType(row) {
        const fresh = cd().newLeafRow(row.type);
        Object.keys(row).forEach((key) => { if (key !== 'uid' && key !== 'kind') delete row[key]; });
        Object.assign(row, fresh, { uid: row.uid });
      },

      optionsFor(type) {
        const context = window.NW_SCHEMA.context;
        if (type === 'toggle') return context.toggles;
        if (type === 'role') return context.roles;
        if (type === 'class') return context.classes;
        if (type === 'combatType') return context.combatTypes;
        if (type === 'location') return context.locations;
        if (type === 'damageType') return context.damageTypes;
        return [];
      },

      optionsForCombo(type) {
        return this.optionsFor(type).map((o) => ({ value: o, label: o }));
      },
    },

    template: `
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
              <label class="field"><span class="field-label">Pieces</span>
                <input type="number" min="1" v-model.number="row.atLeast"></label>
            </template>
            <template v-else-if="row.type === 'equipped'">
              <label class="field"><span class="field-label">Tag</span>
                <input type="text" v-model="row.tag" list="nw-tags"></label>
              <label class="field"><span class="field-label">Or exact item name</span>
                <input type="text" v-model="row.item"></label>
              <label class="field"><span class="field-label">Count</span>
                <input type="number" v-model.number="row.atLeast"></label>
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
    `,
  };

  // Self-registration: this build has no global component registry (each component lists its
  // own children), so a recursive component must include itself under its own `components`.
  ConditionRows.components.ConditionRows = ConditionRows;
  return ConditionRows;
})();
