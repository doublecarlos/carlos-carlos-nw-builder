// The draft <-> `when` conversion for ConditionRows.vue's recursive editor, split out so
// BonusRows.vue (flat stat payloads, variants) can build and read the tree without importing
// the component.
//
// A "rows list" is the editing-side stand-in for one when-object: a flat AND of leaves and
// groups, exactly mirroring what conditions.ts's `walk()` does with an object's keys. A group's
// branches are each their own rows list, so nesting is just ConditionRows containing itself.

import type { ConditionWhen, RangeSpec } from "../types";

// Every leaf conditions.ts understands. `all`/`any`/`not` are handled structurally, not
// as leaves -- see below.
export const LEAF_TYPES = [
  "toggle",
  "proc",
  "role",
  "class",
  "combatType",
  "damageType",
  "duration",
  "pieces",
  "equipped",
  "param",
];

// Caps how many `all`/`any`/`not` groups can nest inside one another. Purely a UI guard
// against runaway trees -- conditions.ts itself has no such limit.
export const MAX_DEPTH = 5;

// A leaf's fields vary by `type` (see `leafFromSpec`/`leafToSpec`), so a flat interface
// with all possible leaf properties is simpler than a discriminated union -- each producer
// (leafFromSpec) sets just the fields its type needs, and consumers read what they care about.
export interface ConditionRow {
  uid: string;
  kind: string;
  type?: string;
  op?: string;
  branches?: ConditionRow[][];
  atLeast?: string | number | null;
  below?: string | number | null;
  set?: string;
  tag?: string;
  item?: string;
  key?: string;
  form?: "number" | "boolean" | "string";
  is?: boolean | null;
  equals?: string;
  value?: string;
  /** `proc` only -- see `ConditionWhen.proc`'s own doc comment. `procDefault: null` means
   *  "unset" (runtime default-on), distinct from an explicit `false`. */
  procLabel?: string;
  procDefault?: boolean | null;
}

