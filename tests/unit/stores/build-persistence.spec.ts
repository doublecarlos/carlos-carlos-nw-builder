// The active build is deep-watched, so any in-place change to it is saved without the writer
// queuing anything. These pin that every kind of write reaches the backend after the save debounce.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Build } from "../../../src/types";

async function freshStores() {
  vi.resetModules();
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  const idb = installIdbShim();
  const builds = await import("../../../src/stores/builds");
  const history = await import("../../../src/stores/history");
  const layers = await import("../../../src/stores/layers");
  const buildEditor = await import("../../../src/stores/buildEditor");
  const compare = await import("../../../src/stores/compare");
  builds._setLoading(false);
  history._setLoading(false);
  layers._setLoading(false);
  const storage = await import("../../../src/storage/storage");
  builds.replaceActive(storage.defaultBuild("Build 1"));
  await vi.advanceTimersByTimeAsync(300);
  idb.clear();
  return { builds, buildEditor, compare, idb };
}

/** The build record the backend holds for `id`, after the save debounce has run. */
async function stored(
  idb: { stores: Map<string, Map<string, unknown>> },
  id: string,
): Promise<Build | undefined> {
  await vi.advanceTimersByTimeAsync(300);
  const record = idb.stores.get("builds")?.get(id) as
    { data: Build } | undefined;
  return record?.data;
}

describe("build persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a content edit", async () => {
    vi.useFakeTimers();
    const { builds, buildEditor, idb } = await freshStores();
    const id = builds.build.value!.id;

    buildEditor.setChoice("ring1", "ItemA");

    expect((await stored(idb, id))?.choices.ring1).toBe("ItemA");
  });

  it("saves the state an undo restores", async () => {
    vi.useFakeTimers();
    const { builds, buildEditor, idb } = await freshStores();
    const id = builds.build.value!.id;
    buildEditor.setChoice("ring1", "ItemA");
    await stored(idb, id);

    buildEditor.undo();

    expect((await stored(idb, id))?.choices.ring1).toBeUndefined();
  });

  it("saves the compare picker and its toggles", async () => {
    vi.useFakeTimers();
    const { builds, compare, idb } = await freshStores();
    const id = builds.build.value!.id;

    compare.setCompareBuild("other");
    compare.setCompareFlag("highlight", true);

    expect((await stored(idb, id))?.compare).toMatchObject({
      id: "other",
      highlight: true,
    });
  });

  it("saves an in-place write to the active build that queues nothing itself", async () => {
    vi.useFakeTimers();
    const { builds, idb } = await freshStores();
    const b = builds.build.value!;

    b.choices.ring1 = "ItemB";

    expect((await stored(idb, b.id))?.choices.ring1).toBe("ItemB");
  });

  it("writes nothing for a build left untouched", async () => {
    vi.useFakeTimers();
    const { builds, idb } = await freshStores();

    expect(await stored(idb, builds.build.value!.id)).toBeUndefined();
  });
});
