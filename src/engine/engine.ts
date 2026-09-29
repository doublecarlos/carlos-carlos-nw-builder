// The calculation pipeline and derived outputs.
//
// `run()` gathers every row's stats and calculates the final results over multiple stages.
// Every intermediate stage is kept, along with a ledger of each contribution to each stat,
// which is what the stat source popover reads.

import * as bonus from "./bonus";
import { scaleFactorFor, scaledStat } from "./scaling";
import { assignedRows } from "../lib/inline-repetition";
import { copyCounts } from "../lib/copy-counts";
import { misplacedInsignia, withDerivedBonuses } from "./insignia";
import { itemStatAddress, readInput } from "../lib/build-inputs";
import { inputRanges, paramSpec, rangeError } from "./inputs";
import type {
  Db,
  Build,
  ForteSplit,
  Item,
  Schema,
  StatKey,
  ResolvedBonuses,
  EngineRow,
  Stages,
  StatContribution,
  LedgerEntry,
  DerivedOutputs,
  EngineError,
  ResolvedBuild,
  BuildContext,
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
 * Per-slot stat vectors: the item's own stats, its dynamic stats' values, and the bonuses
 * attributed to that slot. Kept as rows because multiplicative stats combine per row, not per
 * source.
 *
 * `scaleFactorFor` applies to the item's own fields only -- mount/companion bolster scales what
 * the item itself carries, while the assignment and bonus stats merged in below reached this
 * row by attribution (bonus.ts's `anchor.slotId`) rather than by belonging to the item, and are
 * not the granting item's to scale. Scaling the bonuses that genuinely should is separate work.
 *
 * Each item, dynamic and assignment share is also recorded in `ledger` on its own. Bonus
 * shares are recorded by `bonusEntries`, since `bonusStatsBySlot` has already merged them per
 * slot.
 */
function rowVectors(
  build: Build,
  resolved: ResolvedBonuses,
  keys: StatKey[],
  combineOf: (stat: StatKey) => LedgerEntry["combine"],
  ledger: LedgerEntry[],
): EngineRow[] {
  const rows: EngineRow[] = [];
  for (const row of resolved.rows) {
    const stats = zeros(keys);
    const { slotId } = row;
    if (row.item) {
      const itemId = row.item.id;
      const factor = scaleFactorFor(resolved.ctx, row.item);
      for (const key of keys) {
        // `repetitions` is 1 for an ordinary pick, so this only bites for an item that
        // declares an `inlineRepetition`: N repetitions carry N times the stat line, exactly as
        // N separate picks of the item would.
        if (!row.item[key]) continue;
        const value = scaledStat(row.item, key, factor) * row.repetitions;
        stats[key] = value;
        if (value)
          ledger.push({
            stat: key,
            value,
            kind: "item",
            stage: "sums",
            combine: combineOf(key),
            slotId,
            itemId,
          });
      }
      // The declared range is not clamped here. An unset value reads as its config's default.
      for (const config of row.item.dynamicStats ?? []) {
        const value =
          readInput(
            build,
            itemStatAddress(slotId, config.stat),
            config.default,
          ) * row.repetitions;
        stats[config.stat] = (stats[config.stat] ?? 0) + value;
        if (value)
          ledger.push({
            stat: config.stat,
            value,
            kind: "dynamic",
            stage: "sums",
            combine: combineOf(config.stat),
            slotId,
            itemId,
          });
      }
    }
    // A point_assignment row has no single item to read stats off of -- its assignments'
    // items, scaled by count, were already collected by bonus.ts's collect().
    for (const assigned of resolved.assignmentStatsBySlot.get(slotId) ?? []) {
      for (const [key, value] of assigned.stats) {
        stats[key] = (stats[key] ?? 0) + value;
        ledger.push({
          stat: key,
          value,
          kind: "assignment",
          stage: "sums",
          combine: combineOf(key),
          slotId,
          itemId: assigned.itemId,
        });
      }
    }
    const bonusStats = resolved.bonusStatsBySlot.get(slotId);
    if (bonusStats) {
      for (const [key, value] of bonusStats)
        stats[key] = (stats[key] ?? 0) + value;
    }
    rows.push({
      slotId,
      slot: row.slot,
      choice: row.choice,
      item: row.item,
      stats,
      repetitions: row.repetitions,
    });
  }
  return rows;
}

/** One entry per active bonus and stat, on the bonus's instancing slot: the same values
 * `bonusStatsBySlot` merged into `rowVectors`' rows. */
function bonusEntries(
  resolved: ResolvedBonuses,
  combineOf: (stat: StatKey) => LedgerEntry["combine"],
  ledger: LedgerEntry[],
) {
  for (const entry of resolved.bonuses) {
    if (!entry.active || !entry.appliedStats) continue;
    for (const [stat, value] of Object.entries(entry.appliedStats)) {
      if (!value) continue;
      ledger.push({
        stat,
        value,
        kind: "bonus",
        stage: "sums",
        combine: combineOf(stat),
        slotId: entry.slotId,
        bonusId: entry.id,
      });
    }
  }
}

const FORTE_SOURCE: StatKey = "forte_p";

/** Transform forte split into stat contribution rules. */
function forteRules(
  schema: Schema,
  forte: ForteSplit | undefined,
  known: Set<StatKey>,
): StatContribution[] {
  const picks = (forte ?? {}) as Record<string, StatKey | undefined>;
  const rules: StatContribution[] = [];
  for (const [slot, divisor] of Object.entries(schema.forteSplit)) {
    const target = picks[slot];
    if (target && known.has(target))
      rules.push({ source: FORTE_SOURCE, target, divisor });
  }
  return rules;
}

/** Transform Enemy's incoming magical/physical damage into a stat contribution rule */
function enemyIncomingMagPhysRule(context: BuildContext): StatContribution[] {
  const source =
    context.damageType === "physical"
      ? "enemy_incoming_damage_physical"
      : "enemy_incoming_damage_magical";
  return [{ source, target: "enemy_incoming_damage", divisor: 1 }];
}

/**
 * Every contribution is recorded into `ledger` in pipeline order. Row entries are recorded
 * only when nonzero; every rating conversion and contribution rule records one entry, zero or
 * not.
 */
function run(
  db: Db,
  build: Build,
  resolved: ResolvedBonuses,
  ledger: LedgerEntry[],
): {
  rows: EngineRow[];
  stages: Stages;
} {
  const { schema } = db;
  const keys: StatKey[] = schema.statKeys;
  const context = build.context ?? {};
  const multiplicative = new Set(schema.multiplicativeStats);
  const combineOf = (stat: StatKey): LedgerEntry["combine"] =>
    multiplicative.has(stat) ? "multiplicative" : "additive";
  const rows = rowVectors(build, resolved, keys, combineOf, ledger);
  bonusEntries(resolved, combineOf, ledger);

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

  // --- stage 2: combined rating --------------------------------------------------------
  const afterCombinedRating: Record<StatKey, number> = { ...sums };
  for (const key of schema.ratingStats) {
    afterCombinedRating[key] += sums.combined_rating;
    if (sums.combined_rating)
      ledger.push({
        stat: key,
        value: sums.combined_rating,
        kind: "combinedRating",
        stage: "afterCombinedRating",
        combine: combineOf(key),
        sourceStat: "combined_rating",
      });
  }

  // --- stage 3: caps -------------------------------------------------------------------
  // Calculates caps for each applicable stat, based on the build's item level.
  // It is assumed that nothing after this stage alters Item Level.
  const itemLevel = afterCombinedRating.il;
  const caps = zeros(keys);
  for (const rule of schema.ratingConversion) {
    caps[rule.rating] = itemLevel + rule.allowedOver;
    caps[rule.percent] = rule.pctCap;
  }
  /** `value` held to `key`'s cap; a stat with no cap reads as-is. */
  const atCap = (key: StatKey, value: number) =>
    caps[key] > 0 ? Math.min(value, caps[key]) : value;

  // --- stage 4: rating -> percent ------------------------------------------------------
  const ratingPct = zeros(keys);
  for (const rule of schema.ratingConversion) {
    const shortfall = Math.max(
      itemLevel + rule.allowedOver - afterCombinedRating[rule.rating],
      0,
    );
    ratingPct[rule.percent] = rule.capPct - shortfall / 100000;
    ledger.push({
      stat: rule.percent,
      value: ratingPct[rule.percent],
      kind: "ratingConversion",
      stage: "afterRatingPct",
      combine: combineOf(rule.percent),
      sourceStat: rule.rating,
    });
  }
  const afterRatingPct = addVectors(afterCombinedRating, ratingPct, keys);

  // --- stage 5: stat contributions ----------------------------------------------------------
  // One ordered rule list, defining source and target stats, and the divisor.
  // Applied against running totals. Each rule read its source at the source's cap.
  // Rules generated by the engine (forte, mag/phys debuff) are applied last.
  const rules: StatContribution[] = [
    ...schema.statContributions,
    ...forteRules(schema, context.forte, new Set(keys)),
    ...enemyIncomingMagPhysRule(context),
  ];
  const contributions = zeros(keys);
  const totals: Record<StatKey, number> = { ...afterRatingPct };
  for (const rule of rules) {
    let value = atCap(rule.source, totals[rule.source] ?? 0) / rule.divisor;
    // The sheet's M32 forte mode rounds each forte share to two decimals before it lands.
    if (context.m32Forte && rule.source === FORTE_SOURCE)
      value = sheetRound(value, 2);
    contributions[rule.target] += value;
    totals[rule.target] = multiplicative.has(rule.target)
      ? (1 + totals[rule.target]) * (1 + value) - 1
      : totals[rule.target] + value;
    ledger.push({
      stat: rule.target,
      value,
      kind: "contribution",
      stage: "totals",
      combine: combineOf(rule.target),
      sourceStat: rule.source,
    });
  }

  // --- stage 6: final caps -------------------------------------------------------------
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
      afterCombinedRating,
      caps,
      ratingPct,
      afterRatingPct,
      contributions,
      totals,
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
    (1 + capped.hit_points_mult);

  const baseDamage =
    (capped.base_damage_flat + (itemLevel / 10) * role.damageBonus) *
    (1 + capped.base_damage_mult);

  const effectiveMagPhys = magical
    ? capped.magical_damage_boost
    : capped.physical_damage_boost;
  const damage = (critChance: number, deflectChance: number) => {
    const critMult = 1 + capped.sev_p - capped.enemy_crit_avoid;
    const deflectMult = 1 / (1 + capped.enemy_deflect_sev - capped.acc_p);
    const other =
      (1 + effectiveMagPhys) *
      (1 + capped.outgoing_damage) *
      (1 + capped.enemy_incoming_damage) *
      (1 + capped.outgoing_damage_mult);
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
    (1 + capped.overall_healing);

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
    effectiveMagPhys,
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
  /** The build's resolved class (`EvalContext.class`), published by whatever class item is
   *  equipped -- not read off `build.context`, which no longer carries one. */
  cls: string | undefined,
  counts: Map<string, number>,
): EngineError[] {
  const errors: EngineError[] = [];

  const allowed = item.allowedClass;
  if (allowed && (!cls || !allowed.includes(cls))) {
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

/** A numeric build_parameter's declared bounds. Nothing clamps the control, since silently
 * rewriting a number someone typed is worse than showing it, so this is what keeps an
 * out-of-range value visible. Matters most for a parameter that multiplies whole stat lines
 * (one declaring a `scaler`): a 1000% bolster computes happily and is meaningless. */
function parameterRanges(db: Db, resolved: ResolvedBonuses): EngineError[] {
  const errors: EngineError[] = [];
  for (const slot of db.slots) {
    if (slot.type !== "build_parameter") continue;
    if (slot.paramType !== "number" && slot.paramType !== "percent") continue;
    if (slot.min === undefined && slot.max === undefined) continue;
    const value = Number(resolved.ctx.params.get(slot.path));
    const error = rangeError(slot.id, slot.label, paramSpec(slot), value, {
      store: "context",
      path: slot.path,
    });
    if (error) errors.push(error);
  }
  return errors;
}

/** Every `point_assignment` row with points on it gets the same class and copy checks a pick
 * gets. Its count's range is `inputRanges`' business. */
function assignmentErrors(
  db: Db,
  build: Build,
  cls: string | undefined,
  counts: Map<string, number>,
): EngineError[] {
  const errors: EngineError[] = [];
  for (const slot of db.slots) {
    if (slot.type !== "point_assignment") continue;
    for (const { item, count } of assignedRows(db, build, slot)) {
      if (count <= 0) continue;
      errors.push(...checkItemErrors(slot.id, item, db, cls, counts));
    }
  }
  return errors;
}

/** A warning, not an error: the pick still counts, it just should not be where it is. */
function insigniaWarnings(db: Db, build: Build): EngineError[] {
  return misplacedInsignia(db, build).map((misplaced) => ({
    slotId: misplaced.slotId,
    kind: "insigniaSlot",
    choice: misplaced.item.name,
    message: misplaced.message,
    severity: "warning",
  }));
}

/** Every rule that reads one resolved row, in row order so a slot's errors stay together. */
function rowErrors(
  db: Db,
  resolved: ResolvedBonuses,
  counts: Map<string, number>,
): EngineError[] {
  const errors: EngineError[] = [];
  for (const row of resolved.rows) {
    if (!row.item) {
      // Row has a choice set but the item doesn't resolve.
      if (row.choice) {
        errors.push({
          slotId: row.slotId,
          kind: "missing",
          choice: row.choice,
          message: `Item "${row.choice}" does not exist`,
          severity: "error",
        });
      }
      continue;
    }
    errors.push(
      ...checkItemErrors(row.slotId, row.item, db, resolved.ctx.class, counts),
    );
  }
  return errors;
}

function findErrors(
  db: Db,
  build: Build,
  resolved: ResolvedBonuses,
): EngineError[] {
  const counts = copyCounts(db, build);
  return [
    ...parameterRanges(db, resolved),
    ...assignmentErrors(db, build, resolved.ctx.class, counts),
    ...insigniaWarnings(db, build),
    ...rowErrors(db, resolved, counts),
    ...inputRanges(db, build, resolved),
  ];
}

/** Data-authored errors/warnings: any active bonus grant carrying a `problem` payload
 * (types.ts's `Grant.problem`) instead of stats. One `EngineError` per active problem grant,
 * attributed to the same slot its stats would have been (`EvaluatedBonus.slotId`) -- an
 * excluded or inactive bonus reports nothing, same as it grants no stats. Formula failures
 * are reported here too. */
function bonusProblems(resolved: ResolvedBonuses): EngineError[] {
  const errors: EngineError[] = [];
  for (const entry of resolved.bonuses) {
    // A failed formula is reported while the bonus is on the build, active or not: the
    // failure may be what keeps it inactive.
    if (!entry.excluded) {
      for (const message of entry.formulaErrors) {
        errors.push({
          slotId: entry.slotId,
          kind: "formula",
          choice: entry.bonus.name ?? entry.bonusId,
          message,
          severity: "error",
        });
      }
    }
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

/** One error per path two equipped items published different values for (`Item.publishes`).
 * Attributed to each contributing slot, not just one, since either of them is an equally
 * valid place to fix it -- the point is that the build has no defensible answer for that path,
 * so `collect()` deliberately left it out of `ctx.params` rather than picking a winner. */
function publishConflicts(db: Db, resolved: ResolvedBonuses): EngineError[] {
  const errors: EngineError[] = [];
  for (const conflict of resolved.publishConflicts) {
    for (const contributor of conflict.contributors) {
      const others = conflict.contributors.filter(
        (entry) => entry.slotId !== contributor.slotId,
      );
      errors.push({
        slotId: contributor.slotId,
        kind: "publishConflict",
        choice: db.get(contributor.itemId)?.name ?? contributor.itemId,
        message:
          `sets ${conflict.path} to "${contributor.value}", but ` +
          others
            .map(
              (entry) =>
                `${db.get(entry.itemId)?.name ?? entry.itemId} sets it to "${entry.value}"`,
            )
            .join(", ") +
          `; unequip one, or ${conflict.path} is left unset`,
        severity: "error",
      });
    }
  }
  return errors;
}

// --- entry point ---

/** Bonus resolution alone, for callers that read only `bonuses` (the picker's per-candidate
 *  previews). Skips the stat pipeline and error checks `resolveBuild` adds. */
export function resolveBonuses(db: Db, stored: Build): ResolvedBonuses {
  return bonus.resolve(db, withDerivedBonuses(db, stored));
}

export function resolveBuild(db: Db, stored: Build): ResolvedBuild {
  // Derived here, not written to the build, so everything below sees an ordinary equipped item.
  const build = withDerivedBonuses(db, stored);
  const resolved = bonus.resolve(db, build);
  const ledger: LedgerEntry[] = [];
  const { rows, stages } = run(db, build, resolved, ledger);
  return {
    context: resolved.ctx,
    rows,
    bonuses: resolved.bonuses,
    stages,
    ledger,
    derived: derive(db, build, stages),
    errors: [
      ...findErrors(db, build, resolved),
      ...bonusProblems(resolved),
      ...publishConflicts(db, resolved),
    ],
  };
}

export { averageByChance };