const uid = () => `c${Math.random().toString(36).slice(2, 8)}`;
const fromCsv = (text: unknown): string[] =>
  String(text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// --- leaf <-> row --------------------------------------------------------------------

/** Dynamically shaped per `type` -- spec is the raw value from the `when` object.
 * Returns only the leaf-specific fields (uid/kind are added by the caller). */
function leafFromSpec(
  type: string,
  spec?: unknown,
): Omit<ConditionRow, "uid" | "kind"> {
  // spec comes from the when-object (validated by catalog.ts at load time);
  // each branch narrows spec to the shape it expects.
  if (type === "proc") {
    const s = spec as
      boolean | { label?: string; default?: boolean } | undefined;
    const obj = typeof s === "object" && s ? s : undefined;
    return {
      type,
      procLabel: obj?.label ?? "",
      procDefault: obj?.default ?? null,
    };
  }
  if (type === "duration") {
    if (typeof spec === "number") {
      return { type, atLeast: spec, below: null };
    }
    const s = spec as RangeSpec | undefined;
    return { type, atLeast: s?.atLeast ?? null, below: s?.below ?? null };
  }
  if (type === "pieces") {
    const s = spec as { set?: string; atLeast?: number } | undefined;
    return { type, set: s?.set ?? "", atLeast: s?.atLeast ?? 1 };
  }
  if (type === "equipped") {
    const s = spec as
      { tag?: string; item?: string; atLeast?: number } | undefined;
    return {
      type,
      tag: s?.tag ?? "",
      item: s?.item ?? "",
      atLeast: s?.atLeast ?? 1,
    };
  }
  if (type === "param") {
    // form picks which of the three mutually-exclusive comparisons the row shows --
    // inferred from whichever field the spec actually carries, not from looking up
    // the addressed slot's paramType (so a row for a since-renamed/removed slot
    // still round-trips instead of silently losing its comparison).
    const s = spec as
      | {
          key?: string;
          atLeast?: number;
          below?: number;
          is?: boolean;
          equals?: string | string[];
        }
      | undefined;
    let form: "number" | "boolean" | "string" = "number";
    if (s?.is !== undefined) form = "boolean";
    else if (s?.equals !== undefined) form = "string";
    return {
      type,
      key: s?.key ?? "",
      form,
      atLeast: s?.atLeast ?? null,
      below: s?.below ?? null,
      is: s?.is ?? null,
      equals: Array.isArray(s?.equals)
        ? s.equals.join(", ")
        : (s?.equals ?? ""),
    };
  }
  return {
    type,
    value: Array.isArray(spec) ? spec.join(", ") : String(spec ?? ""),
  };
}

/** Converts a draft row back into a `when`-object value for that leaf key. */
function leafToSpec(
  row: ConditionRow,
):
  | string
  | string[]
  | number
  | RangeSpec
  | ({ key: string } & Record<string, unknown>)
  | { label?: string; default?: boolean }
  | boolean
  | undefined {
  if (row.type === "proc") {
    const obj: { label?: string; default?: boolean } = {};
    if (row.procLabel) obj.label = row.procLabel;
    if (row.procDefault === true || row.procDefault === false)
      obj.default = row.procDefault;
    // Bare `true` when neither field is set -- keeps a plain proc gate's data minimal instead
    // of authoring a pointless empty `{}`.
    return Object.keys(obj).length ? obj : true;
  }
  if (row.type === "duration") {
    const range: RangeSpec = {};
    if (row.atLeast != null && row.atLeast !== "")
      range.atLeast = Number(row.atLeast);
    if (row.below != null && row.below !== "") range.below = Number(row.below);
    return Object.keys(range).length ? range : undefined;
  }
  if (row.type === "pieces") {
    return row.set
      ? { set: row.set, atLeast: Number(row.atLeast) || 1 }
      : undefined;
  }
  if (row.type === "equipped") {
    if (row.tag) return { tag: row.tag, atLeast: Number(row.atLeast) || 1 };
    if (row.item) return { item: row.item, atLeast: Number(row.atLeast) || 1 };
    return undefined;
  }
  if (row.type === "param") {
    if (!row.key) return undefined;
    if (row.form === "boolean") {
      return row.is === true || row.is === false
        ? { key: row.key, is: row.is }
        : undefined;
    }
    if (row.form === "string") {
      const values = fromCsv(row.equals);
      return values.length
        ? { key: row.key, equals: values.length === 1 ? values[0] : values }
        : undefined;
    }
    const range: { atLeast?: number; below?: number } = {};
    if (row.atLeast != null && row.atLeast !== "")
      range.atLeast = Number(row.atLeast);
    if (row.below != null && row.below !== "") range.below = Number(row.below);
    return range.atLeast !== undefined || range.below !== undefined
      ? { key: row.key, ...range }
      : undefined;
  }
  const values = fromCsv(row.value);
  if (!values.length) return undefined;
  return values.length === 1 ? values[0] : values;
}

export const newLeafRow = (type = "toggle"): ConditionRow => ({
  uid: uid(),
  kind: "leaf",
  ...leafFromSpec(type),
});

export const newGroupRow = (op = "all"): ConditionRow => ({
  uid: uid(),
  kind: "group",
  op,
  branches: op === "not" ? [[]] : [[], []],
});

/** Deep clone with fresh `uid`s throughout, so a duplicated row's Vue `:key`s never collide
 * with the original's (which would make edits on one bleed into the other). */
export function cloneRow(row: ConditionRow): ConditionRow {
  if (row.kind === "group") {
    return {
      uid: uid(),
      kind: "group",
      op: row.op,
      branches: (row.branches ?? []).map((b) => b.map(cloneRow)),
    };
  }
  return { ...row, uid: uid() };
}

// --- tree <-> when-object --------------------------------------------------------------

/** `when`-object -> rows list, one level. Each `all`/`any`/`not` recurses into its branches. */
export function whenToRows(
  when: ConditionWhen | undefined,
  depth = 0,
): ConditionRow[] {
  return Object.entries(when ?? {}).map(([key, spec]) => {
    if (key === "not") {
      return {
        uid: uid(),
        kind: "group",
        op: "not",
        branches: [whenToRows(spec as ConditionWhen, depth + 1)],
      };
    }
    if (key === "all" || key === "any") {
      return {
        uid: uid(),
        kind: "group",
        op: key,
        branches: ((spec ?? []) as ConditionWhen[]).map((w) =>
          whenToRows(w, depth + 1),
        ),
      };
    }
    return { uid: uid(), kind: "leaf", ...leafFromSpec(key, spec) };
  });
}

/**
 * Rows list -> `when`-object. Object keys are unique, so two rows that want the same key
 * (two `equipped` leaves, two sibling `any` groups, a leaf colliding with an existing key)
 * cannot both be assigned directly -- they are folded into a synthetic `all` array instead,
 * which is semantically identical (`all` just ANDs its entries) and never drops data.
 */
export function rowsToWhen(rows: ConditionRow[] | undefined): ConditionWhen {
  const buckets = new Map<string, unknown[]>();
  const push = (key: string, value: unknown) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(value);
  };

  for (const row of rows ?? []) {
    if (row.kind === "group") {
      if (row.op === "not") {
        const inner = rowsToWhen((row.branches ?? [])[0]);
        if (Object.keys(inner).length) push("not", inner);
      } else {
        const branchWhens = (row.branches ?? [])
          .map(rowsToWhen)
          .filter((w) => Object.keys(w).length);
        if (branchWhens.length) push(row.op as string, branchWhens);
      }
    } else {
      const spec = leafToSpec(row);
      if (spec !== undefined) push(row.type as string, spec);
    }
  }

  const when: ConditionWhen = {};
  const allExtra: ConditionWhen[] = [];
  for (const [key, values] of buckets) {
    if (key === "all") {
      allExtra.push(...(values.flat() as ConditionWhen[]));
      continue;
    }
    if (values.length === 1) {
      (when as Record<string, unknown>)[key] = values[0];
      continue;
    }
    allExtra.push(...(values.map((v) => ({ [key]: v })) as ConditionWhen[]));
  }
  if (allExtra.length) when.all = allExtra;
  return when;
}

