// The one owner of the app's places in history. A place is a route (lib/route-model.ts) in the
// query string; transient layers (modals, sheets, drawers) hold Back through lib/back-to-close.ts
// and never write the URL.
//
// - `write` merges a patch onto the route. The policy table decides push or replace; a caller
//   can only mark a write transient, for steps like arrow-key browsing.
// - `retreat` leaves the current place the way Back would, without adding an entry.
// - Back and Forward land through guards. A guard that objects gets history put back first and
//   asks after, so a veto leaves every entry where it was.
// - `onTraverse` listeners apply a place Back or Forward landed on. A write never reaches them:
//   whoever writes already holds the state it wrote.
//
// Every entry records its position and the query of the entry before it, so a traversal knows
// how far it went and `retreat` knows where Back leads.
import { shallowRef, type ShallowRef } from "vue";
import {
  markerDepth,
  shared as sharedBackToClose,
  type BackToClose,
} from "./back-to-close";
import {
  changedKeys,
  guarded,
  mergeRoute,
  parseQuery,
  patchTo,
  pushes,
  serializeQuery,
  type Route,
  type RoutePatch,
} from "./route-model";

const POSITION = "navPosition";
const PREVIOUS = "navPrevious";

/** Returns `null` to let a navigation through, or the question to ask before it lands. */
export type Guard = (to: Route, from: Route) => (() => Promise<boolean>) | null;

export type TraverseListener = (to: Route, from: Route) => void;

/** The slice of `window` this needs. */
export interface NavigationHost {
  history: Pick<History, "state" | "pushState" | "replaceState">;
  location: Pick<Location, "pathname" | "search" | "hash">;
  addEventListener(type: "popstate", listener: () => void): void;
}

type CloseStack = Pick<BackToClose, "beneath" | "go">;

function stateRecord(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" ? { ...state } : {};
}

function positionOf(state: unknown): number | null {
  const value = stateRecord(state)[POSITION];
  return typeof value === "number" ? value : null;
}

export function createNavigation(host: NavigationHost, stack: CloseStack) {
  const route: ShallowRef<Route> = shallowRef(parseQuery(host.location.search));
  const guards: Guard[] = [];
  const listeners: TraverseListener[] = [];
  let position = positionOf(host.history.state) ?? 0;

  const hrefOf = (to: Route) => {
    const query = serializeQuery(to);
    return `${host.location.pathname}${query ? `?${query}` : ""}${host.location.hash}`;
  };

  if (positionOf(host.history.state) === null) {
    host.history.replaceState(
      { ...stateRecord(host.history.state), [POSITION]: position },
      "",
      hrefOf(route.value),
    );
  }

  function write(patch: RoutePatch, { transient = false } = {}) {
    const from = route.value;
    const to = mergeRoute(from, patch);
    const changed = changedKeys(from, to);
    if (!changed.length) return;
    route.value = to;
    const push = !transient && pushes(changed);
    stack.beneath(() => {
      if (push) {
        const previous = serializeQuery(from);
        position += 1;
        host.history.pushState(
          { [POSITION]: position, [PREVIOUS]: previous },
          "",
          hrefOf(to),
        );
      } else {
        host.history.replaceState(
          { ...stateRecord(host.history.state), [POSITION]: position },
          "",
          hrefOf(to),
        );
      }
    });
  }

  /** Leaves for `patch` merged onto the route: a step Back when the entry before is that place,
   *  otherwise a replace. Guards are not asked; the caller already has. */
  async function retreat(patch: RoutePatch): Promise<void> {
    const to = mergeRoute(route.value, patch);
    const previous = stateRecord(host.history.state)[PREVIOUS];
    if (previous !== serializeQuery(to)) {
      write(patch, { transient: true });
      return;
    }
    route.value = to;
    await stack.go(-1);
    position = positionOf(host.history.state) ?? position - 1;
    route.value = parseQuery(host.location.search);
  }

  function land(to: Route, at: number | null) {
    const from = route.value;
    if (at !== null) position = at;
    route.value = to;
    for (const listener of [...listeners]) listener(to, from);
  }

  function question(to: Route, from: Route) {
    if (!guarded(changedKeys(from, to))) return null;
    for (const guard of guards) {
      const ask = guard(to, from);
      if (ask) return ask;
    }
    return null;
  }

  async function arrive() {
    const to = parseQuery(host.location.search);
    const from = route.value;
    const at = positionOf(host.history.state);
    const ask = question(to, from);
    if (!ask) {
      land(to, at);
      return;
    }
    if (at === null || at === position) {
      // An entry from before positions were recorded: ask, and put the URL back on a veto.
      if (await ask()) land(to, at);
      else write(patchTo(from), { transient: true });
      return;
    }
    const delta = at - position;
    await stack.go(-delta);
    if (!(await ask())) return;
    if (delta < 0) {
      await stack.go(delta);
      land(parseQuery(host.location.search), positionOf(host.history.state));
      return;
    }
    // The dialog's own Back marker cut the forward entries: push the place instead.
    write(patchTo(to));
    for (const listener of [...listeners]) listener(to, from);
  }

  host.addEventListener("popstate", () => {
    // A marker pop reaching here is one back-to-close lets through as a no-op.
    if (markerDepth(host.history.state)) return;
    void arrive();
  });

  function addGuard(guard: Guard): () => void {
    guards.push(guard);
    return () => {
      const at = guards.indexOf(guard);
      if (at !== -1) guards.splice(at, 1);
    };
  }

  function onTraverse(listener: TraverseListener): () => void {
    listeners.push(listener);
    return () => {
      const at = listeners.indexOf(listener);
      if (at !== -1) listeners.splice(at, 1);
    };
  }

  return { route, write, retreat, addGuard, onTraverse };
}

export type Navigation = ReturnType<typeof createNavigation>;

/** History kept in memory, for running without a window (unit tests, scripts). */
function memoryHost(): NavigationHost {
  let state: unknown = null;
  let search = "";
  const set = (next: unknown, href?: string | URL | null) => {
    state = next;
    if (href != null) search = new URL(String(href), "http://memory").search;
  };
  return {
    history: {
      get state() {
        return state;
      },
      pushState: (next, _unused, href) => set(next, href),
      replaceState: (next, _unused, href) => set(next, href),
    },
    location: {
      pathname: "/",
      get search() {
        return search;
      },
      hash: "",
    },
    addEventListener: () => {},
  };
}

/** The app's navigation, over the real window when there is one. */
export const navigation: Navigation =
  typeof window !== "undefined" && sharedBackToClose
    ? createNavigation(window, sharedBackToClose)
    : createNavigation(memoryHost(), {
        beneath: (write) => write(),
        go: () => Promise.resolve(),
      });
