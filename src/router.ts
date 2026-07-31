// Thin wrapper over the History API so the URL's query string mirrors a bit of UI state --
// which build/view/tab is active, which item is open in the editor -- and back/forward moves
// through it. Deliberately dumb: it knows nothing about the app's state shape, just how to
// merge a partial set of params onto the current query string.
//
// Query string, not a path: any static host serves `index.html` by path only, so a route like
// `/builds/abc` would 404 on refresh. `?build=abc` always resolves, because the path never
// changes. The hash is left alone -- `storage.ts` already uses `#b=<payload>` for share links,
// consumed once on load.

export const parse = (): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(window.location.search));

const serialize = (params: Record<string, string | null | undefined>) => {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") qs.set(key, value);
  }
  const text = qs.toString();
  return `${window.location.pathname}${text ? `?${text}` : ""}${window.location.hash}`;
};

/** A param value of `null` drops the key out of the URL instead of appearing as the literal
 * string "null" -- see `apply` below. */
export type RouterParams = Record<string, string | null | undefined>;

/**
 * Merge `partial` onto the current query string and write it back. A key set to `null` (or
 * `''`) drops out of the URL instead of appearing as the literal string "null".
 *
 * `push: false` replaces the current history entry rather than adding one -- for state that
 * shouldn't itself be a back/forward stop (e.g. arrow-key browsing a list). `push: true` is
 * downgraded to a replace automatically when the merge is a no-op, so re-applying state that
 * came from a popstate event (which already updated the URL) can't double up the entry.
 */
export function apply(
  partial: RouterParams,
  { push = true }: { push?: boolean } = {},
) {
  const current = parse();
  const merged: Record<string, string | null | undefined> = {
    ...current,
    ...partial,
  };
  for (const key of Object.keys(merged)) {
    if (merged[key] == null || merged[key] === "") delete merged[key];
  }
  const changed = JSON.stringify(merged) !== JSON.stringify(current);
  const url = serialize(merged);
  if (push && changed) window.history.pushState(merged, "", url);
  else window.history.replaceState(merged, "", url);
}
