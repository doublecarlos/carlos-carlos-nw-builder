// Navigation over a fake window: writes push or replace by the policy, `retreat` steps Back
// instead of adding an entry, and a guarded Back is put back before it asks, so a veto keeps
// every history entry where it was.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackToClose } from "../../src/lib/back-to-close";
import { createNavigation } from "../../src/lib/navigation";

interface Entry {
  state: unknown;
  href: string;
}

/** A window with an in-memory history, whose traversals fire popstate a task later. */
function fakeWindow(href = "/?build=b1") {
  const target = new EventTarget();
  const entries: Entry[] = [{ state: null, href }];
  let index = 0;
  const go = (delta: number) => {
    const to = index + delta;
    if (delta === 0 || to < 0 || to >= entries.length) return;
    index = to;
    setTimeout(() => target.dispatchEvent(new Event("popstate")));
  };
  const url = () => new URL(entries[index].href, "http://test");
  const host = {
    history: {
      get state() {
        return entries[index].state;
      },
      pushState(state: unknown, _unused: string, next?: string | URL | null) {
        entries.splice(index + 1);
        entries.push({ state, href: String(next ?? entries[index].href) });
        index += 1;
      },
      replaceState(
        state: unknown,
        _unused: string,
        next?: string | URL | null,
      ) {
        entries[index] = { state, href: String(next ?? entries[index].href) };
      },
      go,
    },
    location: {
      get href() {
        return entries[index].href;
      },
      get pathname() {
        return url().pathname;
      },
      get search() {
        return url().search;
      },
      get hash() {
        return url().hash;
      },
    },
    addEventListener: target.addEventListener.bind(target),
  };
  const backToClose = createBackToClose(host);
  const nav = createNavigation(host, backToClose);
  return {
    nav,
    backToClose,
    hrefs: () => entries.map((entry) => entry.href),
    index: () => index,
    back: () => go(-1),
    forward: () => go(1),
  };
}

/** Runs every pending traversal and whatever it sets off. */
const settled = () => vi.runAllTimersAsync();

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createNavigation", () => {
  it("reads the route the page loaded on", () => {
    expect(fakeWindow("/?layer=l1&item=a").nav.route.value).toEqual({
      layer: "l1",
      item: "a",
    });
  });

  it("pushes a place and replaces a setting", async () => {
    const win = fakeWindow();
    win.nav.write({ build: null, layer: "l1" });
    await settled();
    win.nav.write({ q: "ring" });
    // The route answers at once, before history catches up.
    expect(win.nav.route.value).toEqual({ layer: "l1", q: "ring" });
    await settled();
    expect(win.hrefs()).toEqual(["/?build=b1", "/?layer=l1&q=ring"]);
  });

  it("writes in one task are one step, a push if any of them pushes", async () => {
    // One action touching several stores (a tab and a pane, say) is one Back.
    const win = fakeWindow();
    win.nav.write({ q: "ring" });
    win.nav.write({ tab: "bonuses" });
    win.nav.write({ pane: "stats" }, { transient: true });
    await settled();
    expect(win.hrefs()).toEqual([
      "/?build=b1",
      "/?build=b1&tab=bonuses&pane=stats&q=ring",
    ]);
  });

  it("a transient write replaces even a place", async () => {
    const win = fakeWindow("/?layer=l1&item=a");
    win.nav.write({ item: "b" }, { transient: true });
    await settled();
    expect(win.hrefs()).toEqual(["/?layer=l1&item=b"]);
  });

  it("a write that changes nothing leaves history alone", async () => {
    const win = fakeWindow();
    win.nav.write({ build: "b1", item: null });
    await settled();
    expect(win.hrefs()).toEqual(["/?build=b1"]);
  });

  it("Back lands through the listeners, a write does not reach them", async () => {
    const win = fakeWindow();
    const listener = vi.fn();
    win.nav.onTraverse(listener);
    win.nav.write({ build: "b2" });
    await settled();
    expect(listener).not.toHaveBeenCalled();

    win.back();
    await settled();
    expect(listener).toHaveBeenCalledWith({ build: "b1" }, { build: "b2" });
    expect(win.nav.route.value).toEqual({ build: "b1" });
  });

  it("retreat steps Back onto the place before, adding no entry", async () => {
    const win = fakeWindow("/?layer=l1");
    win.nav.write({ item: "a" });
    await settled();
    const retreated = win.nav.retreat({ item: null });
    await settled();
    await retreated;
    expect(win.index()).toBe(0);
    expect(win.nav.route.value).toEqual({ layer: "l1" });

    // The entry the retreat left is still Forward.
    win.forward();
    await settled();
    expect(win.nav.route.value).toEqual({ layer: "l1", item: "a" });
  });

  it("retreat replaces when the entry before is another place", async () => {
    // A form opened by a reload or a deep link has nothing of its own behind it.
    const win = fakeWindow("/?layer=l1&item=a");
    await win.nav.retreat({ item: null });
    expect(win.hrefs()).toEqual(["/?layer=l1"]);
  });

  describe("a guarded Back", () => {
    async function guardedWindow(answer: boolean) {
      const win = fakeWindow("/?layer=l1");
      win.nav.write({ item: "a" });
      await settled();
      win.nav.write({ item: null, new: "items" });
      await settled();
      const listener = vi.fn();
      win.nav.onTraverse(listener);
      const ask = vi.fn(() => Promise.resolve(answer));
      win.nav.addGuard(() => ask);
      return { ...win, listener, ask };
    }

    it("is put back before it asks, and a veto keeps every entry", async () => {
      const win = await guardedWindow(false);
      win.back();
      await settled();
      expect(win.ask).toHaveBeenCalledOnce();
      expect(win.index()).toBe(2);
      expect(win.hrefs()).toHaveLength(3);
      expect(win.nav.route.value).toEqual({ layer: "l1", new: "items" });
      expect(win.listener).not.toHaveBeenCalled();
    });

    it("lands once the guard lets it through", async () => {
      const win = await guardedWindow(true);
      win.back();
      await settled();
      expect(win.index()).toBe(1);
      expect(win.nav.route.value).toEqual({ layer: "l1", item: "a" });
      expect(win.listener).toHaveBeenCalledOnce();
    });

    it("never asks about a change that cannot unmount a form", async () => {
      const win = await guardedWindow(false);
      win.nav.write({ pane: "stats" });
      await settled();
      win.back();
      await settled();
      expect(win.ask).not.toHaveBeenCalled();
      expect(win.nav.route.value).toEqual({ layer: "l1", new: "items" });
    });

    it("a guard returning null lets it through without asking", async () => {
      const win = fakeWindow("/?layer=l1");
      win.nav.write({ item: "a" });
      await settled();
      win.nav.addGuard(() => null);
      win.back();
      await settled();
      expect(win.nav.route.value).toEqual({ layer: "l1" });
    });
  });

  it("a write while an overlay holds Back lands beneath its marker", async () => {
    const win = fakeWindow();
    const close = vi.fn();
    win.backToClose.hold(close);
    win.nav.write({ build: "b2" });
    await settled();
    expect(win.hrefs()).toEqual(["/?build=b1", "/?build=b2", "/?build=b2"]);

    // Back closes the overlay first, then leaves the build.
    win.back();
    await settled();
    expect(close).toHaveBeenCalledOnce();
    expect(win.nav.route.value).toEqual({ build: "b2" });
    win.back();
    await settled();
    expect(win.nav.route.value).toEqual({ build: "b1" });
  });
});
