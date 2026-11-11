// The query params that name the app's places, and the policy for each: whether a change to it
// is a history stop of its own, and whether it can unmount an editor form.
//
// Query string, not a path: any static host serves `index.html` by path only, so a route like
// `/builds/abc` would 404 on refresh. `?build=abc` always resolves, because the path never
// changes.

interface ParamPolicy {
  /** A change to this param is a step Back undoes. Otherwise it replaces the current entry. */
  push: boolean;
  /** A change to this param can unmount an editor form, so a dirty draft gets asked about. */
  guarded: boolean;
}

const PLACE: ParamPolicy = { push: true, guarded: true };
/** A place change that never unmounts a form. */
const VIEW: ParamPolicy = { push: true, guarded: false };
/** A setting of the current place: not a step of its own. */
const SETTING: ParamPolicy = { push: false, guarded: false };

/** Every route param, in the order they appear in the URL. */
export const ROUTE_PARAMS = {
  build: PLACE,
  layer: PLACE,
  // BuildDetails' tab.
  tab: VIEW,
  // The stable reference's tab, while it is open on no group.
  stable: VIEW,
  // The phone's pane; the editor is the default and stays off the URL.
  pane: VIEW,
  // LayerEditor: its tab, the open entry of one group, or a group's new draft.
  section: PLACE,
  item: PLACE,
  bonus: PLACE,
  filter: PLACE,
  preset: PLACE,
  slot: PLACE,
  sectionId: PLACE,
  new: PLACE,
  // LayerEditor's list filters.
  status: SETTING,
  q: SETTING,
  // A one-shot flag the maintainer store reads and drops.
  maintainer: SETTING,
} as const satisfies Record<string, ParamPolicy>;

export type RouteKey = keyof typeof ROUTE_PARAMS;

export const ROUTE_KEYS = Object.keys(ROUTE_PARAMS) as RouteKey[];

/** The current place. An absent key is the param's default. */
export type Route = Readonly<Partial<Record<RouteKey, string>>>;

/** A change to the route. `null` or `""` drops the key. */
export type RoutePatch = Partial<Record<RouteKey, string | null | undefined>>;

const isRouteKey = (key: string): key is RouteKey => key in ROUTE_PARAMS;

/** The route a query string names. Unknown and empty params are dropped. */
export function parseQuery(search: string): Route {
  const route: Partial<Record<RouteKey, string>> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (isRouteKey(key) && value) route[key] = value;
  }
  return route;
}

/** The query string for `route`, without the leading `?`. */
export function serializeQuery(route: Route): string {
  const query = new URLSearchParams();
  for (const key of ROUTE_KEYS) {
    const value = route[key];
    if (value) query.set(key, value);
  }
  return query.toString();
}

export function mergeRoute(route: Route, patch: RoutePatch): Route {
  const merged: Partial<Record<RouteKey, string>> = {};
  for (const key of ROUTE_KEYS) {
    const value = key in patch ? patch[key] : route[key];
    if (value) merged[key] = value;
  }
  return merged;
}

/** The patch that turns any route into `route`. */
export function patchTo(route: Route): RoutePatch {
  return Object.fromEntries(ROUTE_KEYS.map((key) => [key, route[key] ?? null]));
}

export function changedKeys(from: Route, to: Route): RouteKey[] {
  return ROUTE_KEYS.filter((key) => from[key] !== to[key]);
}

/** A change pushes when any param it touches is a place of its own. */
export const pushes = (changed: readonly RouteKey[]) =>
  changed.some((key) => ROUTE_PARAMS[key].push);

/** Whether a change can unmount a form. */
export const guarded = (changed: readonly RouteKey[]) =>
  changed.some((key) => ROUTE_PARAMS[key].guarded);
