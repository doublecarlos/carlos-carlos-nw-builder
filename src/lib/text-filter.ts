// Shared substring matcher for filter/search inputs across the app. Splits the query on
// whitespace so "cel ame" matches "Celestial Amethyst" -- each word must appear somewhere in
// the haystack, but the words don't need to be adjacent or in order.

/** Lower case with hyphens dropped, so "offhand", "off-hand" and "off hand" find each other. */
export const searchText = (text: string) =>
  text.toLowerCase().replace(/-/g, "");

/**
 * True when every whitespace-separated word in `query` is a case-insensitive substring of
 * `haystack`. `haystack` may be a list of fields (e.g. a label and a stat summary) -- a query
 * word may match in any of them, not just one.
 */
export function matchesQuery(
  haystack: string | string[],
  query: string,
): boolean {
  const words = searchText(query.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = searchText(
    Array.isArray(haystack) ? haystack.join(" ") : haystack,
  );
  return words.every((word) => text.includes(word));
}

/**
 * `matchesQuery` over a list, with an entry whose exact key equals the query moved to the
 * front so a pasted id lands on its own row. `exact` lists an entry's keys by priority: an
 * entry matching on an earlier key ranks ahead of one matching on a later key. Stable
 * otherwise. The keys need not be in `haystack`.
 */
export function filterAndRank<T>(
  entries: T[],
  query: string,
  haystack: (entry: T) => string | string[],
  exact: (entry: T) => string | string[],
): T[] {
  const typed = query.trim().toLowerCase();
  const listed = entries.filter((entry) =>
    matchesQuery(haystack(entry), query),
  );
  if (!typed) return listed;
  const rank = (entry: T) => {
    const index = [exact(entry)]
      .flat()
      .findIndex((key) => key.toLowerCase() === typed);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return listed
    .map((entry) => ({ entry, rank: rank(entry) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ entry }) => entry);
}