/**
 * True when every leaf carries a value and every group branch is non-empty -- i.e. the tree
 * serializes without silently dropping anything. `leafToSpec`/`rowsToWhen` drop leaves with
 * no value and empty branches, so saving a half-drawn tree would come back smaller than
 * what the user drew (and the source round-trip would wipe the row from the editor). The
 * editors use this to hold off auto-saving while a condition is mid-edit.
 */
export function whenRowsComplete(rows: ConditionRow[] | undefined): boolean {
  return (rows ?? []).every(isRowComplete);
}

/** A group is complete only when every branch carries at least one complete row -- an empty
 * branch (or one holding only empty leaves) serializes to nothing via `rowsToWhen`. */
function isRowComplete(row: ConditionRow): boolean {
  if (row.kind === "group") {
    const branches = row.branches ?? [];
    return branches.length > 0 && branches.every(isBranchComplete);
  }
  return leafToSpec(row) !== undefined;
}

function isBranchComplete(branch: ConditionRow[]): boolean {
  return branch.length > 0 && branch.every(isRowComplete);
}

/** Can this `when`-object be edited by the tree, within `MAX_DEPTH` levels of nesting? */
export function whenIsRepresentable(
  when: ConditionWhen | undefined,
  depth = 0,
): boolean {
  if (when == null) return true;
  if (typeof when !== "object" || Array.isArray(when)) return false;
  if (depth >= MAX_DEPTH) return Object.keys(when).length === 0;
  return Object.entries(when).every(([key, spec]) => {
    if (key === "not")
      return whenIsRepresentable(spec as ConditionWhen, depth + 1);
    if (key === "all" || key === "any") {
      return (
        Array.isArray(spec) &&
        (spec as ConditionWhen[]).every((w) =>
          whenIsRepresentable(w, depth + 1),
        )
      );
    }
    return LEAF_TYPES.includes(key);
  });
}
