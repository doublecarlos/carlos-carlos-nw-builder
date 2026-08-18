// The `when` predicate evaluator.
//
// A condition is plain JSON -- no eval, no regex, no strings parsed at runtime. Keys present
// are ANDed; an absent key is unconstrained; an empty or missing `when` is always true.
//
// Design rule: conditions read the *build*, never the *results*. Nothing here may
// consult a computed stat or another bonus's output, which is what keeps evaluation single-pass
// and free of cycles.

import type {
  ConditionWhen,
  RangeLike,
  RangeSpec,
  EvalContext,
  ConditionLeafResult,
  ConditionExplain,
  ParamCondition,
} from "../types";

const asArray = <T>(value: T | T[]): T[] =>
  Array.isArray(value) ? value : [value];

const countOf = (
  map: Map<string, number> | undefined,
  key: string | null | undefined,
): number => {
  if (!map || key == null) return 0;
  return map.get(key) ?? 0;
};

/**
 * Range check shared by `duration`, `bonusOccurrences` and `equipped`.
 * `{ atLeast, below }` -- either bound optional, `atLeast` inclusive, `below` exclusive.
 * A bare number is shorthand for `{ atLeast: n }`.
 */
export const inRange = (
  value: number,
  spec: RangeLike | null | undefined,
): boolean => {
  if (spec == null) return true;
  if (typeof spec === "number") return value >= spec;
  if (spec.atLeast != null && value < spec.atLeast) return false;
  if (spec.below != null && value >= spec.below) return false;
  if (spec.exactly != null && value !== spec.exactly) return false;
  return true;
};

export const describeRange = (spec: RangeLike | null | undefined): string => {
  if (spec == null) return "any";
  if (typeof spec === "number") return `≥ ${spec}`;
  if (spec.exactly != null) return `= ${spec.exactly}`;
  if (spec.atLeast != null && spec.below != null)
    return `${spec.atLeast}–${spec.below}`;
  if (spec.atLeast != null) return `≥ ${spec.atLeast}`;
  if (spec.below != null) return `< ${spec.below}`;
  return "any";
};

// --- leaf predicates -------------------------------------------------------------------
// Each returns { ok, label, detail } so the UI can explain *why* a bonus is inactive --
// "needs duration ≥ 30s (you have 10s)" rather than just a missing row.

const matchOneOf =
  (field: "role" | "class" | "damageType", label: string) =>
  (spec: string | string[], ctx: EvalContext): ConditionLeafResult => {
    const wanted = asArray(spec);
    return {
      ok: wanted.includes(ctx[field] as string),
      label: `${label}: ${wanted.join(" or ")}`,
      detail: `you have ${ctx[field] ?? "—"}`,
    };
  };

// Dispatched dynamically by `walk`, so the key can't be correlated to its own
// leaf's spec type -- each handler narrows `spec` from `unknown` to the shape
// it expects. The spec values come directly from ConditionWhen, validated by
// catalog.ts's linter at data-load time.
const LEAVES: Record<
  string,
  (spec: unknown, ctx: EvalContext) => ConditionLeafResult
