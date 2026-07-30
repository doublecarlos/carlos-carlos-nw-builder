// The draft <-> `when` conversion for ConditionRows.vue's recursive editor, split out so
// BonusRows.vue (flat stat payloads, variants) can build and read the tree without importing
// the component.
//
// A "rows list" is the editing-side stand-in for one when-object: a flat AND of leaves and
// groups, exactly mirroring what conditions.ts's `walk()` does with an object's keys. A group's
// branches are each their own rows list, so nesting is just ConditionRows containing itself.

import type { ConditionWhen, RangeSpec } from './types';

// Every leaf conditions.ts understands. `all`/`any`/`not` are handled structurally, not
// as leaves -- see below.
export const LEAF_TYPES = ['toggle', 'role', 'class', 'combatType', 'location', 'damageType',
  'duration', 'pieces', 'equipped', 'param'];

// Caps how many `all`/`any`/`not` groups can nest inside one another. Purely a UI guard
// against runaway trees -- conditions.ts itself has no such limit.
export const MAX_DEPTH = 5;

// A leaf's fields vary by `type` (see `leafFromSpec`/`leafToSpec`), so this stays loose rather
// than a discriminated union per leaf type -- ConditionRows.vue just needs `branches` to type
// as an array so nested `v-for` indices don't degrade to `string | number` (a vue-tsc quirk
// when the iterated value comes from a property access on `any`).
export interface ConditionRow {
  uid: string;
  kind: string;
  type?: string;
  op?: string;
  branches?: ConditionRow[][];
  [key: string]: any;
}

const uid = () => `c${Math.random().toString(36).slice(2, 8)}`;
const fromCsv = (text: any) => String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);

// --- leaf <-> row --------------------------------------------------------------------

// Dynamically shaped per `type` (duration/pieces/equipped/everything-else each carry
// different fields) -- see ConditionRow's own comment for why this isn't a discriminated
// union. `spec` is whatever conditions.ts's `ConditionWhen` carries for that leaf key.
function leafFromSpec(type: string, spec?: any): any {
  if (type === 'duration') {
    const range = typeof spec === 'number' ? { atLeast: spec } : (spec ?? {});
    return { type, atLeast: range.atLeast ?? null, below: range.below ?? null };
  }
  if (type === 'pieces') return { type, set: spec?.set ?? '', atLeast: spec?.atLeast ?? 1 };
  if (type === 'equipped') {
    return { type, tag: spec?.tag ?? '', item: spec?.item ?? '', atLeast: spec?.atLeast ?? 1 };
  }
  if (type === 'param') {
    // `form` picks which of the three mutually-exclusive comparisons the row shows -- inferred
    // from whichever field the spec actually carries, not from looking up the addressed slot's
    // `paramType` (so a row for a since-renamed/removed slot still round-trips instead of
    // silently losing its comparison).
    let form: 'number' | 'boolean' | 'string' = 'number';
    if (spec?.is !== undefined) form = 'boolean';
    else if (spec?.equals !== undefined) form = 'string';
    return {
      type, key: spec?.key ?? '', form,
      atLeast: spec?.atLeast ?? null, below: spec?.below ?? null, is: spec?.is ?? null,
      equals: Array.isArray(spec?.equals) ? spec.equals.join(', ') : (spec?.equals ?? ''),
    };
  }
  return { type, value: Array.isArray(spec) ? spec.join(', ') : String(spec ?? '') };
}

