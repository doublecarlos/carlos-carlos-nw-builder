// The calculation pipeline and derived outputs.
//
// Every intermediate stage is kept, which is what makes the "why is my Power that number?"
// inspector possible -- something the spreadsheet cannot do.
//
// Deviations from the sheet are marked `FIX #n` and justified in the issue tracker. None changes a
// number on current data except where the sheet was demonstrably wrong.

import * as bonus from "./bonus";
import type {
  Db,
  Build,
  BuildContext,
  Item,
  StatKey,
  ResolvedBonuses,
  EngineRow,
  Stages,
  DerivedOutputs,
  EngineError,
  ResolvedBuild,
} from "../types";

const zeros = (keys: StatKey[]) => {
  const out: Record<StatKey, number> = {};
  for (const key of keys) out[key] = 0;
  return out;
};

const addVectors = (
  a: Record<StatKey, number>,
  b: Record<StatKey, number>,
  keys: StatKey[],
) => {
  const out: Record<StatKey, number> = {};
  for (const key of keys) out[key] = (a[key] ?? 0) + (b[key] ?? 0);
  return out;
};

const averageByChance = (multiplier: number, chance: number) =>
  chance * multiplier + (1 - chance);

/**
 * Spreadsheet `ROUND()` semantics: half away from zero.
 *
 * Not plain `Math.round`, which rounds half toward +infinity (`Math.round(-12.5) === -12`
 * where the sheet gives -13). Only differs on exact half boundaries, which the forte
 * redistribution lands on occasionally.
 */
const sheetRound = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
};

/**
 * Per-slot stat vectors: the item's own stats plus the bonuses attributed to that slot.
 * Kept as rows because multiplicative stats combine per row, not per source.
 */
function rowVectors(resolved: ResolvedBonuses, keys: StatKey[]): EngineRow[] {
  return resolved.rows.map((row) => {
    const stats = zeros(keys);
    if (row.item) {
      for (const key of keys) {
        if (row.item[key]) stats[key] = row.item[key] as number;
      }
    }
    // A point_assignment row has no single item to read stats off of -- its assignments'
    // items, scaled by count, were already summed by bonus.ts's collect() into this map.
    const assignmentStats = resolved.assignmentStatsBySlot.get(row.slotId);
    if (assignmentStats) {
      for (const [key, value] of assignmentStats)
        stats[key] = (stats[key] ?? 0) + value;
    }
    const bonusStats = resolved.bonusStatsBySlot.get(row.slotId);
    if (bonusStats) {
      for (const [key, value] of bonusStats)
        stats[key] = (stats[key] ?? 0) + value;
    }
    return { slotId: row.slotId, choice: row.choice, item: row.item, stats };
  });
}

