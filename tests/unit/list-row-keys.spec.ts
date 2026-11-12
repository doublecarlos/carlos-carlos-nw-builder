// Row identities for the editor's list row motion: they must follow a row's content.
import { describe, expect, it } from "vitest";
import { moveKey, removeKey, rowKeys } from "../../src/lib/list-row-keys";

describe("list row keys", () => {
  it("falls back to positions once the stored keys no longer match the count", () => {
    expect(rowKeys(["n1", "n2"], 2)).toEqual(["n1", "n2"]);
    expect(rowKeys(["n1", "n2"], 3)).toEqual(["1", "2", "3"]);
    expect(rowKeys(undefined, 2)).toEqual(["1", "2"]);
  });

  it("moves and removes a key by its 1-based row", () => {
    expect(moveKey(["a", "b", "c"], 1, 3)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b", "c"], 3, 1)).toEqual(["c", "a", "b"]);
    expect(removeKey(["a", "b", "c"], 2)).toEqual(["a", "c"]);
  });
});