/** Returns `undefined` for a row that is still blank -- callers skip those. */
function leafToSpec(row: ConditionRow): any {
  if (row.type === 'duration') {
    const range: RangeSpec = {};
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
  if (row.type === 'param') {
    if (!row.key) return undefined;
    if (row.form === 'boolean') {
      return row.is === true || row.is === false ? { key: row.key, is: row.is } : undefined;
    }
    if (row.form === 'string') {
      const values = fromCsv(row.equals);
      return values.length ? { key: row.key, equals: values.length === 1 ? values[0] : values } : undefined;
    }
    const range: { atLeast?: number; below?: number } = {};
    if (row.atLeast != null && row.atLeast !== '') range.atLeast = Number(row.atLeast);
    if (row.below != null && row.below !== '') range.below = Number(row.below);
    return range.atLeast !== undefined || range.below !== undefined ? { key: row.key, ...range } : undefined;
  }
  const values = fromCsv(row.value);
  if (!values.length) return undefined;
  return values.length === 1 ? values[0] : values;
}

export const newLeafRow = (type = 'toggle'): ConditionRow => ({ uid: uid(), kind: 'leaf', ...leafFromSpec(type) });

export const newGroupRow = (op = 'all'): ConditionRow => ({
  uid: uid(),
  kind: 'group',
  op,
  branches: op === 'not' ? [[]] : [[], []],
});

/** Deep clone with fresh `uid`s throughout, so a duplicated row's Vue `:key`s never collide
 * with the original's (which would make edits on one bleed into the other). */
export function cloneRow(row: ConditionRow): ConditionRow {
  if (row.kind === 'group') {
    return { uid: uid(), kind: 'group', op: row.op, branches: (row.branches ?? []).map((b) => b.map(cloneRow)) };
  }
  return { ...row, uid: uid() };
}

// --- tree <-> when-object --------------------------------------------------------------

/** `when`-object -> rows list, one level. Each `all`/`any`/`not` recurses into its branches. */
export function whenToRows(when: ConditionWhen | undefined, depth = 0): ConditionRow[] {
  return Object.entries(when ?? {}).map(([key, spec]) => {
    if (key === 'not') {
      return { uid: uid(), kind: 'group', op: 'not', branches: [whenToRows(spec as ConditionWhen, depth + 1)] };
    }
    if (key === 'all' || key === 'any') {
      return {
        uid: uid(),
        kind: 'group',
        op: key,
        branches: ((spec ?? []) as ConditionWhen[]).map((w) => whenToRows(w, depth + 1)),
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
export function rowsToWhen(rows: ConditionRow[] | undefined): ConditionWhen {
  const buckets = new Map<string, any[]>();
  const push = (key: string, value: any) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(value);
  };

  for (const row of rows ?? []) {
    if (row.kind === 'group') {
      if (row.op === 'not') {
        const inner = rowsToWhen((row.branches ?? [])[0]);
        if (Object.keys(inner).length) push('not', inner);
      } else {
        const branchWhens = (row.branches ?? []).map(rowsToWhen).filter((w) => Object.keys(w).length);
        if (branchWhens.length) push(row.op as string, branchWhens);
      }
    } else {
      const spec = leafToSpec(row);
      if (spec !== undefined) push(row.type as string, spec);
    }
  }

  const when: ConditionWhen = {};
  const allExtra: any[] = [];
  for (const [key, values] of buckets) {
    if (key === 'all') { allExtra.push(...values.flat()); continue; }
    if (values.length === 1) { (when as any)[key] = values[0]; continue; }
    allExtra.push(...values.map((v) => ({ [key]: v })));
  }
  if (allExtra.length) when.all = allExtra;
  return when;
}

/** Can this `when`-object be edited by the tree, within `MAX_DEPTH` levels of nesting? */
export function whenIsRepresentable(when: ConditionWhen | undefined, depth = 0): boolean {
  if (when == null) return true;
  if (typeof when !== 'object' || Array.isArray(when)) return false;
  if (depth >= MAX_DEPTH) return Object.keys(when).length === 0;
  return Object.entries(when).every(([key, spec]) => {
    if (key === 'not') return whenIsRepresentable(spec as ConditionWhen, depth + 1);
    if (key === 'all' || key === 'any') {
      return Array.isArray(spec) && (spec as ConditionWhen[]).every((w) => whenIsRepresentable(w, depth + 1));
    }
    return LEAF_TYPES.includes(key);
  });
}
