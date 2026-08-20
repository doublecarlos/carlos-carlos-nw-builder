// What the "go to" palette lists, and how a query orders it.
//
// Ranking rather than plain filtering, because the palette's whole promise is that the first
// row is the one you meant: typing "gear" has to put the Gear *section* above the eight gear
// slots whose detail line merely mentions it, and `matchesQuery` alone -- which only answers
// yes/no -- cannot say that.
import { matchesQuery } from "./text-filter";

export type GoToKind = "section" | "slot" | "build" | "layer";

export interface GoToEntry {
  /** Unique across kinds (ids are only unique within one), for `:key` and test hooks. */
  key: string;
  kind: GoToKind;
  /** The target's own id: a section id, slot id, build id or layer id. */
  id: string;
  label: string;
  /** Secondary line -- a slot's section and current choice, a build's own summary. Searched
   *  too, but only at the weakest tier, so a label match always outranks it. */
  detail?: string;
  /** slot entries only: the section that has to be open before the row exists at all. */
  sectionId?: string;
}

/** Breaks a score tie so equal matches come out in a stable, sensible order rather than
 *  whatever order the sources happened to be concatenated in. */
const KIND_RANK: Record<GoToKind, number> = {
  section: 0,
  build: 1,
  layer: 2,
  slot: 3,
};

/** Lower is better; `null` drops the entry. The tiers are ordered by how much of the label the
 *  query accounts for, strongest first, with the whitespace-splitting `matchesQuery` last so
 *  "off mod" still reaches "Offhand Mod 1" without outranking a real prefix hit. */
function scoreOf(entry: GoToEntry, query: string): number | null {
  const label = entry.label.toLowerCase();
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 2;
  if (label.includes(query)) return 3;
  if (matchesQuery([entry.label, entry.detail ?? ""], query)) return 4;
  return null;
}

/**
 * Orders `entries` for `query`, dropping the ones it does not reach. An empty query keeps
 * every entry in its given order -- an opened palette should show what is there, not nothing.
 *
 * `limit` caps the rendered list: 180 slots is more rows than a modal can usefully show, and
 * past the first handful nobody is reading, they are typing.
 */
export function rankEntries(
  entries: GoToEntry[],
  query: string,
  limit = 40,
): GoToEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return entries.slice(0, limit);
  return entries
    .map((entry, index) => ({ entry, index, score: scoreOf(entry, trimmed) }))
    .filter((row): row is { entry: GoToEntry; index: number; score: number } =>
      Number.isInteger(row.score),
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        KIND_RANK[a.entry.kind] - KIND_RANK[b.entry.kind] ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map((row) => row.entry);
}
