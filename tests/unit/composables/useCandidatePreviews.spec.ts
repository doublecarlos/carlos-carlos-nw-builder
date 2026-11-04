// A picker resolves a candidate only when something reads it, once per set of inputs, so
// opening or typing in a long list stays cheap.
import { afterEach, describe, it, expect, vi } from "vitest";
import { reactive, ref } from "vue";
import * as engine from "../../../src/engine/engine";
import {
  previewCache,
  useCandidatePreviews,
} from "../../../src/composables/useCandidatePreviews";
import type { PreviewInputs } from "../../../src/lib/candidate-preview";
import type { Item } from "../../../src/types";
import { picker, testBuild, testDb, testSchema } from "../engine-fixtures";

const items: Item[] = ["a", "b", "marker"].map((id) => ({
  id,
  name: id,
  filter: "ring",
  bonuses: id === "a" ? ["b-clash"] : [],
}));
const [a, b] = items;

const db = testDb(
  testSchema(["power"]),
  items,
  [
    {
      id: "b-clash",
      grants: [
        {
          when: { equipped: { item: "marker", atLeast: 1 } },
          problem: { severity: "error", message: "x", hideFromPicker: true },
        },
      ],
    },
  ],
  [picker("ring.r1", "ring"), picker("ring.r2", "ring")],
);

const inputsFor = (build = testBuild()): PreviewInputs => ({
  db,
  build,
  slotId: "ring.r2",
});

afterEach(() => vi.restoreAllMocks());

describe("previewCache", () => {
  it("resolves a candidate on first read only", () => {
    const spy = vi.spyOn(engine, "resolveBonuses");
    const cache = previewCache(inputsFor());
    expect(spy).not.toHaveBeenCalled();
    const first = cache.get(a);
    expect(cache.get(a)).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
    cache.get(b);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resolves again after an in-place edit of the build", () => {
    const build = reactive(testBuild());
    const cache = previewCache(inputsFor(build));
    expect(cache.get(a)?.conflict).toBeNull();
    build.choices["ring.r1"] = "marker";
    expect(cache.get(a)?.conflict).not.toBeNull();
  });

  it("maps a candidate whose resolve throws to null", () => {
    vi.spyOn(engine, "resolveBonuses").mockImplementationOnce(() => {
      throw new Error("bad");
    });
    const cache = previewCache(inputsFor());
    expect(cache.get(a)).toBeNull();
    expect(cache.get(b)).not.toBeNull();
  });
});

describe("useCandidatePreviews", () => {
  it("keeps its cache while the inputs stay and starts over when they change", () => {
    const inputs = ref<PreviewInputs | undefined>(inputsFor());
    const previews = useCandidatePreviews(() => inputs.value);
    const spy = vi.spyOn(engine, "resolveBonuses");

    previews.value!.get(a);
    previews.value!.get(a);
    expect(spy).toHaveBeenCalledTimes(1);

    inputs.value = inputsFor();
    previews.value!.get(a);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("is null without inputs", () => {
    const previews = useCandidatePreviews(() => undefined);
    expect(previews.value).toBeNull();
  });
});
