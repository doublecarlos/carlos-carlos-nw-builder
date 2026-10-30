// Thin wrapper over the History API so the URL's query string mirrors a bit of UI state --
// which build/view/tab is active, which item is open in the editor -- and back/forward moves
// through it. Deliberately dumb: it knows nothing about the app's state shape, just how to
// merge a partial set of params onto the current query string.
//
// Query string, not a path: any static host serves `index.html` by path only, so a route like
// `/builds/abc` would 404 on refresh. `?build=abc` always resolves, because the path never
// changes. The hash is carried through untouched: nothing in the app puts anything there, and
// dropping it would be a side effect this module has no reason to cause.
//
// Writes go beneath any open overlay's Back marker (lib/back-to-close.ts), which can make them
// wait a moment for history to step back first. Until they land, `parse` answers with the
// params they will write, so the app reads one consistent route either way.
import { beneathBack } from "./back-to-close";

/** The params of the last write still waiting to land, if any. */
let pending: Record<string, string> | null = null;

export const parse = (): Record<string, string> =>
  pending
    ? { ...pending }
    : Object.fromEntries(new URLSearchParams(window.location.search));

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
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...current, ...partial })) {
    if (value != null && value !== "") merged[key] = value;
  }
  const changed = JSON.stringify(merged) !== JSON.stringify(current);
  pending = merged;
  beneathBack(() => {
    const url = serialize(merged);
    if (push && changed) window.history.pushState(merged, "", url);
    else window.history.replaceState(merged, "", url);
    if (pending === merged) pending = null;
  });
}
