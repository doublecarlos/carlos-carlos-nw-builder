// A request that lands in one phone pane brings that pane up, whichever pane asked.
import { describe, expect, it, beforeEach } from "vitest";
import { installWindowShim } from "./window-shim";
import * as shell from "../../../src/stores/shell";
import * as goTo from "../../../src/stores/goTo";
import * as slotFilter from "../../../src/stores/slotFilter";

beforeEach(() => {
  installWindowShim();
});

describe("phone pane requests", () => {
  it("brings the editor up for a jump to a row", () => {
    shell.showPane("stats");
    goTo.requestJump({ slotId: "gear.head" });
    expect(shell.phonePane.value).toBe("editor");
    goTo.consumeJump();
  });

  it("brings the editor up for a supplier filter", () => {
    shell.showPane("stats");
    slotFilter.showSuppliersOf({ kind: "item", itemId: "ring" }, "Ring");
    expect(shell.phonePane.value).toBe("editor");
    slotFilter.clear();
  });

  it("brings the stats pane up to inspect a bonus", async () => {
    const details = await import("../../../src/stores/details");
    shell.showPane("editor");
    details.inspectBonus("some-bonus");
    expect(shell.phonePane.value).toBe("stats");
    expect(details.tab.value).toBe("bonuses");
    details.consumeInspect();
  });
});
