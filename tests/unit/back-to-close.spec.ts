// Back closing an overlay: marker entries Back pops, closing otherwise steps over them, route
// writes land beneath them, and none of those pops reaches the app's own popstate handling.
import { describe, expect, it, vi } from "vitest";
import {
  MARKER,
  createBackToClose,
  markerDepth,
} from "../../src/lib/back-to-close";

interface Entry {
  state: unknown;
  href: string;
}

/** A window with an in-memory history, whose traversals fire popstate a task later. */
function fakeWindow(
  initial: Entry[] = [{ state: { build: "b1" }, href: "/?build=b1" }],
) {
  const target = new EventTarget();
  const entries: Entry[] = [...initial];
  let index = entries.length - 1;
  const go = (delta: number) => {
    const to = index + delta;
    if (delta === 0 || to < 0 || to >= entries.length) return;
    index = to;
    setTimeout(() => target.dispatchEvent(new Event("popstate")));
  };
  const host = {
    history: {
      get state() {
        return entries[index].state;
      },
      pushState(state: unknown, _unused: string, href?: string | URL | null) {
        entries.splice(index + 1);
        entries.push({ state, href: String(href ?? entries[index].href) });
        index += 1;
      },
      replaceState(
        state: unknown,
        _unused: string,
        href?: string | URL | null,
      ) {
        entries[index] = { state, href: String(href ?? entries[index].href) };
      },
      go,
    },
    location: {
      get href() {
        return entries[index].href;
      },
    },
    addEventListener: target.addEventListener.bind(target),
  };
  /** The app's own popstate handler, registered after the shared instance listens at module
   *  load, as App.vue's and LayerEditor's are. */
  const app = vi.fn();
  return {
    host,
    app,
    listen: () => target.addEventListener("popstate", app),
    entries,
    index: () => index,
    /** The hrefs from the first entry up to the current one. */
    stack: () => entries.slice(0, index + 1).map((entry) => entry.href),
    back: () => go(-1),
    forward: () => go(1),
  };
}

const popped = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("markerDepth", () => {
  it("reads a marker's depth and treats anything else as an ordinary entry", () => {
    expect(markerDepth({ build: "b1", [MARKER]: 2 })).toBe(2);
    expect(markerDepth({ build: "b1" })).toBe(0);
    expect(markerDepth(null)).toBe(0);
    expect(markerDepth({ [MARKER]: true })).toBe(0);
  });
});