> = {
  toggle(spec, ctx) {
    const wanted = asArray(spec as string | string[]);
    const missing = wanted.filter((name) => !ctx.toggles?.[name]);
    return {
      ok: missing.length === 0,
      label: `${wanted.join(" + ")} enabled`,
      detail: missing.length ? `off: ${missing.join(", ")}` : "",
    };
  },

  role(spec, ctx) {
    return matchOneOf("role", "Role")(spec as string | string[], ctx);
  },
  class(spec, ctx) {
    return matchOneOf("class", "Class")(spec as string | string[], ctx);
  },
  damageType(spec, ctx) {
    return matchOneOf("damageType", "Damage type")(
      spec as string | string[],
      ctx,
    );
  },

  duration(spec, ctx) {
    const s = spec as RangeLike;
    const value = ctx.duration ?? 0;
    return {
      ok: inRange(value, s),
      label: `duration ${describeRange(s)}s`,
      detail: `you have ${value}s`,
    };
  },

  enemies(spec, ctx) {
    const s = spec as RangeLike;
    const value = ctx.enemies ?? 0;
    return {
      ok: inRange(value, s),
      label: `enemies ${describeRange(s)}`,
      detail: `you have ${value}`,
    };
  },

  bonusOccurrences(spec, ctx) {
    const s = spec as RangeSpec & { bonus: string };
    const have = countOf(ctx.bonusOccurrences, s.bonus);
    const displayName = ctx.bonusNames?.get(s.bonus) ?? s.bonus;
    return {
      ok: inRange(have, s),
      label: `${s.exactly ?? s.atLeast ?? 1} occurrence(s) of ${displayName}`,
      detail: `you have ${have}`,
    };
  },

  /** Reads any build_parameter by `key` (a slot's `path`) from `ctx.params`. The three
   * comparison forms are mutually exclusive -- chosen by whichever of `is`/`equals`/
   * `atLeast`+`below`+`exactly` the spec carries, not by looking up the slot's `paramType`
   * (catalog.ts's linter is what keeps the two in sync at data time). */
  param(spec, ctx) {
    const s = spec as ParamCondition;
    // Fails closed on a key with no resolved value. Checked with `.has`, not a falsy `value`
    // check: a param legitimately resolving to `false`/`0`/`''` must not be treated as unknown.
    if (!ctx.params?.has(s.key)) {
      return {
        ok: false,
        label: `param "${s.key}"`,
        detail: "unknown parameter",
      };
    }
    const value = ctx.params.get(s.key);

    if (s.is !== undefined) {
      return {
        ok: value === s.is,
        label: `${s.key} is ${s.is ? "on" : "off"}`,
        detail: `you have ${value === undefined ? "—" : value ? "on" : "off"}`,
      };
    }
    if (s.equals !== undefined) {
      const wanted = asArray(s.equals);
      return {
        ok: wanted.includes(value as string),
        label: `${s.key}: ${wanted.join(" or ")}`,
        detail: `you have ${value ?? "—"}`,
      };
    }
    const numeric = typeof value === "number" ? value : 0;
    const range = { atLeast: s.atLeast, below: s.below, exactly: s.exactly };
    return {
      ok: inRange(numeric, range),
      label: `${s.key} ${describeRange(range)}`,
      detail: `you have ${value ?? 0}`,
    };
  },

  // `spec.item`, when used instead of `tag`, is an item id (bonus.ts's `collect()` keys
  // `ctx.equipped` by id) -- the label below shows the raw id rather than a display name
  // since this module has no `Db` to resolve one.
  equipped(spec, ctx) {
    const s = spec as RangeSpec & { tag?: string; item?: string };
    const have =
      s.tag != null ? countOf(ctx.tags, s.tag) : countOf(ctx.equipped, s.item);
    const range =
      s.atLeast != null || s.below != null || s.exactly != null
        ? s
        : { atLeast: 1 };
    return {
      ok: inRange(have, range),
      label: `${range.exactly ?? range.atLeast ?? 1}× ${s.tag ?? s.item}`,
      detail: `you have ${have}`,
    };
  },
};

// --- inline summary text ---------------------------------------------------------------
// `any`/`not` also have to read as one self-contained line, because the two places that
// summarise a gate (the item card's "Conditions: ..." line and the "needs ..." list) render
// `label` alone and never descend into `children`. So each compound builds its text out of
// its own children's labels, and falls back to a bounded phrase -- deferring to the
// expandable tree -- once that text would get long or deeply nested.

/** Past this many nested compounds, a compound stops spelling its children out. */
const MAX_INLINE_DEPTH = 2;
/** Past this many characters, likewise -- one summary line must not run away. */
const MAX_INLINE_LENGTH = 72;

/** Leaves whose label is an `or`-joined phrase, which has to be parenthesised before it can
 * sit inside a wider phrase (`not (a or b)`, not `not a or b`). Tracked here rather than on
 * the result, so the `ConditionLeafResult` shape the UI renders verbatim stays unchanged. */
const orPhrases = new WeakSet<ConditionLeafResult>();

/** Sibling leaves are ANDed; the whole thing is parenthesised when more than one has to sit
 * inside a wider `or`/`not` phrase. */
const conjoin = (leaves: ConditionLeafResult[]): string => {
  const parts = leaves
    .filter((leaf) => leaf.label)
    .map((leaf) => (orPhrases.has(leaf) ? `(${leaf.label})` : leaf.label));
  if (!parts.length) return "";
  return parts.length > 1 ? `(${parts.join(" + ")})` : parts[0];
};