function run(
  db: Db,
  build: Build,
  resolved: ResolvedBonuses,
): { rows: EngineRow[]; stages: Stages } {
  const { schema } = db;
  const keys: StatKey[] = schema.statKeys;
  const context = build.context ?? {};
  const multiplicative = new Set(schema.multiplicativeStats);
  const rows = rowVectors(resolved, keys);

  // --- stage 1: initial sums -----------------------------------------------------------
  const sums = zeros(keys);
  const products = new Map<string, number>(
    schema.multiplicativeStats.map((key) => [key, 1]),
  );

  for (const row of rows) {
    for (const key of keys) {
      const value = row.stats[key] ?? 0;
      if (multiplicative.has(key))
        products.set(key, (products.get(key) as number) * (1 + value));
      else sums[key] += value;
    }
  }
  for (const [key, product] of products) sums[key] = product - 1;

  // --- stage 2: dynamic weapon modification --------------------------------------------
  // FIX #6: the sheet matched the target stat by searching the item's *display name*. The
  // item now declares `dynamicStat` outright, so renaming one cannot silently move the value.
  //
  // The declared range is NOT clamped here. Silently rewriting a number the user typed is
  // worse than showing it and flagging it -- and it would make the engine disagree with the
  // sheet for no stated reason. `findErrors` reports out-of-range values instead.
  const weaponMods = zeros(keys);
  for (const row of rows) {
    const stat = row.item?.dynamicStat;
    if (!stat) continue;
    const typed = build.values?.[row.slotId];
    if (typed == null) continue;
    weaponMods[stat] += Number(typed) || 0;
  }
  const afterWeaponMods = addVectors(sums, weaponMods, keys);

  // --- stage 3: combined rating --------------------------------------------------------
  const afterCombinedRating: Record<StatKey, number> = { ...afterWeaponMods };
  for (const key of schema.ratingStats) {
    afterCombinedRating[key] += sums.combined_rating;
  }

  // --- stage 4: rating -> percent ------------------------------------------------------
  const itemLevel = afterCombinedRating.il;
  const ratingPct = zeros(keys);
  for (const rule of schema.ratingConversion) {
    const shortfall = Math.max(
      itemLevel + rule.allowedOver - afterCombinedRating[rule.rating],
      0,
    );
    ratingPct[rule.percent] = rule.capPct - shortfall / 100000;
  }
  const afterRatingPct = addVectors(afterCombinedRating, ratingPct, keys);

  // --- stage 5: ability scores ---------------------------------------------------------
  // FIX #5: `mult_hit_points` is a multiplicative stat, so con/200 is simply another factor
  // rather than the sheet's `(1+cur)*(1+con/200)-1-cur` hack. Algebraically identical.
  const abilities = zeros(keys);
  for (const rule of schema.abilityContributions) {
    abilities[rule.stat] += afterRatingPct[rule.ability] / rule.divisor;
  }
  const afterAbilityScores: Record<StatKey, number> = {};
  for (const key of keys) {
    afterAbilityScores[key] = multiplicative.has(key)
      ? (1 + afterRatingPct[key]) * (1 + abilities[key]) - 1
      : afterRatingPct[key] + abilities[key];
  }

  // --- stage 6: forte redistribution ---------------------------------------------------
  const forte = zeros(keys);
  const fortePool = afterAbilityScores.forte_p;
  // `forteSplit`'s own keys (primary/secondaryA/secondaryB) are fixed, but it's iterated by
  // `Object.entries` below alongside `picks`, so the lookup needs a plain index signature.
  const picks = (context.forte ?? {}) as Record<string, StatKey | undefined>;
  for (const [slot, divisor] of Object.entries(schema.forteSplit)) {
    const stat = picks[slot];
    if (stat && forte[stat] !== undefined) forte[stat] += fortePool / divisor;
  }
  if (context.m32Forte) {
    for (const stat of Object.keys(forte))
      forte[stat] = sheetRound(forte[stat], 2);
  }
  const totals = addVectors(afterAbilityScores, forte, keys);

  // --- stage 7: caps -------------------------------------------------------------------
  // FIX #2: `overcap` is now non-negative and `headroom` is its own field, instead of the
  // sheet's single signed number that meant two different things depending on its sign.
  const caps = zeros(keys);
  for (const rule of schema.ratingConversion) {
    caps[rule.rating] = totals.il + rule.allowedOver;
    caps[rule.percent] = rule.pctCap;
  }
  const capped = zeros(keys);
  const overcap = zeros(keys);
  const headroom = zeros(keys);
  for (const key of keys) {
    const cap = caps[key];
    if (cap > 0) {
      capped[key] = Math.min(totals[key], cap);
      overcap[key] = Math.max(totals[key] - cap, 0);
      headroom[key] = Math.max(cap - totals[key], 0);
    } else {
      capped[key] = totals[key];
    }
  }

  return {
    rows,
    stages: {
      sums,
      weaponMods,
      afterWeaponMods,
      afterCombinedRating,
      ratingPct,
      afterRatingPct,
      abilities,
      afterAbilityScores,
      forte,
      afterForte: totals,
      totals,
      caps,
      capped,
      overcap,
      headroom,
    },
  };
}

// --- derived outputs ---

