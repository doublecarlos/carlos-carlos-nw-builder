// Shared substring matcher for filter/search inputs across the app. Splits the query on
// whitespace so "cel ame" matches "Celestial Amethyst" -- each word must appear somewhere in
// the haystack, but the words don't need to be adjacent or in order.

/**
 * True when every whitespace-separated word in `query` is a case-insensitive substring of
 * `haystack`. `haystack` may be a list of fields (e.g. a label and a stat summary) -- a query
 * word may match in any of them, not just one.
 */
export function matchesQuery(
  haystack: string | string[],
  query: string,
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = (
    Array.isArray(haystack) ? haystack.join(" ") : haystack
  ).toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * `matchesQuery` over a list of entries, with any entry whose `value` is exactly the query
 * (case-insensitive) moved to the front -- a pasted id lands on its own row rather than
 * somewhere among the rows it happens to be a substring of. Stable otherwise, so the rest keep
 * the caller's order. `haystack` is what a query word may match in; `value` is what "exactly
 * the query" compares against, and need not be in the haystack.
 */
export function filterAndRank<T>(
  entries: T[],
  query: string,
  haystack: (entry: T) => string | string[],
  value: (entry: T) => string,
): T[] {
  const typed = query.trim().toLowerCase();
  const isExact = (entry: T) => value(entry).toLowerCase() === typed;
  return entries
    .filter((entry) => matchesQuery(haystack(entry), query))
    .sort((a, b) => Number(isExact(b)) - Number(isExact(a)));
}
