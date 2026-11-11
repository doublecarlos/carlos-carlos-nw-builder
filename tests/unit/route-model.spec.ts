// The route model's round trip and its policy: which param changes are a Back step of their own
// and which can unmount a form.
import { describe, expect, it } from "vitest";
import {
  changedKeys,
  guarded,
  mergeRoute,
  parseQuery,
  patchTo,
  pushes,
  serializeQuery,
} from "../../src/lib/route-model";

describe("parseQuery and serializeQuery", () => {
  it("round-trips a route, dropping unknown and empty params", () => {
    const route = parseQuery("?layer=l1&item=a&utm=x&q=");
    expect(route).toEqual({ layer: "l1", item: "a" });
    expect(parseQuery(serializeQuery(route))).toEqual(route);
  });

  it("writes params in one order whatever order they came in", () => {
    // Two routes for the same place share one URL, so comparing queries compares places.
    expect(serializeQuery(parseQuery("item=a&layer=l1"))).toBe(
      serializeQuery(parseQuery("layer=l1&item=a")),
    );
  });
});

describe("mergeRoute", () => {
  it("drops keys a patch clears and keeps the rest", () => {
    expect(
      mergeRoute({ layer: "l1", item: "a" }, { item: null, bonus: "b" }),
    ).toEqual({ layer: "l1", bonus: "b" });
  });

  it("patchTo turns any route into its target", () => {
    const target = { build: "b1" };
    expect(mergeRoute({ layer: "l1", item: "a" }, patchTo(target))).toEqual(
      target,
    );
  });
});

describe("policy", () => {
  const change = (from: string, to: string) =>
    changedKeys(parseQuery(from), parseQuery(to));

  it("pushes a selection, an entry, a pane, a details tab and a stable tab", () => {
    expect(pushes(change("build=b1", "build=b2"))).toBe(true);
    expect(pushes(change("layer=l1", "layer=l1&item=a"))).toBe(true);
    expect(pushes(change("build=b1", "build=b1&pane=stats"))).toBe(true);
    expect(pushes(change("build=b1", "build=b1&stable=mount"))).toBe(true);
    expect(pushes(change("build=b1", "build=b1&tab=bonuses"))).toBe(true);
  });

  it("replaces for list filters and the maintainer flag", () => {
    expect(pushes(change("layer=l1", "layer=l1&q=ring&status=added"))).toBe(
      false,
    );
    expect(pushes(change("maintainer=1", ""))).toBe(false);
  });

  it("guards changes that can unmount a form, not panes or filters", () => {
    expect(guarded(change("layer=l1&item=a", "layer=l1&item=b"))).toBe(true);
    expect(guarded(change("layer=l1", "layer=l1&new=items"))).toBe(true);
    expect(guarded(change("layer=l1", "build=b1"))).toBe(true);
    expect(
      guarded(change("layer=l1", "layer=l1&pane=stats&tab=bonuses&q=x")),
    ).toBe(false);
  });
});
