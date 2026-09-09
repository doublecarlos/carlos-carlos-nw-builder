// BuildEditor.vue's per-row summary text and insignia bonus-slot placeholder, Vue-free so
// they are unit-testable.
import { NW_SCHEMA } from "../data/data";
import { abbr, signedStat } from "./format";
import { descriptionParagraphs } from "./description";
import { oneShortOf, slotSummary, stableRef } from "../engine/insignia";
import { scaledStat } from "../engine/scaling";
import type { Build, Db, EvaluatedBonus, Item } from "../types";

// The item's own stats plus whatever active bonuses are credited to this row, summed key by
// key rather than attributed separately -- one number per stat, not a name-tagged breakdown.
export function slotStatSummary(
  item: Item,
  scaleFactor: number,
  bonuses: EvaluatedBonus[],
): string {
  const totals: Record<string, number> = {};
  for (const key of NW_SCHEMA.statKeys) {
    if (item[key])
      totals[key] =
        (totals[key] ?? 0) + scaledStat(NW_SCHEMA, item, key, scaleFactor);
  }
  const descriptions: string[] = [];
  const slots = slotSummary(item);
  if (slots) descriptions.push(slots);
  descriptions.push(...descriptionParagraphs(item.shortDescription));
  for (const entry of bonuses) {
    for (const [key, value] of Object.entries(entry.appliedStats ?? {})) {
      totals[key] = (totals[key] ?? 0) + (value as number);
    }
    for (const grant of entry.grants ?? []) {
      if (grant.active) {
        descriptions.push(...descriptionParagraphs(grant.raw.shortDescription));
      }
    }
  }
  const parts = [...descriptions];
  for (const key of NW_SCHEMA.statKeys) {
    if (!totals[key]) continue;
    parts.push(`${abbr(key)} ${signedStat(key, totals[key])}`);
  }
  return parts.join(" • ");
}

// How many near misses a bonus row names before it settles for a count. One, because the row
// is an input's width and a second name only ever arrives half-cut.
const NEAR_MISSES_NAMED = 1;

// What a bonus-slot row reads as: what its group derives, or what it's one insignia short of.
// `derivedBonuses` is the caller's own group -> resolved-bonus lookup, passed in rather than
// recomputed here.
export function slotStablePlaceholder(
  db: Db,
  build: Build,
  slotId: string,
  derivedBonuses: Map<number, { name: string; counted: boolean }>,
): string | undefined {
  const ref = stableRef(db, slotId);
  if (ref?.role !== "bonus") return undefined;
  const derived = derivedBonuses.get(ref.group);
  if (derived) {
    return derived.counted ? derived.name : `${derived.name} (at cap)`;
  }
  const near = oneShortOf(db, build, ref.group);
  if (!near.length) return undefined;
  const named = near
    .slice(0, NEAR_MISSES_NAMED)
    .map((item) => item.name)
    .join(", ");
  const rest = near.length - NEAR_MISSES_NAMED;
  return rest > 0 ? `1 short of ${named} +${rest} more` : `1 short of ${named}`;
}