function derive(db: Db, build: Build, stages: Stages): DerivedOutputs {
  const { schema } = db;
  const context = build.context ?? {};
  const { capped, totals } = stages;
  const role = schema.roles[context.role] ?? schema.roles.dps;
  const magnitude = Number(context.magnitude) || 0;
  const magical = context.damageType !== "physical";

  const itemLevel = totals.il;
  const hp =
    (itemLevel * 10 + capped.hit_points) *
    role.hpBonus *
    (1 + capped.hit_points_p) *
    (1 + capped.mult_hit_points);

  // FIX #1: reads the capped stage like every other derived value. `flat_damage` has no cap
  // and no later stage touches it, so this is a no-op today -- but it removes a trap where a
  // future bonus feeding `flat_damage` through a later stage would be silently dropped.
  const baseDamage = capped.flat_damage + (itemLevel / 10) * role.damageBonus;

  const effMagPhys = magical
    ? capped.magical_damage_boost
    : capped.physical_damage_boost;
  const enemyEff = magical
    ? capped.enemy_incoming_damage_magical
    : capped.enemy_incoming_damage_physical;
  const overallOgh = capped.out_healing_p + capped.overall_healing;

  const damage = (critChance: number, deflectChance: number) => {
    const critMult = 1 + capped.sev_p - capped.enemy_crit_avoid;
    const deflectMult = 1 / (1 + capped.enemy_deflect_sev - capped.acc_p);
    const other =
      (1 + effMagPhys) *
      (1 + enemyEff) *
      (1 + capped.outgoing_damage) *
      (1 + capped.enemy_incoming_damage) *
      (1 + capped.mult_damage);
    const value =
      baseDamage *
      (magnitude / 100) *
      (1 + capped.power_p) *
      averageByChance(critMult, critChance) *
      (1 + capped.ca_p - capped.enemy_awareness) *
      (1 / (1 + capped.enemy_defense)) *
      averageByChance(deflectMult, deflectChance) *
      other;
    return value * (1 / (1 - capped.overall_damage));
  };

  const healing = (critChance: number) =>
    baseDamage *
    (magnitude / 100) *
    (1 + capped.power_p) *
    averageByChance(1 + capped.sev_p / 2, critChance) *
    (1 + overallOgh);

  const ehp = (critChance: number, deflectChance: number) => {
    const critMult = 1 + capped.enemy_severity - capped.crit_avoid_p;
    const deflectMult = 1 / (1 + capped.deflect_sev_p - capped.enemy_accuracy);
    const finalMult =
      (1 / (1 + capped.defense_p)) *
      (1 + capped.enemy_ca - capped.awareness_p) *
      averageByChance(critMult, critChance) *
      averageByChance(deflectMult, deflectChance) *
      (1 + capped.enemy_outgoing_damage) *
      (1 + capped.incoming_damage);
    return hp / finalMult;
  };

  return {
    itemLevel,
    hp,
    baseDamage,
    effectiveMagPhys: effMagPhys,
    overallHealing: overallOgh,
    damage: {
      average: damage(capped.strike_p, capped.enemy_deflect),
      critNoDeflect: damage(1, 0),
      critDeflect: damage(1, 1),
      noCritNoDeflect: damage(0, 0),
      noCritDeflect: damage(0, 1),
    },
    healing: {
      average: healing(capped.strike_p),
      crit: healing(1),
      noCrit: healing(0),
    },
    ehp: {
      average: ehp(capped.enemy_strike, capped.deflect_p),
      critNoDeflect: ehp(1, 0),
    },
  };
}

// --- validation ---

/** Class-restriction and maxCopies checks for one item occupying one slot -- identical shape
 *  whether the item came from an item_picker's resolved row or a point_assignment's per-item
 *  count, so both loops in `findErrors` share this instead of duplicating the two checks. */
function checkItemErrors(
  slotId: string,
  item: Item,
  db: Db,
  context: BuildContext,
  counts: Map<string, number>,
): EngineError[] {
  const errors: EngineError[] = [];

  const allowed = item.allowedClass;
  if (allowed && !allowed.includes(context.class)) {
    errors.push({
      slotId,
      kind: "class",
      choice: item.name,
      message: `${item.name} requires ${allowed.join(" or ")}`,
      severity: "error",
    });
  }

  const max = db.maxCopies(item);
  const used = counts.get(item.id);
  if (max && used! > max) {
    errors.push({
      slotId,
      kind: "maxCopies",
      choice: item.name,
      message: `${item.name} is equipped ${used} times, maximum ${max}`,
      severity: "error",
    });
  }

  return errors;
}

