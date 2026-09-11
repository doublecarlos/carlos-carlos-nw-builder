// Per-stat source attribution for StatPanel.vue's stat source popover: "why is this number
// what it is", one stat at a time rather than one bonus at a time (BonusInspector.vue's own job).
//
// Each helper below mirrors exactly one pipeline stage from engine.ts's `run()`, reading that
// stage's own output (a resolved build's `stages.*`, or an `EngineRow`'s own `itemStats`/
// `dynamicStats`) rather than recomputing its math, so this can never drift from what the panel
// displays. Regrouping is all that is left: the pipeline needs stats summed per row, this needs
// them named per source, each linked back to the build row that produced it where there is one.
import { NW_SCHEMA } from "../data/data";
import { bonusTitle } from "../lib/format";
import { assignedRows } from "../lib/inline-repetition";
import type { ResolvedBuild, Build, Db, StatKey } from "../types";

export interface StatSource {
  name: string;
  value: number;
  /** The build row this line came from; absent for a pipeline stage's own line (Rating
   * contribution, Combined rating, an ability score, Forte), which has no row to jump to. */
  slotId?: string;
}
export interface StatSourceSection {
  title: string;
  key: string;
  sources: StatSource[];
}

/** Every equipped item's own stat (pre-bonus, pre-pipeline), one line per build row: the
 * same item in two slots (two rings) is two lines, each linking to its own row. */
function itemSources(result: ResolvedBuild, key: StatKey): StatSource[] {
  const out: StatSource[] = [];
  for (const row of result.rows) {
    const value = row.itemStats[key];
    if (!row.item || !value) continue;
    out.push({ name: row.item.name, value, slotId: row.slotId });
  }
  return out;
}

/** Every point_assignment row's item stat × its count, one line per item, each linking to the
 * slot itself since its items share one build row. The counterpart to `itemSources` above for
 * a slot with no single `ResolvedRow.item` to read: bonus.ts's `collect()` folds these into
 * `assignmentStatsBySlot` for the pipeline, and this re-attributes them to the item that
 * earned them. */
function assignmentSources(
  db: Db | null | undefined,
  build: Build | null | undefined,
  key: StatKey,
): StatSource[] {
  if (!db || !build) return [];
  const out: StatSource[] = [];
  for (const slot of db.slots) {
    if (slot.type !== "point_assignment") continue;
    for (const { item, count } of assignedRows(db, build, slot)) {
      if (count <= 0) continue;
      const raw = item[key];
      if (!raw) continue;
      out.push({
        name: item.name,
        value: (raw as number) * count,
        slotId: slot.id,
      });
    }
  }
  return out;
}

/** Every active bonus's applied (post-stacking) contribution to this stat, linked to the
 * bonus's instancing slot. */
function bonusSources(result: ResolvedBuild, key: StatKey): StatSource[] {
  const out: StatSource[] = [];
  for (const entry of result.bonuses) {
    const value = entry.active ? entry.appliedStats?.[key] : null;
    if (value) {
      out.push({ name: bonusTitle(entry), value, slotId: entry.slotId });
    }
  }
  return out;
}

/** Stage 2: every typed dynamic-stat value targeting this key, attributed to the item that
 *  carries it. */
function dynamicStatSources(result: ResolvedBuild, key: StatKey): StatSource[] {
  const out: StatSource[] = [];
  for (const row of result.rows) {
    const value = row.dynamicStats[key];
    if (value) {
      out.push({
        name: `${row.item!.name} (dynamic stat)`,
        value,
        slotId: row.slotId,
      });
    }
  }
  return out;
}

/** Stage 3: `combined_rating` feeds every rating stat equally -- one line, not attributed
 * further back to whichever items/bonuses granted `combined_rating` itself (that's its own
 * row in "Other stats", with its own popover). */
function combinedRatingSource(
  result: ResolvedBuild,
  key: StatKey,
): StatSource[] {
  if (!NW_SCHEMA.ratingStats.includes(key)) return [];
  const value = result.stages.sums?.combined_rating ?? 0;
  return value ? [{ name: "Combined rating", value }] : [];
}

/** Stage 4: the rating -> percent conversion. Always present (even at 0) and always first for
 * a paired percent stat -- it is structurally part of the number, not an optional extra. */
function ratingContributionSource(
  result: ResolvedBuild,
  key: StatKey,
): StatSource[] {
  const rule = NW_SCHEMA.ratingConversion.find((r) => r.percent === key);
  if (!rule) return [];
  return [
    { name: "Rating contribution", value: result.stages.ratingPct?.[key] ?? 0 },
  ];
}

/** Stage 5: ability score redistribution (e.g. Dexterity feeding Severity%). */
function abilitySource(result: ResolvedBuild, key: StatKey): StatSource[] {
  const rule = NW_SCHEMA.abilityContributions.find((r) => r.stat === key);
  if (!rule) return [];
  const value = result.stages.abilities?.[key] ?? 0;
  return value
    ? [
        {
          name: NW_SCHEMA.statByKey[rule.ability]?.label ?? rule.ability,
          value,
        },
      ]
    : [];
}

/** Stage 6: the forte pool, if the player picked this stat in one of the three forte slots. */
function forteSource(
  result: ResolvedBuild,
  build: Build | null | undefined,
  key: StatKey,
): StatSource[] {
  const picks = build?.context?.forte as
    Record<string, string | undefined> | undefined;
  if (!picks || !Object.values(picks).includes(key)) return [];
  const value = result.stages.forte?.[key] ?? 0;
  return value ? [{ name: "Forte", value }] : [];
}

/** Every contribution to one stat key, in the order they'd appear reading the pipeline
 * top to bottom. Works for any key -- rating, paired percent, unpaired percent, flat -- each
 * helper above is a no-op for stages that don't touch that particular key. */
function sourcesFor(
  result: ResolvedBuild,
  build: Build | null | undefined,
  db: Db | null | undefined,
  key: StatKey,
): StatSource[] {
  return [
    ...ratingContributionSource(result, key),
    ...itemSources(result, key),
    ...assignmentSources(db, build, key),
    ...bonusSources(result, key),
    ...dynamicStatSources(result, key),
    ...combinedRatingSource(result, key),
    ...abilitySource(result, key),
    ...forteSource(result, build, key),
  ];
}

/** One section for a plain stat, two (Rating / Percentage) for a rating+percent pair -- the
 * percentage section's own first source is always `ratingContributionSource`'s "Rating
 * contribution" line, per `sourcesFor`'s ordering. */
export function sectionsFor(
  result: ResolvedBuild,
  build: Build | null | undefined,
  db: Db | null | undefined,
  key: StatKey,
): StatSourceSection[] {
  const rule = NW_SCHEMA.ratingConversion.find((r) => r.rating === key);
  if (rule) {
    return [
      {
        title: "Rating",
        key: rule.rating,
        sources: sourcesFor(result, build, db, rule.rating),
      },
      {
        title: "Percentage",
        key: rule.percent,
        sources: sourcesFor(result, build, db, rule.percent),
      },
    ];
  }
  return [{ title: "", key, sources: sourcesFor(result, build, db, key) }];
}
