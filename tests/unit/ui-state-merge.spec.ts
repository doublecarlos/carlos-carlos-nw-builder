// `UiState` has two independent owners -- BuildEditor writes `expanded`, stores/rails.ts writes
// `collapsed` and `railWidths` -- and each knows only its own fields. Before the merge,
// whichever saved last erased the other's preference, which is the kind of bug that only shows
// up as "my sections keep reopening" a session later.
import { describe, expect, it, beforeEach } from "vitest";
import { installWindowShim } from "./stores/window-shim";
import * as storage from "../../src/storage/storage";

beforeEach(() => {
  installWindowShim();
});

describe("saveUiState", () => {
  it("round-trips a single field", () => {
    storage.saveUiState({ expanded: { gear: true } });

    expect(storage.loadUiState().expanded).toEqual({ gear: true });
  });

  it("keeps the other owner's field when only one writes", () => {
    storage.saveUiState({ expanded: { gear: true, boons: false } });
    storage.saveUiState({ collapsed: { nav: true } });

    const stored = storage.loadUiState();
    expect(stored.expanded).toEqual({ gear: true, boons: false });
    expect(stored.collapsed).toEqual({ nav: true });
  });

  it("replaces the field being written rather than merging into it", () => {
    // Within one owner's field a write is authoritative: BuildEditor sends the whole map, so a
    // section it dropped must not linger.
    storage.saveUiState({ expanded: { gear: true, boons: true } });
    storage.saveUiState({ expanded: { gear: false } });

    expect(storage.loadUiState().expanded).toEqual({ gear: false });
  });

  it("round-trips rail widths as numbers", () => {
    storage.saveUiState({ railWidths: { nav: 312 } });

    expect(storage.loadUiState().railWidths).toEqual({ nav: 312 });
  });

  it("drops a rail width that is not a number", () => {
    window.localStorage.setItem(
      "nw:ui",
      JSON.stringify({ railWidths: { nav: "wide" } }),
    );

    expect(storage.loadUiState().railWidths).toEqual({});
  });

  it("ignores non-boolean values, both fields alike", () => {
    window.localStorage.setItem(
      "nw:ui",
      JSON.stringify({ expanded: { gear: "yes" }, collapsed: { nav: 1 } }),
    );

    const stored = storage.loadUiState();
    expect(stored.expanded).toEqual({});
    expect(stored.collapsed).toEqual({});
  });
});
