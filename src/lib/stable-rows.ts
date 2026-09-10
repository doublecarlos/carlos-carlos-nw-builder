// StableBrowser.vue's card derivation, Vue-free so it is unit-testable.
//
// Both ends are plain catalogue items (a mount carries `insigniaSlots`, a bonus
// `insigniaRecipe`), so one card shape serves both tabs and the tab only picks which end
// heads the card.
import { descriptionParagraphs } from "./description";
import { matchesQuery } from "./text-filter";
import {
  allBonuses,
  allMounts,
  mountsFor,
  reachableBonuses,
  slotLine,
} from "../engine/insignia";
import type { Reach } from "../engine/insignia";
import type { Db, Item } from "../types";

export type StableTab = "mount" | "bonus";

export interface StableReachRow {
  id: string;
  name: string;
  preferred: number;
  /** The opposite end's own item, so the row can offer it as the browse target. */
  item: Item;
  /** The row's own identity line, shown muted beside the name as a heading shows the head's. */
  meta: string;
  /** Only worth drawing on a head-matched card: on a row-matched one every listed row matched. */
  matched: boolean;
}

export interface StableCard {
  id: string;
  head: Item;
  name: string;
  /** The head's own one-line identity: a mount's slot line, a bonus's recipe. */
  meta: string;
  description: string[];
  rows: StableReachRow[];
  total: number;
  preferred: number;
  /** The head did not match, so `rows` holds only the rows that did, and the card stays open. */
  matchedByRow: boolean;
}

/** A mount's slot line, or an insignia bonus's recipe. */
export const metaLine = (item: Item): string =>
  item.insigniaSlots ? slotLine(item) : (item.insigniaRecipe ?? []).join(" · ");

const otherEnd = (reach: Reach, tab: StableTab) =>
  tab === "mount" ? reach.bonus : reach.mount;

/**
 * Every card a tab lists for `query`, matching heads and rows alike so either end of the
 * reference answers from either tab. Which half matched decides what the card shows: a head
 * match keeps every row, a row match narrows to the rows that matched. `total` stays the full
 * count either way.
 */
export function stableCards(
  db: Db,
  tab: StableTab,
  query: string,
): StableCard[] {
  const heads = tab === "mount" ? allMounts(db) : allBonuses(db);
  const text = query.trim();
  const out: StableCard[] = [];

  for (const head of [...heads].sort((a, b) => a.name.localeCompare(b.name))) {
    const reaches =
      tab === "mount" ? reachableBonuses(db, head) : mountsFor(db, head);
    const headMatches = !text || matchesQuery(head.name, text);
    const rows = reaches.map((reach): StableReachRow => {
      const item = otherEnd(reach, tab);
      return {
        id: item.id,
        name: item.name,
        preferred: reach.preferred,
        item,
        meta: metaLine(item),
        matched: !!text && matchesQuery(item.name, text),
      };
    });
    const rowMatches = rows.some((row) => row.matched);
    if (!headMatches && !rowMatches) continue;
    const matchedByRow = !headMatches;

    out.push({
      id: head.id,
      head,
      name: head.name,
      meta: metaLine(head),
      description: descriptionParagraphs(
        head.longDescription || head.shortDescription,
      ),
      rows: matchedByRow ? rows.filter((row) => row.matched) : rows,
      total: rows.length,
      preferred: rows.filter((row) => row.preferred > 0).length,
      matchedByRow,
    });
  }
  return out;
}
