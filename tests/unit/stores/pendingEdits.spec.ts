// The pending-edit registry, and the stores committing it on page hide ahead of their own saves.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@vueuse/core");
  vi.resetModules();
});

describe("pendingEdits", () => {
  it("flushAll runs every registered flush in registration order", async () => {
    const pendingEdits = await import("../../../src/stores/pendingEdits");
    const calls: string[] = [];
    const offA = pendingEdits.register(() => calls.push("a"));
    const offB = pendingEdits.register(() => calls.push("b"));

    pendingEdits.flushAll();
    expect(calls).toEqual(["a", "b"]);
    offA();
    offB();
  });

  it("an unregistered flush no longer runs", async () => {
    const pendingEdits = await import("../../../src/stores/pendingEdits");
    const calls: string[] = [];
    const offA = pendingEdits.register(() => calls.push("a"));
    const offB = pendingEdits.register(() => calls.push("b"));

    offA();
    pendingEdits.flushAll();
    expect(calls).toEqual(["b"]);
    offB();
  });

  it("a flush that unregisters itself mid-run does not skip the next one", async () => {
    const pendingEdits = await import("../../../src/stores/pendingEdits");
    const calls: string[] = [];
    const offA = pendingEdits.register(() => {
      calls.push("a");
      offA();
    });
    const offB = pendingEdits.register(() => calls.push("b"));

    pendingEdits.flushAll();
    expect(calls).toEqual(["a", "b"]);
    offB();
  });
});

describe("page hide", () => {
  /** Loads the stores against a fake page whose hide events the test dispatches. */
  async function withFakePage() {
    vi.resetModules();
    const doc = Object.assign(new EventTarget(), {
      visibilityState: "visible",
    });
    const win = new EventTarget();
    vi.doMock("@vueuse/core", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@vueuse/core")>()),
      defaultDocument: doc,
      defaultWindow: win,
      useEventListener: (
        target: Partial<EventTarget> | undefined,
        name: string,
        listener: (event: Event) => void,
      ) => target?.addEventListener?.(name, listener),
    }));
    const { installWindowShim, installIdbShim } = await import("./window-shim");
    installWindowShim();
    const idb = installIdbShim();
    const history = await import("../../../src/stores/history");
    const layers = await import("../../../src/stores/layers");
    const pendingEdits = await import("../../../src/stores/pendingEdits");
    history._setLoading(false);
    layers._setLoading(false);
    const hide = async () => {
      win.dispatchEvent(new Event("pagehide"));
      // Past the writes' first await, well short of the save debounce.
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { idb, history, layers, pendingEdits, hide };
  }

  it("saves a layer edit that a form commits on the way out", async () => {
    const { idb, layers, pendingEdits, hide } = await withFakePage();
    const layer = layers.createLayer("Before");
    await new Promise((resolve) => setTimeout(resolve, 300));
    idb.clear();
    pendingEdits.register(() => layers.renameLayer(layer.id, "After"));

    await hide();

    const record = idb.stores.get("layers")?.get(layer.id) as
      { data: { name: string } } | undefined;
    expect(record?.data.name).toBe("After");
  });

  it("saves the undo step that a form commits on the way out", async () => {
    const { idb, history, pendingEdits, hide } = await withFakePage();
    pendingEdits.register(() =>
      history.snapshot("layer", "L1", null, "edit", { a: 1 }),
    );

    await hide();

    expect(idb.stores.get("history")?.has("layer:L1")).toBe(true);
  });
});
