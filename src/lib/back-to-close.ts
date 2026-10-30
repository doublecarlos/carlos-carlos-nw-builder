// Lets the browser's Back close a full-screen overlay on a phone instead of leaving the page.
//
// Opening pushes a marker entry with the same URL, and Back pops it to close the overlay.
// Closing any other way steps back over the marker, so no stray entry is left behind. Either pop
// is swallowed before the app's own popstate handlers (App.vue's route sync) see it: they run
// on the same window, and a capture listener at the target runs ahead of them.
//
// One overlay holds Back at a time.

/** The key flagging a marker entry's history state. */
export const MARKER = "backToClose";

/** How long a release waits for its own pop before giving up on it. */
const SETTLE_TIMEOUT_MS = 1000;

/** The slice of `window` this needs. */
export interface BackHost {
  history: Pick<History, "state" | "pushState" | "back">;
  location: Pick<Location, "href">;
  addEventListener(
    type: "popstate",
    listener: (event: Event) => void,
    options: { capture: boolean },
  ): void;
}

export function createBackToClose(host: BackHost) {
  /** The open overlay's close, while its marker is on top. */
  let onBack: (() => void) | null = null;
  /** Resolves a release once the pop it started arrives. */
  let settling: (() => void) | null = null;
  let listening = false;

  function onPopState(event: Event) {
    if (settling) {
      event.stopImmediatePropagation();
      settling();
      return;
    }
    if (!onBack) return;
    const close = onBack;
    onBack = null;
    event.stopImmediatePropagation();
    close();
  }

  /** Pushes the marker. `close` runs when Back pops it. Returns the release for closing any
   *  other way, which resolves once the marker is gone, so a caller about to change the route
   *  itself can wait for it. */
  function hold(close: () => void): () => Promise<void> {
    if (!listening) {
      host.addEventListener("popstate", onPopState, { capture: true });
      listening = true;
    }
    const state: unknown = host.history.state;
    host.history.pushState(
      { ...(state && typeof state === "object" ? state : {}), [MARKER]: true },
      "",
      host.location.href,
    );
    onBack = close;

    return () => {
      if (onBack !== close) return Promise.resolve();
      onBack = null;
      // A route change pushed or replaced over the marker since: no entry of ours to step over.
      const top: unknown = host.history.state;
      if (!(top && typeof top === "object" && MARKER in top))
        return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          settling = null;
          resolve();
        };
        const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
        settling = done;
        host.history.back();
      });
    };
  }

  return { hold };
}

let shared: ReturnType<typeof createBackToClose> | null = null;

/** `createBackToClose` over the real window, made on first use. */
export function holdBack(close: () => void): () => Promise<void> {
  shared ??= createBackToClose(window);
  return shared.hold(close);
}
