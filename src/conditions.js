// The `when` predicate evaluator (plan §2.2).
//
// A condition is plain JSON -- no eval, no regex, no strings parsed at runtime. Keys present
// are ANDed; an absent key is unconstrained; an empty or missing `when` is always true.
//
// Design rule (plan §2.2): conditions read the *build*, never the *results*. Nothing here may
// consult a computed stat or another bonus's output, which is what keeps evaluation single-pass
// and free of cycles.
//
// Loaded as a classic script -- no ES modules, so the app still runs from file://.

window.NW = window.NW ?? {};
window.NW.conditions = (() => {
  'use strict';

  const asArray = (value) => (Array.isArray(value) ? value : [value]);

  const countOf = (map, key) => {
    if (!map || key == null) return 0;
    return map instanceof Map ? (map.get(key) ?? 0) : (map[key] ?? 0);
  };

  /**
   * Range check shared by `duration`, `pieces` and `equipped`.
   * `{ atLeast, below }` -- either bound optional, `atLeast` inclusive, `below` exclusive.
   * A bare number is shorthand for `{ atLeast: n }`.
   */
  const inRange = (value, spec) => {
    if (spec == null) return true;
    if (typeof spec === 'number') return value >= spec;
    if (spec.atLeast != null && value < spec.atLeast) return false;
    if (spec.below != null && value >= spec.below) return false;
    if (spec.exactly != null && value !== spec.exactly) return false;
    return true;
  };

  const describeRange = (spec) => {
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

  const matchOneOf = (field, label) => (spec, ctx) => {
    const wanted = asArray(spec);
    return {
      ok: wanted.includes(ctx[field]),
      label: `${label}: ${wanted.join(' or ')}`,
      detail: `you have ${ctx[field] ?? '—'}`,
    };
  };

  const LEAVES = {
    toggle(spec, ctx) {
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

    duration(spec, ctx) {
      const value = ctx.duration ?? 0;
      return {
        ok: inRange(value, spec),
        label: `duration ${describeRange(spec)}s`,
        detail: `you have ${value}s`,
      };
    },

    pieces(spec, ctx) {
      const have = countOf(ctx.setPieces, spec.set);
      return {
        ok: inRange(have, spec),
        label: `${spec.atLeast ?? 1} piece(s) of ${spec.set}`,
        detail: `you have ${have}`,
      };
    },

    equipped(spec, ctx) {
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
  function walk(when, ctx, out) {
    if (!when) return true;
    let ok = true;

    for (const [key, spec] of Object.entries(when)) {
      if (key === 'all') {
        for (const sub of spec) {
          if (!walk(sub, ctx, out)) ok = false;
        }
        continue;
      }

      if (key === 'any') {
        const branch = [];
        // Evaluate every alternative so the UI can show what each one needed.
        const results = spec.map((sub) => walk(sub, ctx, branch));
        const anyOk = results.some(Boolean);
        out?.push({ ok: anyOk, label: `any of ${spec.length}`, children: branch });
        if (!anyOk) ok = false;
        continue;
      }

      if (key === 'not') {
        const inner = [];
        const innerOk = walk(spec, ctx, inner);
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

  return {
    /** True when every leaf of `when` holds against `ctx`. */
    evaluate: (when, ctx) => walk(when, ctx, null),

    /** As `evaluate`, but also returns the per-leaf breakdown for the bonus inspector. */
    explain(when, ctx) {
      const leaves = [];
      const ok = walk(when, ctx, leaves);
      return { ok, leaves, unmet: leaves.filter((leaf) => !leaf.ok) };
    },

    inRange,
    describeRange,
  };
})();
