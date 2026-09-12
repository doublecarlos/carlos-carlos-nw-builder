// The calculation pipeline and derived outputs.
//
// `run()` gathers every row's stats and calculates the final results over multiple stages.
// Every intermediate stage is kept, which makes inspecting stat sources possible.

import * as bonus from "./bonus";
import { scaleFactorFor, scaledStat } from "./scaling";
import { occurrenceCountFor } from "../lib/bonus-attachment";
import { assignedRows } from "../lib/inline-repetition";
import { copyCounts } from "../lib/copy-counts";
import { misplacedInsignia, withDerivedBonuses } from "./insignia";
import { dynamicValueKey, readDynamicValue } from "../lib/dynamic-stats";
import type {
  Db,
  Build,
  ForteSplit,
  Item,
  Schema,
  StatKey,
  ResolvedBonuses,
  ResolvedRow,
  EngineRow,
  Stages,
  StatContribution,
  AppliedContribution,
  DerivedOutputs,
  EngineError,
  ResolvedBuild,
} from "../types";
import { outOfRangeErrorMessage } from "../lib/format";

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
 *
 * `scaleFactorFor` applies to the item's own fields only -- mount/companion bolster scales what
 * the item itself carries, while the assignment and bonus stats merged in below reached this
 * row by attribution (bonus.ts's `anchor.slotId`) rather than by belonging to the item, and are
 * not the granting item's to scale. Scaling the bonuses that genuinely should is separate work.
 */
function rowVectors(
  schema: Schema,
  resolved: ResolvedBonuses,
  keys: StatKey[],
): EngineRow[] {
  return resolved.rows.map((row) => {
    const stats = zeros(keys);
    // Kept apart from `stats`, which merges the bonus and assignment stats in below: the stat
    // source popover needs the item's own share, and recomputing it there let the two disagree.
    const itemStats: Record<string, number> = {};
    if (row.item) {
      const factor = scaleFactorFor(schema, resolved.ctx, row.item);
      for (const key of keys) {
        // `repetitions` is 1 for an ordinary pick, so this only bites for an item that
        // declares an `inlineRepetition`: N repetitions carry N times the stat line, exactly as
        // N separate picks of the item would.
        if (row.item[key]) {
          itemStats[key] =
            scaledStat(schema, row.item, key, factor) * row.repetitions;
          stats[key] = itemStats[key];
        }
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
    return {
      slotId: row.slotId,
      slot: row.slot,
      choice: row.choice,
      item: row.item,
      stats,
      itemStats,
      dynamicStats: {},
      repetitions: row.repetitions,
    };
  });
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

function run(
  db: Db,
  build: Build,
  resolved: ResolvedBonuses,
): {
  rows: EngineRow[];
  stages: Stages;
  appliedContributions: AppliedContribution[];
} {
  const { schema } = db;
  const keys: StatKey[] = schema.statKeys;
  const context = build.context ?? {};
  const multiplicative = new Set(schema.multiplicativeStats);
  const rows = rowVectors(schema, resolved, keys);

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

  // --- stage 2: dynamic stat resolution --------------------------------------------------
  // The declared range is NOT clamped here. An unset value reads as its config's own `default`.
  const dynamicStatMods = zeros(keys);
  for (const row of rows) {
    for (const config of row.item?.dynamicStats ?? []) {
      // Scaled by the row's repetition count for the same reason its plain stats are: one
      // magnitude typed against an item that is in the build N times describes each of those N.
      const value =
        readDynamicValue(build, row.slotId, config) * row.repetitions;
      dynamicStatMods[config.stat] += value;
      row.dynamicStats[config.stat] = value;
    }
  }
  const afterDynamicStatMods = addVectors(sums, dynamicStatMods, keys);

  // --- stage 3: combined rating --------------------------------------------------------
  const afterCombinedRating: Record<StatKey, number> = {
    ...afterDynamicStatMods,
  };
  for (const key of schema.ratingStats) {
    afterCombinedRating[key] += sums.combined_rating;
  }

  // --- stage 4: caps -------------------------------------------------------------------
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

  // --- stage 5: rating -> percent ------------------------------------------------------
  const ratingPct = zeros(keys);
  for (const rule of schema.ratingConversion) {
    const shortfall = Math.max(
      itemLevel + rule.allowedOver - afterCombinedRating[rule.rating],
      0,
    );
    ratingPct[rule.percent] = rule.capPct - shortfall / 100000;
  }
  const afterRatingPct = addVectors(afterCombinedRating, ratingPct, keys);

  // --- stage 6: stat contributions ----------------------------------------------------------
  // One ordered rule list, defining source and target stats, and the divisor.
  // Applied against running totals. Each rule read its source at the source's cap.
  // Forte rules generated by the engine are applied last.
  const rules: StatContribution[] = [
    ...schema.statContributions,
    ...forteRules(schema, context.forte, new Set(keys)),
  ];
  const contributions = zeros(keys);
  const applied: AppliedContribution[] = [];
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
    applied.push({ source: rule.source, target: rule.target, value });
  }

  // --- stage 7: final caps -------------------------------------------------------------
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
      dynamicStatMods,
      afterDynamicStatMods,
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
    appliedContributions: applied,
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
  const effectiveEnemyIncomingMagPhys = magical
    ? capped.enemy_incoming_damage_magical
    : capped.enemy_incoming_damage_physical;
  const damage = (critChance: number, deflectChance: number) => {
    const critMult = 1 + capped.sev_p - capped.enemy_crit_avoid;
    const deflectMult = 1 / (1 + capped.enemy_deflect_sev - capped.acc_p);
    const other =
      (1 + effectiveMagPhys) *
      (1 + capped.outgoing_damage) *
      (1 + capped.enemy_incoming_damage + effectiveEnemyIncomingMagPhys) *
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
 * (`Schema.statScalers`): a 1000% bolster computes happily and is meaningless. */
function parameterRanges(db: Db, resolved: ResolvedBonuses): EngineError[] {
  const errors: EngineError[] = [];
  for (const slot of db.slots) {
    if (slot.type !== "build_parameter") continue;
    if (slot.paramType !== "number" && slot.paramType !== "percent") continue;
    if (slot.min === undefined && slot.max === undefined) continue;
    const value = Number(resolved.ctx.params.get(slot.path));
    if (!Number.isFinite(value)) continue;
    if (
      (slot.min !== undefined && value < slot.min) ||
      (slot.max !== undefined && value > slot.max)
    ) {
      // Percent params are stored as decimals but read and typed as percentages, so the
      // message has to speak the same units the control does.
      const show = (n: number) =>
        slot.paramType === "percent"
          ? `${Math.round(n * 10000) / 100}%`
          : String(n);
      const low = slot.min === undefined ? "" : show(slot.min);
      const high = slot.max === undefined ? "" : show(slot.max);
      errors.push({
        slotId: slot.id,
        kind: "outOfRange",
        choice: slot.label,
        message: outOfRangeErrorMessage(slot.label, show(value), low, high),
        severity: "error",
      });
    }
  }
  return errors;
}

/** Every `point_assignment` row with points on it: the same class and copy checks a pick gets,
 * plus its own count against the row's declared bounds. */
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
      const { min, max: rowMax } = item.inlineRepetition!;

      errors.push(...checkItemErrors(slot.id, item, db, cls, counts));

      if (count < min || count > rowMax) {
        errors.push({
          slotId: slot.id,
          kind: "outOfRange",
          choice: item.name,
          message: outOfRangeErrorMessage(item.name, count, min, rowMax),
          severity: "error",
        });
      }
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

/** Dynamic stats carry a declared range. The value is used as typed (see stage 2); flagging it
 * here is what makes that safe. */
function itemDynamicStatRanges(build: Build, row: ResolvedRow): EngineError[] {
  const errors: EngineError[] = [];
  for (const config of row.item?.dynamicStats ?? []) {
    const typed = build.values?.[row.slotId]?.[dynamicValueKey(config.stat)];
    const value = Number(typed);
    if (
      typed != null &&
      Number.isFinite(value) &&
      (value < config.min || value > config.max)
    ) {
      errors.push({
        slotId: row.slotId,
        kind: "outOfRange",
        choice: row.item!.name,
        message: outOfRangeErrorMessage(
          row.item!.name,
          value,
          config.min,
          config.max,
        ),
        severity: "error",
      });
    }
  }
  return errors;
}

/** An `item_picker` pick's own inline-repetition count. A `point_assignment` row's counts are
 * `assignmentErrors`' business, against the slot's item list rather than a single pick. */
function repetitionRange(row: ResolvedRow): EngineError[] {
  const repetition = row.item?.inlineRepetition;
  if (
    !repetition ||
    (row.repetitions >= repetition.min && row.repetitions <= repetition.max)
  )
    return [];
  return [
    {
      slotId: row.slotId,
      kind: "outOfRange",
      choice: row.item!.name,
      message: outOfRangeErrorMessage(
        row.item!.name,
        row.repetitions,
        repetition.min,
        repetition.max,
      ),
      severity: "error",
    },
  ];
}

/** A `BonusOccurrenceConfig`'s count: not achievable through the stepper's own clamped buttons,
 * but a hand-edited or imported build can carry one. */
function occurrenceRanges(build: Build, row: ResolvedRow): EngineError[] {
  const errors: EngineError[] = [];
  const itemInputs = build.occurrenceInputs?.[row.item!.id];
  for (const attachment of row.item?.bonuses ?? []) {
    if (typeof attachment === "string") continue;
    const count = occurrenceCountFor(attachment, itemInputs);
    if (count < attachment.min || count > attachment.max) {
      errors.push({
        slotId: row.slotId,
        kind: "outOfRange",
        choice: row.item!.name,
        message: outOfRangeErrorMessage(
          row.item!.name,
          count,
          attachment.min,
          attachment.max,
        ),
        severity: "error",
      });
    }
  }
  return errors;
}

/** Every rule that reads one resolved row, in row order so a slot's errors stay together. */
function rowErrors(
  db: Db,
  build: Build,
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
      ...itemDynamicStatRanges(build, row),
      ...repetitionRange(row),
      ...occurrenceRanges(build, row),
    );
  }
  return errors;
}

/** A grant/variant's dynamic stat, resolved against the bonus's first contributing slot
 * (bonus.ts's `resolve`) regardless of whether the bonus is currently active: a hand-edited or
 * imported value can be stale but should still be flagged once it would matter again. */
function bonusDynamicStatRanges(
  build: Build,
  resolved: ResolvedBonuses,
): EngineError[] {
  const errors: EngineError[] = [];
  for (const entry of resolved.bonuses) {
    for (const grant of entry.grants) {
      for (const config of grant.raw.dynamicStats ?? []) {
        errors.push(
          ...dynamicStatRangeError(
            entry.slotId,
            entry.bonusId,
            entry.bonus.name ?? entry.bonusId,
            config,
            build,
          ),
        );
      }
      for (const variant of grant.raw.variants ?? []) {
        for (const config of variant.dynamicStats ?? []) {
          errors.push(
            ...dynamicStatRangeError(
              entry.slotId,
              entry.bonusId,
              entry.bonus.name ?? entry.bonusId,
              config,
              build,
            ),
          );
        }
      }
    }
  }

  return errors;
}

function dynamicStatRangeError(
  slotId: string,
  bonusId: string,
  name: string,
  config: { stat: StatKey; min: number; max: number },
  build: Build,
): EngineError[] {
  const typed = build.values?.[slotId]?.[dynamicValueKey(config.stat, bonusId)];
  const value = Number(typed);
  if (
    typed == null ||
    !Number.isFinite(value) ||
    (value >= config.min && value <= config.max)
  )
    return [];
  return [
    {
      slotId,
      kind: "outOfRange",
      choice: name,
      message: outOfRangeErrorMessage(name, value, config.min, config.max),
      severity: "error",
    },
  ];
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
    ...rowErrors(db, build, resolved, counts),
    ...bonusDynamicStatRanges(build, resolved),
  ];
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

export function resolveBuild(
  db: Db,
  stored: Build,
  options?: { explain?: boolean },
): ResolvedBuild {
  // Derived here, not written to the build, so everything below sees an ordinary equipped item.
  // Inside `resolveBuild` so the picker's per-candidate resolves get the same treatment.
  const build = withDerivedBonuses(db, stored);
  const resolved = bonus.resolve(db, build, options);
  const { rows, stages, appliedContributions } = run(db, build, resolved);
  return {
    context: resolved.ctx,
    rows,
    bonuses: resolved.bonuses,
    stages,
    appliedContributions,
    derived: derive(db, build, stages),
    errors: [
      ...findErrors(db, build, resolved),
      ...bonusProblems(resolved),
      ...publishConflicts(db, resolved),
    ],
  };
}

export { averageByChance };