function findErrors(
  db: Db,
  build: Build,
  resolved: ResolvedBonuses,
): EngineError[] {
  const errors: EngineError[] = [];
  const context = build.context ?? {};
  const counts = new Map<string, number>();

  for (const row of resolved.rows) {
    if (row.item) counts.set(row.item.id, (counts.get(row.item.id) ?? 0) + 1);
  }
  // point_assignment slots contribute to the same maxCopies count as an item_picker pick would
  // (each point is "one more copy"), but they have no ResolvedRow.item to have been counted by
  // the pass above -- counted here from the slot definitions themselves instead.
  for (const slot of db.slots) {
    if (slot.type !== "point_assignment") continue;
    const assigned = build.assignments?.[slot.id] ?? {};
    for (const item of db.forSlot(slot.id)) {
      const count = assigned[item.id] ?? item.pointAssignment!.default;
      if (count > 0) counts.set(item.id, (counts.get(item.id) ?? 0) + count);
    }
  }

  for (const slot of db.slots) {
    if (slot.type !== "point_assignment") continue;
    const assigned = build.assignments?.[slot.id] ?? {};
    for (const item of db.forSlot(slot.id)) {
      const { min, max: rowMax, default: def } = item.pointAssignment!;
      const count = assigned[item.id] ?? def;
      if (count <= 0) continue;

      errors.push(...checkItemErrors(slot.id, item, db, context, counts));

      if (count < min || count > rowMax) {
        errors.push({
          slotId: slot.id,
          kind: "outOfRange",
          choice: item.name,
          message: `${item.name}: ${count} is outside ${min}–${rowMax}`,
          severity: "error",
        });
      }
    }
  }

  for (const row of resolved.rows) {
    if (!row.item) {
      // Row has a choice set but the item doesn't resolve.
      if (row.choice) {
        errors.push({
          slotId: row.slotId,
          kind: "missing",
          choice: row.choice,
          message: `Item "${row.choice}" is not in your catalogue`,
          severity: "error",
        });
      }
      continue;
    }
    errors.push(...checkItemErrors(row.slotId, row.item, db, context, counts));

    // Dynamic weapon modifications carry a declared range. The value is used as typed
    // (see stage 2); flagging it here is what makes that safe.
    if (row.item.dynamicStat) {
      const typed = build.values?.[row.slotId];
      const value = Number(typed);
      const { dynamicMin: min, dynamicMax: max_ } = row.item;
      if (
        typed != null &&
        Number.isFinite(value) &&
        ((min != null && value < min) || (max_ != null && value > max_))
      ) {
        errors.push({
          slotId: row.slotId,
          kind: "outOfRange",
          choice: row.item.name,
          message: `${row.item.name}: ${value} is outside ${min}–${max_}`,
          severity: "error",
        });
      }
    }
  }
  return errors;
}

/** Data-authored errors/warnings: any active bonus grant carrying a `problem` payload
 * (types.ts's `Grant.problem`) instead of stats. One `EngineError` per active problem grant,
 * attributed to the same slot its stats would have been (`EvaluatedBonus.slotId`) -- an
 * excluded or inactive bonus reports nothing, same as it grants no stats. */
function bonusProblems(resolved: ResolvedBonuses): EngineError[] {
  const errors: EngineError[] = [];
  for (const entry of resolved.bonuses) {
    if (!entry.active) continue;
    for (const problem of entry.problems) {
      errors.push({
        slotId: entry.slotId,
        kind: "bonusRule",
        choice: entry.bonus.name ?? entry.bonusId,
        message: problem.message,
        severity: problem.severity,
        label: problem.label,
      });
    }
  }
  return errors;
}

// --- entry point ---

export function resolveBuild(
  db: Db,
  build: Build,
  options?: { explain?: boolean },
): ResolvedBuild {
  const resolved = bonus.resolve(db, build, options);
  const { rows, stages } = run(db, build, resolved);
  return {
    context: resolved.ctx,
    rows,
    bonuses: resolved.bonuses,
    stages,
    derived: derive(db, build, stages),
    errors: [...findErrors(db, build, resolved), ...bonusProblems(resolved)],
  };
}

export { averageByChance };
