// Bonus resolution (plan §2.4).
//
// Four passes, deliberately order-independent: collect -> evaluate -> exclude -> apply.
// The sheet counted bonus instances by scanning rows *above* the current one while checking
// overrides against *all* rows, so its results could depend on slot ordering. Nothing here does.

window.NW = window.NW ?? {};
window.NW.bonus = (() => {
  'use strict';

  const { conditions } = window.NW;

  const bump = (map, key) => {
    if (key == null) return;
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  // --- pass 1: collect -------------------------------------------------------------------

  /**
   * Walk the build's slots once and gather everything a condition can read.
   *
   * Counts are per *contributing slot*, not per distinct item: two rings of a set is two
   * pieces, and the same insignia slotted twice is two pieces. Tags are counted the same way.
   * (The legacy engine deduped qualifiers by item name, but since every tag condition is
   * `atLeast: 1` that difference can never be observable.)
   */
  function collect(db, build) {
    const context = build.context ?? {};
    const equipped = new Map();
    const tags = new Map();
    const setPieces = new Map();
    const rows = [];
    const candidates = [];

    db.slots.forEach((slot, order) => {
      const choice = build.choices?.[slot.id];
      const item = db.get(choice);
      rows.push({ slotId: slot.id, slot, choice, item });
      if (!item) return;

      bump(equipped, item.name);
      for (const tag of item.tags ?? []) bump(tags, tag);
      for (const setId of item.bonuses ?? []) bump(setPieces, setId);

      for (const entry of db.bonusesFor(item)) {
        candidates.push({ ...entry, slotId: slot.id, order });
      }
    });

    const ctx = {
      class: context.class,
      role: context.role,
      combatType: context.combatType,
      location: context.location,
      damageType: context.damageType,
      duration: context.duration ?? 0,
      toggles: context.toggles ?? {},
      equipped,
      tags,
      setPieces,
    };

    return { ctx, rows, candidates };
  }

  // --- pass 2: evaluate ------------------------------------------------------------------

  /** Resolve one grant against the context into a stat payload (or none). Exactly the old
   * per-effect gate -> variants -> tiers -> stats logic, parameterised on `grant` instead of a
   * whole named effect -- a grant carries no `id`/`name` of its own. */
  function evaluateGrant(grant, ctx, explain = true) {
    const gate = explain
      ? conditions.explain(grant.when, ctx)
      : { ok: conditions.evaluate(grant.when, ctx), leaves: [], unmet: [] };

    if (!gate.ok) return { active: false, gate, stats: null, chose: null };

    // `variants`: first match wins (role-dependent payloads).
    if (grant.variants) {
      const index = grant.variants.findIndex((v) => conditions.evaluate(v.when, ctx));
      return index === -1
        ? { active: false, gate, stats: null, chose: null }
        : { active: true, gate, stats: grant.variants[index].stats, chose: `variant:${index}` };
    }

    // `tiers`: highest matching piece threshold wins. Payloads are absolute, not cumulative --
    // the legacy exact-match on piece count made them mutually exclusive.
    if (grant.tiers) {
      let best = null;
      let bestAt = -1;
      for (const tier of grant.tiers) {
        const need = tier.pieces?.atLeast ?? 1;
        if (need > bestAt && conditions.evaluate({ pieces: tier.pieces }, ctx)) {
          best = tier;
          bestAt = need;
        }
      }
      return best
        ? { active: true, gate, stats: best.stats, chose: `tier:${bestAt}` }
        : { active: false, gate, stats: null, chose: null };
    }

    return { active: true, gate, stats: grant.stats ?? {}, chose: 'stats' };
  }

  /**
   * Resolve a whole bonus set: every grant it carries, summed. A set is one unit -- its final
   * stats are the sum of every currently-active grant (plan: "bonus schema restructuring"),
   * not one independently-tracked row per grant the way effects used to be.
   */
  function evaluateBonus(set, ctx, explain = true) {
    const results = (set.grants ?? []).map((grant) => ({
      raw: grant, ...evaluateGrant(grant, ctx, explain),
    }));
    const activeResults = results.filter((r) => r.active);
    const active = activeResults.length > 0;

    const stats = {};
    for (const r of activeResults) {
      for (const [key, value] of Object.entries(r.stats ?? {})) {
        stats[key] = (stats[key] ?? 0) + value;
      }
    }

    // Only meaningful -- and only shown as a badge -- when exactly one grant is active and it
    // resolved via a tier/variant pick; two simultaneously-active grants have no single "chose"
    // to report, and a plain flat grant's "stats" chose was never shown either.
    const chose = activeResults.length === 1 && activeResults[0].chose !== 'stats'
      ? activeResults[0].chose
      : null;

    // Fully inactive: pick the grant with the fewest unmet conditions as the near-miss
    // representative (ties broken by array order) -- "what you are closest to unlocking",
    // same philosophy bonus-inspector.js already documents, just resolved per-grant now.
    let gate = { ok: true, leaves: [], unmet: [] };
    let previewStats = null;
    if (!active) {
      const best = results.reduce((a, b) => (
        (b.gate.unmet?.length ?? 0) < (a?.gate.unmet?.length ?? Infinity) ? b : a
      ), results[0]);
      gate = best?.gate ?? gate;
      previewStats = best?.raw.stats ?? null;  // only a flat grant has a raw `.stats` to preview
    }

    return { active, gate, stats: active ? stats : null, chose, previewStats, grants: results };
  }

  // --- passes 3 and 4: exclude, then apply ------------------------------------------------

  function resolve(db, build, { explain = true } = {}) {
    const { ctx, rows, candidates } = collect(db, build);

    // Group by bonus id so stacking is decided once per bonus, not once per contributing slot.
    const groups = new Map();
    for (const candidate of candidates) {
      const id = candidate.bonus.id;
      const group = groups.get(id);
      if (group) group.sources.push(candidate);
      else groups.set(id, { id, bonus: candidate.bonus, sources: [candidate] });
    }

    // Evaluate everything before applying any exclusion, so exclusion never cascades and the
    // outcome cannot depend on evaluation order.
    const evaluated = [...groups.values()].map((group) => {
      const result = evaluateBonus(group.bonus, ctx, explain);
      const sources = [...group.sources].sort((a, b) => a.order - b.order);

      let stacks = 1;
      if (group.bonus.stacking === 'perSource') {
        stacks = group.bonus.maxStacks
          ? Math.min(sources.length, group.bonus.maxStacks)
          : sources.length;
      }

      return {
        id: group.id,
        bonus: group.bonus,
        setId: sources[0].setId,
        sources: sources.map((s) => s.source),
        slotId: sources[0].slotId,      // instancing slot, used for stat attribution
        active: result.active,
        gate: result.gate,
        chose: result.chose,
        stats: result.stats,
        previewStats: result.previewStats,
        grants: result.grants,
        stacks,
        excluded: false,
        excludedBy: null,
      };
    });

    // Exclusions come from equipped items (legacy `bonus_overrides`) and from active bonuses.
    const excluded = new Map();
    for (const row of rows) {
      for (const id of row.item?.excludes ?? []) excluded.set(id, row.item.name);
    }
    for (const entry of evaluated) {
      if (!entry.active) continue;
      for (const id of entry.bonus.excludes ?? []) excluded.set(id, entry.id);
    }
    for (const entry of evaluated) {
      const by = excluded.get(entry.id);
      if (by != null && by !== entry.id) {
        entry.excluded = true;
        entry.excludedBy = by;
        entry.active = false;
      }
    }

    // Attribute each active bonus's stats back to the slot that instanced it. Multiplicative
    // stats combine per row in the pipeline, so an item and its own bonus must land on the
    // same row -- exactly as the sheet did.
    //
    // `stats` stays the per-stack payload (what the inspector should show next to "×2");
    // `appliedStats` is what actually reaches the pipeline. Keeping both explicit avoids the
    // easy mistake of reading `stats` and wondering why stacking seems not to work.
    const bonusStatsBySlot = new Map();
    for (const entry of evaluated) {
      if (!entry.active || !entry.stats) {
        entry.appliedStats = null;
        continue;
      }
      entry.appliedStats = entry.stacks === 1
        ? { ...entry.stats }
        : Object.fromEntries(
          Object.entries(entry.stats).map(([key, value]) => [key, value * entry.stacks]),
        );

      const bucket = bonusStatsBySlot.get(entry.slotId) ?? new Map();
      for (const [key, value] of Object.entries(entry.appliedStats)) {
        bucket.set(key, (bucket.get(key) ?? 0) + value);
      }
      bonusStatsBySlot.set(entry.slotId, bucket);
    }

    return { ctx, rows, bonuses: evaluated, bonusStatsBySlot };
  }

  return { resolve, collect, evaluateBonus };
})();
