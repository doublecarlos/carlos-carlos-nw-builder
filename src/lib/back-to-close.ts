// Lets the browser's Back close an open overlay on a touch layout instead of leaving the page.
//
// Every open overlay keeps one marker entry on top of history, with the same URL as the entry
// under it. Back pops a marker to close the innermost overlay, and closing any other way steps
// back over one, so no stray entry is left behind. Each marker records its depth, so a pop
// tells how many overlays it closed, and a Forward onto an old marker is stepped back off.
//
// Route writes go through `beneath`: with markers on top, it steps back over them, writes the
// route, then pushes markers again for whatever is still open. A route never lands above a
// marker, so Back always means "close the innermost overlay" first and "previous route" after.
//
// Every pop this makes is swallowed before the app's own popstate handlers (App.vue's route
// sync, LayerEditor's selection restore) see it. Listeners on the window itself run in the
// order they were added, whatever their capture flag, so the shared instance listens from
// module load, ahead of any component's setup.

/** The key flagging a marker entry's history state. Its value is the marker's depth. */
export const MARKER = "backToClose";

/** How long a traversal waits for its own pop before giving up on it. */
const SETTLE_TIMEOUT_MS = 1000;

/** The slice of `window` this needs. */
export interface BackHost {
  history: Pick<History, "state" | "pushState" | "go">;
  location: Pick<Location, "href">;
  addEventListener(
    type: "popstate",
    listener: (event: Event) => void,
    options: { capture: boolean },
  ): void;
}

/** One open overlay. An object rather than its `close`, so the same function can hold twice. */
interface Held {
  close: () => void;
}

/** The depth of the marker `state` belongs to, or 0 for an ordinary entry. */
export function markerDepth(state: unknown): number {
  if (!state || typeof state !== "object" || !(MARKER in state)) return 0;
  const depth = (state as Record<string, unknown>)[MARKER];
  return typeof depth === "number" && depth > 0 ? depth : 0;
}

export function createBackToClose(host: BackHost) {
  /** The open overlays, innermost last. */
  const held: Held[] = [];
  /** Marker entries currently on top of history. Matches `held.length` whenever idle. */
  let markers = 0;
  /** Steps waiting for a traversal to land before they run, in order. */
  const queue: (() => void)[] = [];
  /** Resolves the traversal in flight once its pop arrives. */
  let settling: (() => void) | null = null;
  /** Callers waiting for the queue to drain. */
  let waiters: (() => void)[] = [];

  /** Moves `delta` entries and pauses the queue until the pop lands. */
  function traverse(delta: number) {
    const done = () => {
      clearTimeout(timer);
      settling = null;
      pump();
    };
    const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
    settling = done;
    host.history.go(delta);
  }

  function pump() {
    while (!settling) {
      const step = queue.shift();
      if (!step) break;
      step();
    }
    if (settling || queue.length) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  }

  function run(...steps: (() => void)[]) {
    queue.push(...steps);
    pump();
  }

  /** Resolves once every queued history change has landed. */
  function idle(): Promise<void> {
    if (!settling && !queue.length) return Promise.resolve();
    return new Promise((resolve) => waiters.push(resolve));
  }

  /** Brings the marker count in line with the open overlays. */
  function reconcile() {
    if (markers > held.length) {
      const extra = markers - held.length;
      markers = held.length;
      traverse(-extra);
      return;
    }
    while (markers < held.length) {
      const state: unknown = host.history.state;
      markers += 1;
      host.history.pushState(
        {
          ...(state && typeof state === "object" ? state : {}),
          [MARKER]: markers,
        },
        "",
        host.location.href,
      );
    }
  }

  /** Steps back over every marker, leaving the route entry under them on top. */
  function unwind() {
    if (!markers) return;
    const count = markers;
    markers = 0;
    traverse(-count);
  }

  function onPopState(event: Event) {
    if (settling) {
      event.stopImmediatePropagation();
      settling();
      return;
    }
    const depth = markerDepth(host.history.state);
    if (depth > markers) {
      // Forward onto a marker whose overlay is gone: step back off it.
      event.stopImmediatePropagation();
      run(() => traverse(markers - depth));
      return;
    }
    if (depth === markers) return;
    event.stopImmediatePropagation();
    const closing = held.splice(held.length - (markers - depth)).reverse();
    markers = depth;
    for (const entry of closing) entry.close();
  }

  host.addEventListener("popstate", onPopState, { capture: true });

  // A reload while an overlay was open lands on its marker, with nothing open to own it.
  const stale = markerDepth(host.history.state);
  if (stale) traverse(-stale);

  /** Pushes a marker. `close` runs when Back pops it. Returns the release for closing any
   *  other way, which resolves once the marker is gone. */
  function hold(close: () => void): () => Promise<void> {
    const entry: Held = { close };
    held.push(entry);
    run(reconcile);

    return () => {
      const at = held.indexOf(entry);
      if (at !== -1) {
        held.splice(at, 1);
        run(reconcile);
      }
      return idle();
    };
  }

  /** Runs a route write under any open overlay's markers, at once when there are none. */
  function beneath(write: () => void) {
    run(unwind, write, reconcile);
  }

  return { hold, beneath, idle };
}

/** `createBackToClose` over the real window. */
const shared = typeof window === "undefined" ? null : createBackToClose(window);

export function holdBack(close: () => void): () => Promise<void> {
  if (!shared) throw new Error("holdBack needs a window");
  return shared.hold(close);
}

/** Runs `write`, a history push or replace, beneath any overlay markers. */
export function beneathBack(write: () => void) {
  if (shared) shared.beneath(write);
  else write();
}
