// The `when` predicate evaluator (plan §2.2).
//
// A condition is plain JSON -- no eval, no regex, no strings parsed at runtime. Keys present
// are ANDed; an absent key is unconstrained; an empty or missing `when` is always true.
//
// Design rule (plan §2.2): conditions read the *build*, never the *results*. Nothing here may
// consult a computed stat or another bonus's output, which is what keeps evaluation single-pass
// and free of cycles.

import type { ConditionWhen, RangeLike, RangeSpec, EvalContext, ConditionLeafResult, ConditionExplain } from './types';

const asArray = <T,>(value: T | T[]): T[] => (Array.isArray(value) ? value : [value]);

const countOf = (map: Map<string, number> | undefined, key: string | null | undefined): number => {
  if (!map || key == null) return 0;
  return map.get(key) ?? 0;
};

/**
 * Range check shared by `duration`, `pieces` and `equipped`.
 * `{ atLeast, below }` -- either bound optional, `atLeast` inclusive, `below` exclusive.
 * A bare number is shorthand for `{ atLeast: n }`.
 */
export const inRange = (value: number, spec: RangeLike | null | undefined): boolean => {
  if (spec == null) return true;
  if (typeof spec === 'number') return value >= spec;
  if (spec.atLeast != null && value < spec.atLeast) return false;
  if (spec.below != null && value >= spec.below) return false;
  if (spec.exactly != null && value !== spec.exactly) return false;
  return true;
};

export const describeRange = (spec: RangeLike | null | undefined): string => {
  if (spec == null) return 'any';
  if (typeof spec === 'number') return `≥ ${spec}`;
  if (spec.exactly != null) return `= ${spec.exactly}`;
  if (spec.atLeast != null && spec.below != null) return `${spec.atLeast}–${spec.below}`;
  if (spec.atLeast != null) return `≥ ${spec.atLeast}`;
  if (spec.below != null) return `< ${spec.below}`;
  return 'any';
};

// --- leaf predicates -------------------------------------------------------------------
// Each returns { ok, label, detail } so the UI can explain *why* a bonus is inactive --
// "needs duration ≥ 30s (you have 10s)" rather than just a missing row.

const matchOneOf = (field: 'role' | 'class' | 'combatType' | 'location' | 'damageType', label: string) =>
  (spec: string | string[], ctx: EvalContext): ConditionLeafResult => {
    const wanted = asArray(spec);
    return {
      ok: wanted.includes(ctx[field] as string),
      label: `${label}: ${wanted.join(' or ')}`,
      detail: `you have ${ctx[field] ?? '—'}`,
    };
  };

