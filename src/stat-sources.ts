// Per-stat source attribution for StatPanel.vue's stat source popover: "why is this number
// what it is", one stat at a time rather than one bonus at a time (BonusInspector.vue's own job).
//
// The engine's rows/bonusStatsBySlot merge item and bonus stats together for the pipeline
// (engine.ts's own comment: multiplicative stats combine per row, not per source), so sources
// have to be re-attributed here rather than read off a ready-made vector. Each helper below
// mirrors exactly one pipeline stage from engine.ts's `run()`, reading that stage's own output
// (a resolved build's `stages.*`) rather than recomputing its math, so this can never drift
// from what the panel actually displays.
import { NW_SCHEMA } from "./data";
import type { ResolvedBuild, Build, EvaluatedBonus, StatKey } from "./types";

export interface StatSource {
  name: string;
  value: number;
}
export interface StatSourceSection {
  title: string;
  key: string;
  sources: StatSource[];
}

/** `m31-crimson-march-combat` -> `M31 Crimson March Combat`, for a bonus with no set name --
 * same convention as BonusInspector.vue's own `fromId`, duplicated rather than shared (see
 * that file's note on ItemCard's bonus vocabulary for the same reasoning). */
const fromId = (id: string) =>
  String(id ?? "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

function bonusTitle(entry: EvaluatedBonus) {
  return entry.bonus?.name ?? entry.sources?.[0] ?? fromId(entry.id);
}

/** Every equipped item's own raw stat (pre-bonus, pre-pipeline) -- summed by item name, since
 * the same item in two slots (two rings) contributes twice under one line, not two. */
function itemSources(result: ResolvedBuild, key: StatKey): StatSource[] {
  const totals = new Map<string, number>();
  for (const row of result.rows) {
    const raw = row.item?.[key];
    if (!row.item || !raw) continue;
    totals.set(
      row.item.name,
      (totals.get(row.item.name) ?? 0) + (raw as number),
    );
  }
  return [...totals].map(([name, value]) => ({ name, value }));
}

/** Every active bonus's applied (post-stacking) contribution to this stat. */
function bonusSources(result: ResolvedBuild, key: StatKey): StatSource[] {
  const out: StatSource[] = [];
  for (const entry of result.bonuses) {
    const value = entry.active ? entry.appliedStats?.[key] : null;
    if (value) out.push({ name: bonusTitle(entry), value });
  }
  return out;
}

/** Stage 2: a typed dynamic weapon modification, attributed to the item that carries it. */
function weaponModSources(
  result: ResolvedBuild,
  build: Build | null | undefined,
  key: StatKey,
): StatSource[] {
  const out: StatSource[] = [];
  for (const row of result.rows) {
    if (row.item?.dynamicStat !== key) continue;
    const typed = build?.values?.[row.slotId];
    if (typed == null) continue;
    const value = Number(typed) || 0;
    if (value) out.push({ name: `${row.item.name} (weapon mod)`, value });
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
  key: StatKey,
): StatSource[] {
  return [
    ...ratingContributionSource(result, key),
    ...itemSources(result, key),
    ...bonusSources(result, key),
    ...weaponModSources(result, build, key),
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
  key: StatKey,
): StatSourceSection[] {
  const rule = NW_SCHEMA.ratingConversion.find((r) => r.rating === key);
  if (rule) {
    return [
      {
        title: "Rating",
        key: rule.rating,
        sources: sourcesFor(result, build, rule.rating),
      },
      {
        title: "Percentage",
        key: rule.percent,
        sources: sourcesFor(result, build, rule.percent),
      },
    ];
  }
  return [{ title: "", key, sources: sourcesFor(result, build, key) }];
}
