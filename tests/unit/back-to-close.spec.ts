// Back closing a phone overlay: a marker entry Back pops, and closing otherwise steps over it,
// with neither pop reaching the app's own popstate handling.
import { describe, expect, it, vi } from "vitest";
import { MARKER, createBackToClose } from "../../src/lib/back-to-close";

/** A window with an in-memory history, whose traversals fire popstate a task later. */
function fakeWindow() {
  const target = new EventTarget();
  const entries: { state: unknown; href: string }[] = [
    { state: { build: "b1" }, href: "/?build=b1" },
  ];
  let index = 0;
  const traverse = (to: number) => {
    if (to < 0 || to >= entries.length) return;
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
      replaceState(state: unknown) {
        entries[index] = { ...entries[index], state };
      },
      back: () => traverse(index - 1),
    },
    location: {
      get href() {
        return entries[index].href;
      },
    },
    addEventListener: target.addEventListener.bind(target),
  };
  /** The app's own popstate handler, registered after the overlay's, as App.vue's is. */
  const app = vi.fn();
  return {
    host,
    app,
    listen: () => target.addEventListener("popstate", app),
    entries,
    index: () => index,
  };
}

const popped = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("createBackToClose", () => {
  it("pushes a marker with the same URL, and Back closes the overlay", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const close = vi.fn();
    hold(close);
    win.listen();

    expect(win.entries).toHaveLength(2);
    expect(win.entries[1].href).toBe("/?build=b1");
    expect(win.entries[1].state).toEqual({ build: "b1", [MARKER]: true });

    win.host.history.back();
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
    win.host.history.back();
    await popped();
    expect(win.app).toHaveBeenCalledOnce();
  });

  it("leaves history alone once a route change replaced the marker", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const release = hold(vi.fn());
    win.host.history.replaceState({ build: "b1", tab: "bonuses" });

    await release();
    expect(win.index()).toBe(1);
  });

  it("releasing twice steps back once", async () => {
    const win = fakeWindow();
    const { hold } = createBackToClose(win.host);
    const release = hold(vi.fn());
    await release();
    await release();
    expect(win.index()).toBe(0);
  });
});
