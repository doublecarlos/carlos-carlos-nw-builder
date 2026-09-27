// Per-stat source attribution for StatPanel.vue's stat source popover: "why is this number
// what it is", one stat at a time rather than one bonus at a time (BonusInspector.vue's own job).
//
// Reads the engine's ledger (`ResolvedBuild.ledger`), which records every contribution as the
// pipeline applies it. What is left here is display: naming each entry, ordering the lines and
// splitting a rating/percent pair into its two sections.
import { NW_SCHEMA } from "../data/data";
import { bonusTitle } from "../lib/format";
import type {
  EvaluatedBonus,
  LedgerEntry,
  LedgerKind,
  ResolvedBuild,
  StatKey,
} from "../types";

export interface StatSource {
  name: string;
  value: number;
  /** The build row this line came from; absent for a pipeline stage's own line (Rating
   * contribution, Combined rating, an ability score, Outgoing Healing, Forte, Over cap), which
   * has no row to jump to. */
  slotId?: string;
}
export interface StatSourceSection {
  title: string;
  key: string;
  sources: StatSource[];
  /** The stat's sources combine multiplicatively, so the lines do not simply add up. */
  multiplicative: boolean;
}

/** Line order within a section: the rating conversion leads, pipeline stages close. */
const KIND_ORDER: LedgerKind[] = [
  "ratingConversion",
  "item",
  "assignment",
  "bonus",
  "dynamic",
  "combinedRating",
  "contribution",
];

const statLabel = (key: StatKey) => NW_SCHEMA.statByKey[key]?.label ?? key;

/** Display name for one entry. */
function nameOf(
  entry: LedgerEntry,
  result: ResolvedBuild,
  bonusById: Map<string, EvaluatedBonus>,
): string {
  const itemName = (id: string) => result.context.itemNames.get(id) ?? id;
  switch (entry.kind) {
    case "item":
    case "assignment":
      return itemName(entry.itemId!);
    case "dynamic":
      return `${itemName(entry.itemId!)} (dynamic stat)`;
    case "bonus": {
      const bonus = bonusById.get(entry.bonusId!);
      return bonus ? bonusTitle(bonus) : entry.bonusId!;
    }
    case "combinedRating":
      return "Combined rating";
    case "ratingConversion":
      return "Rating contribution";
    case "contribution":
      return statLabel(entry.sourceStat!);
  }
}

/** The stats StatPanel.vue shows at their cap: a rating pair's percentage. A rating shows its
 * uncapped total, with the excess in its own column. */
const CAPPED_ON_PANEL = new Set(
  NW_SCHEMA.ratingConversion.map((r) => r.percent),
);

/** Every line for one stat key. A zero entry is left out, except the rating conversion, which
 * a paired percent stat always shows. Contribution rules reading the same source stat fold
 * into one line. A percentage over its cap closes with a negative "Over cap" line, so the
 * lines add up to the capped value the panel shows. */
function sourcesFor(
  result: ResolvedBuild,
  bonusById: Map<string, EvaluatedBonus>,
  key: StatKey,
): StatSource[] {
  const entries = result.ledger
    .filter(
      (entry) =>
        entry.stat === key &&
        (entry.value !== 0 || entry.kind === "ratingConversion"),
    )
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const out: StatSource[] = [];
  const bySourceStat = new Map<StatKey, StatSource>();
  for (const entry of entries) {
    if (entry.kind === "contribution") {
      const folded = bySourceStat.get(entry.sourceStat!);
      if (folded) {
        folded.value += entry.value;
        continue;
      }
    }
    const source: StatSource = {
      name: nameOf(entry, result, bonusById),
      value: entry.value,
    };
    if (entry.slotId) source.slotId = entry.slotId;
    if (entry.kind === "contribution")
      bySourceStat.set(entry.sourceStat!, source);
    out.push(source);
  }

  const overcap = CAPPED_ON_PANEL.has(key) ? result.stages.overcap[key] : 0;
  if (overcap > 0) out.push({ name: "Over cap", value: -overcap });
  return out;
}

function section(
  result: ResolvedBuild,
  bonusById: Map<string, EvaluatedBonus>,
  title: string,
  key: StatKey,
): StatSourceSection {
  return {
    title,
    key,
    sources: sourcesFor(result, bonusById, key),
    multiplicative: result.ledger.some(
      (entry) =>
        entry.stat === key &&
        entry.value !== 0 &&
        entry.combine === "multiplicative",
    ),
  };
}

/** One section for a plain stat, two (Rating / Percentage) for a rating+percent pair. */
export function sectionsFor(
  result: ResolvedBuild,
  key: StatKey,
): StatSourceSection[] {
  const bonusById = new Map(result.bonuses.map((bonus) => [bonus.id, bonus]));
  const rule = NW_SCHEMA.ratingConversion.find((r) => r.rating === key);
  if (rule) {
    return [
      section(result, bonusById, "Rating", rule.rating),
      section(result, bonusById, "Percentage", rule.percent),
    ];
  }
  return [section(result, bonusById, "", key)];
}