const tooBig = (text: string, depth: number) =>
  depth >= MAX_INLINE_DEPTH || text.length > MAX_INLINE_LENGTH;

/** Text for `not`: the negation of what it negates. A single child always spells itself out
 * (its own label is already self-contained and bounded); a group defers once it gets big. */
function describeNot(inner: ConditionLeafResult[], depth: number): string {
  const text = conjoin(inner);
  if (!text) return "never"; // not(nothing constrained) -- vacuously unsatisfiable
  if (inner.length > 1 && tooBig(text, depth))
    return `not (${inner.length} conditions)`;
  return `not ${text}`;
}

/** Text for `any`: name the alternatives, or count them when that would run long. `joined`
 * reports which of the two it is, since only the joined form needs parenthesising above. */
function describeAny(
  alternatives: string[],
  depth: number,
): { label: string; joined: boolean } {
  const joined = alternatives.map((text) => text || "always").join(" or ");
  if (tooBig(joined, depth))
    return { label: `any of ${alternatives.length}`, joined: false };
  return { label: joined, joined: alternatives.length > 1 };
}

// --- combinators -----------------------------------------------------------------------

/** Evaluate `when`, pushing per-leaf results into `out` when explaining. `depth` counts the
 * compounds already entered, and only shapes the summary text -- never the verdict. */
function walk(
  when: ConditionWhen | undefined,
  ctx: EvalContext,
  out: ConditionLeafResult[] | null,
  depth = 0,
): boolean {
  if (!when) return true;
  let ok = true;

  for (const [key, spec] of Object.entries(when)) {
    if (key === "all") {
      // No wrapper leaf of its own: `all` flattens into the surrounding conjunction, which
      // is exactly how both summaries already join siblings.
      for (const sub of spec as ConditionWhen[]) {
        if (!walk(sub, ctx, out, depth)) ok = false;
      }
      continue;
    }

    if (key === "any") {
      const alternatives = spec as ConditionWhen[];
      const branch: ConditionLeafResult[] = [];
      const texts: string[] = [];
      let anyOk = false;
      // Evaluate every alternative so the UI can show what each one needed. Each gets its
      // own array first, so the summary can tell "a AND b" (one alternative) apart from two
      // alternatives, then flattens into the shared `children` tree.
      for (const sub of alternatives) {
        const own: ConditionLeafResult[] = [];
        if (walk(sub, ctx, out ? own : null, depth + 1)) anyOk = true;
        texts.push(conjoin(own));
        branch.push(...own);
      }
      if (out) {
        const summary = describeAny(texts, depth);
        const result: ConditionLeafResult = {
          ok: anyOk,
          label: summary.label,
          children: branch,
        };
        if (summary.joined) orPhrases.add(result);
        out.push(result);
      }
      if (!anyOk) ok = false;
      continue;
    }

    if (key === "not") {
      const inner: ConditionLeafResult[] = [];
      const innerOk = walk(
        spec as ConditionWhen,
        ctx,
        out ? inner : null,
        depth + 1,
      );
      out?.push({
        ok: !innerOk,
        label: describeNot(inner, depth),
        children: inner,
      });
      if (innerOk) ok = false;
      continue;
    }

    const leaf = LEAVES[key];
    if (!leaf) {
      // Unknown key: fail closed and say so, rather than silently granting the bonus.
      out?.push({ ok: false, label: `unknown condition "${key}"`, detail: "" });
      ok = false;
      continue;
    }

    const result = leaf(spec, ctx);
    out?.push(result);
    if (!result.ok) ok = false;
  }

  return ok;
}

/** True when every leaf of `when` holds against `ctx`. */
export const evaluate = (
  when: ConditionWhen | undefined,
  ctx: EvalContext,
): boolean => walk(when, ctx, null);

/** As `evaluate`, but also returns the per-leaf breakdown for the bonus inspector. */
export function explain(
  when: ConditionWhen | undefined,
  ctx: EvalContext,
): ConditionExplain {
  const leaves: ConditionLeafResult[] = [];
  const ok = walk(when, ctx, leaves);
  return { ok, leaves, unmet: leaves.filter((leaf) => !leaf.ok) };
}
