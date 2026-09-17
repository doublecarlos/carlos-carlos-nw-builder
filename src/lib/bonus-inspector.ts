// BonusInspector.vue's list derivation, Vue-free so it is unit-testable.
import { isHiddenBonus } from "../engine/bonus";
import type { OccurrenceRow } from "../composables/useItemBonusOccurrences";
import type { BonusSource, EvaluatedBonus } from "../types";

/**
 * The bonuses the inspector lists: what the build carries. Also what the Bonuses tab badge
 * counts (stores/resolved.ts's `bonusCounts`), so the two never disagree on a total.
 *
 * A problem-only bonus (one that exists purely to report a build error/warning) is already
 * surfaced inline on its slot and in the errors summary; listed here too, especially while
 * inactive, it reads as a bonus that never grants anything. An uncarried bonus (bonus.ts's
 * `resolve()` seeds one for a carrier at 0 points) exists so the hover card can preview it,
 * but nothing on the build carries it yet. A carried bonus whose occurrence config sits at 0
 * is listed, inactive: the item is on the build and the player can switch the bonus on.
 */
export function inspectorBonuses(bonuses: EvaluatedBonus[]): EvaluatedBonus[] {
  return bonuses.filter(
    (entry) => !isHiddenBonus(entry.bonus) && isCarried(entry),
  );
}

/** Whether an item carrying this bonus is on the build: a real source, or a carrier whose
 *  occurrence config sits at 0. */
export function isCarried(entry: EvaluatedBonus): boolean {
  return entry.sources.length > 0 || entry.carrier != null;
}

export interface SourceLink {
  key: string;
  label: string;
}

/**
 * One link per distinct source. A perSource-stacking bonus with a player-set count lists the
 * same `{ name, slotId }` once per stack, which as a "from" list would repeat one name five
 * times; the count goes on the label instead. Two different items on one slot (a
 * point_assignment row holds several) stay apart, since their names differ.
 */
export function collapseSources(sources: BonusSource[]): SourceLink[] {
  const counts = new Map<string, { source: BonusSource; count: number }>();
  for (const source of sources) {
    const id = `${source.slotId}|${source.name}`;
    const seen = counts.get(id);
    if (seen) seen.count += 1;
    else counts.set(id, { source, count: 1 });
  }
  return [...counts.values()].map(({ source, count }) => ({
    key: source.slotId,
    label: count > 1 ? `${source.name} ×${count}` : source.name,
  }));
}

/**
 * One step from active: a single failing condition, or a carrier on the build whose gate is
 * met and only its occurrence control is off. Shared by the inspector's badge and the tab's
 * count, so "1 away" means one thing.
 */
export function isNearMiss(entry: EvaluatedBonus): boolean {
  if (entry.active || entry.excluded) return false;
  const unmet = entry.gate?.unmet?.length ?? 0;
  return unmet === 1 || (entry.carrier != null && unmet === 0);
}

/** How an occurrence control at 0 reads: a checkbox is "off", a stepper is at "0". Shared by
 *  the hover card's note and the inspector's reason line. */
export function occurrenceStateText(row: OccurrenceRow): string {
  return row.kind === "checkbox" ? "off" : "0";
}