// Dispatched dynamically by `walk` over an arbitrary `Object.entries(when)`, so the key can't
// be correlated back to its own leaf's spec type here -- each leaf function above/below is
// itself precisely typed; only this lookup table's shared signature has to fall back to `any`,
// same reasoning condition-draft.ts documents for `ConditionRow`.
const LEAVES: Record<string, (spec: any, ctx: EvalContext) => ConditionLeafResult> = {
  toggle(spec: string | string[], ctx) {
    const wanted = asArray(spec);
    const missing = wanted.filter((name) => !ctx.toggles?.[name]);
    return {
      ok: missing.length === 0,
      label: `${wanted.join(' + ')} enabled`,
      detail: missing.length ? `off: ${missing.join(', ')}` : '',
    };
  },

  role: matchOneOf('role', 'Role'),
  class: matchOneOf('class', 'Class'),
  combatType: matchOneOf('combatType', 'Combat type'),
  location: matchOneOf('location', 'Location'),
  damageType: matchOneOf('damageType', 'Damage type'),

  duration(spec: RangeLike, ctx) {
    const value = ctx.duration ?? 0;
    return {
      ok: inRange(value, spec),
      label: `duration ${describeRange(spec)}s`,
      detail: `you have ${value}s`,
    };
  },

  pieces(spec: RangeSpec & { set: string }, ctx) {
    const have = countOf(ctx.setPieces, spec.set);
    return {
      ok: inRange(have, spec),
      label: `${spec.atLeast ?? 1} piece(s) of ${spec.set}`,
      detail: `you have ${have}`,
    };
  },

  /** Reads any build_parameter by `key` (a slot's `path`) from `ctx.params`. The three
   * comparison forms are mutually exclusive -- chosen by whichever of `is`/`equals`/
   * `atLeast`+`below` the spec carries, not by looking up the slot's `paramType` (catalog.ts's
   * linter is what keeps the two in sync at data time). */
  param(spec: { key: string; atLeast?: number; below?: number; is?: boolean; equals?: string | string[] }, ctx) {
    // Fails closed on a key with no resolved value. Checked with `.has`, not a falsy `value`
    // check: a param legitimately resolving to `false`/`0`/`''` must not be treated as unknown.
    if (!ctx.params?.has(spec.key)) {
      return { ok: false, label: `param "${spec.key}"`, detail: 'unknown parameter' };
    }
    const value = ctx.params.get(spec.key);

    if (spec.is !== undefined) {
      return {
        ok: value === spec.is,
        label: `${spec.key} is ${spec.is ? 'on' : 'off'}`,
        detail: `you have ${value === undefined ? '—' : (value ? 'on' : 'off')}`,
      };
    }
    if (spec.equals !== undefined) {
      const wanted = asArray(spec.equals);
      return {
        ok: wanted.includes(value as string),
        label: `${spec.key}: ${wanted.join(' or ')}`,
        detail: `you have ${value ?? '—'}`,
      };
    }
    const numeric = typeof value === 'number' ? value : 0;
    return {
      ok: inRange(numeric, { atLeast: spec.atLeast, below: spec.below }),
      label: `${spec.key} ${describeRange({ atLeast: spec.atLeast, below: spec.below })}`,
      detail: `you have ${value ?? 0}`,
    };
  },

  // `spec.item`, when used instead of `tag`, is an item id (bonus.ts's `collect()` keys
  // `ctx.equipped` by id) -- exercised by zero shipped bonuses today, so the label below
  // showing the raw id rather than a display name (this module has no `Db` to resolve one)
  // isn't yet visible in practice.
  equipped(spec: RangeSpec & { tag?: string; item?: string }, ctx) {
    const have = spec.tag != null
      ? countOf(ctx.tags, spec.tag)
      : countOf(ctx.equipped, spec.item);
    const range = spec.atLeast != null || spec.below != null
      ? spec
      : { atLeast: 1 };
    return {
      ok: inRange(have, range),
      label: `${range.atLeast ?? 1}× ${spec.tag ?? spec.item}`,
      detail: `you have ${have}`,
    };
  },
};

// --- combinators -----------------------------------------------------------------------

/** Evaluate `when`, pushing per-leaf results into `out` when explaining. */
function walk(when: ConditionWhen | undefined, ctx: EvalContext, out: ConditionLeafResult[] | null): boolean {
  if (!when) return true;
  let ok = true;

  for (const [key, spec] of Object.entries(when)) {
    if (key === 'all') {
      for (const sub of spec as ConditionWhen[]) {
        if (!walk(sub, ctx, out)) ok = false;
      }
      continue;
    }

    if (key === 'any') {
      const branch: ConditionLeafResult[] = [];
      const alternatives = spec as ConditionWhen[];
      // Evaluate every alternative so the UI can show what each one needed.
      const results = alternatives.map((sub) => walk(sub, ctx, branch));
      const anyOk = results.some(Boolean);
      out?.push({ ok: anyOk, label: `any of ${alternatives.length}`, children: branch });
      if (!anyOk) ok = false;
      continue;
    }

    if (key === 'not') {
      const inner: ConditionLeafResult[] = [];
      const innerOk = walk(spec as ConditionWhen, ctx, inner);
      out?.push({ ok: !innerOk, label: 'not', children: inner });
      if (innerOk) ok = false;
      continue;
    }

    const leaf = LEAVES[key];
    if (!leaf) {
      // Unknown key: fail closed and say so, rather than silently granting the bonus.
      out?.push({ ok: false, label: `unknown condition "${key}"`, detail: '' });
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
export const evaluate = (when: ConditionWhen | undefined, ctx: EvalContext): boolean => walk(when, ctx, null);

/** As `evaluate`, but also returns the per-leaf breakdown for the bonus inspector. */
export function explain(when: ConditionWhen | undefined, ctx: EvalContext): ConditionExplain {
  const leaves: ConditionLeafResult[] = [];
  const ok = walk(when, ctx, leaves);
  return { ok, leaves, unmet: leaves.filter((leaf) => !leaf.ok) };
}