describe("createBackToClose", () => {
  it("pushes a marker with the same URL, and Back closes the overlay", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const close = vi.fn();
    hold(close);
    win.listen();

    expect(win.entries).toHaveLength(2);
    expect(win.entries[1].href).toBe("/?build=b1");
    expect(win.entries[1].state).toEqual({ build: "b1", [MARKER]: 1 });

    win.back();
    await popped();
    expect(close).toHaveBeenCalledOnce();
    expect(win.app).not.toHaveBeenCalled();
    expect(win.index()).toBe(0);
  });

  it("closing another way steps back over the marker without telling the app", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const close = vi.fn();
    const release = hold(close);
    win.listen();

    await release();
    expect(win.index()).toBe(0);
    expect(close).not.toHaveBeenCalled();
    expect(win.app).not.toHaveBeenCalled();

    // A later Back is the app's again.
    win.host.history.pushState({ build: "b2" }, "", "/?build=b2");
    win.back();
    await popped();
    expect(win.app).toHaveBeenCalledOnce();
  });

  it("swallows the pop for an app handler added before the first hold", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    win.listen();

    await hold(vi.fn())();
    expect(win.index()).toBe(0);
    expect(win.app).not.toHaveBeenCalled();
  });

  it("releasing twice steps back once", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const release = hold(vi.fn());
    await release();
    await release();
    expect(win.index()).toBe(0);
  });

  it("Back closes a nested overlay first, then the one under it", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const outer = vi.fn();
    const inner = vi.fn();
    hold(outer);
    hold(inner);
    win.listen();

    win.back();
    await popped();
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();

    win.back();
    await popped();
    expect(outer).toHaveBeenCalledOnce();
    expect(win.index()).toBe(0);
    expect(win.app).not.toHaveBeenCalled();
  });

  it("releasing a nested overlay leaves Back with the one under it", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const outer = vi.fn();
    hold(outer);
    const releaseInner = hold(vi.fn());
    win.listen();

    await releaseInner();
    expect(win.index()).toBe(1);

    win.back();
    await popped();
    expect(outer).toHaveBeenCalledOnce();
    expect(win.index()).toBe(0);
    expect(win.app).not.toHaveBeenCalled();
  });

  it("releasing the outer overlay first still leaves one marker for the inner", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const releaseOuter = hold(vi.fn());
    const inner = vi.fn();
    hold(inner);

    await releaseOuter();
    expect(win.index()).toBe(1);

    win.back();
    await popped();
    expect(inner).toHaveBeenCalledOnce();
    expect(win.index()).toBe(0);
  });

  it("writes at once when no overlay is open", () => {
    const win = fakeWindow();
    const { beneath } = createBackToClose(win.host);
    beneath(() =>
      win.host.history.pushState({ build: "b2" }, "", "/?build=b2"),
    );
    expect(win.stack()).toEqual(["/?build=b1", "/?build=b2"]);
  });

  it("a route push under an open overlay lands beneath its marker", async () => {
    const win = fakeWindow();
    const { hold, beneath, idle } = createBackToClose(win.host);
    const close = vi.fn();
    hold(close);
    win.listen();

    beneath(() =>
      win.host.history.pushState({ build: "b2" }, "", "/?build=b2"),
    );
    await idle();
    expect(win.stack()).toEqual(["/?build=b1", "/?build=b2", "/?build=b2"]);
    expect(markerDepth(win.host.history.state)).toBe(1);

    // Back closes the overlay, then leaves the new route for the old one.
    win.back();
    await popped();
    expect(close).toHaveBeenCalledOnce();
    expect(win.app).not.toHaveBeenCalled();
    win.back();
    await popped();
    expect(win.app).toHaveBeenCalledOnce();
    expect(win.stack()).toEqual(["/?build=b1"]);
  });

  it("a route push as the overlay closes leaves only the route behind", async () => {
    const win = fakeWindow();
    const { hold, beneath, idle } = createBackToClose(win.host);
    const release = hold(vi.fn());

    beneath(() =>
      win.host.history.pushState({ build: "b2" }, "", "/?build=b2"),
    );
    void release();
    await idle();
    expect(win.stack()).toEqual(["/?build=b1", "/?build=b2"]);
  });

  it("a route write while a release is stepping back waits for it", async () => {
    const win = fakeWindow();
    const { hold, beneath, idle } = createBackToClose(win.host);
    const release = hold(vi.fn());

    void release();
    beneath(() =>
      win.host.history.pushState({ build: "b2" }, "", "/?build=b2"),
    );
    expect(win.stack()).toEqual(["/?build=b1"]);
    await idle();
    expect(win.stack()).toEqual(["/?build=b1", "/?build=b2"]);
  });

  it("Forward onto a closed overlay's marker steps back off it", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    hold(vi.fn());
    win.listen();

    win.back();
    await popped();
    win.forward();
    await popped();
    await popped();
    expect(win.index()).toBe(0);
    expect(win.app).not.toHaveBeenCalled();
  });

  it("starting on a marker left by a reload steps back off it", async () => {
    const win = fakeWindow([
      { state: { build: "b1" }, href: "/?build=b1" },
      { state: { build: "b1", [MARKER]: 1 }, href: "/?build=b1" },
    ]);
    const { idle } = createBackToClose(win.host);
    await idle();
    expect(win.index()).toBe(0);
  });
});
