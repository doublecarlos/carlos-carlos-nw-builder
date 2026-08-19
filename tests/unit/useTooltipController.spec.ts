// The controller owns the one piece of tooltip state that is genuinely shared: which tooltip
// is showing. Its whole job is that only one ever is.
import { describe, it, expect, beforeEach } from "vitest";
import { effectScope } from "vue";
import {
  useTooltipController,
  _resetTooltips,
} from "../../src/composables/useTooltipController";

/** Each tooltip instance lives in its own component scope; `onScopeDispose` is what unmounting
 *  one is meant to trigger, so the tests need real scopes rather than bare calls. */
function inScope<T>(fn: () => T): { value: T; dispose: () => void } {
  const scope = effectScope();
  const value = scope.run(fn)!;
  return { value, dispose: () => scope.stop() };
}

beforeEach(() => _resetTooltips());

describe("useTooltipController", () => {
  it("starts closed", () => {
    const { value: tip } = inScope(() => useTooltipController());
    expect(tip.open.value).toBe(false);
  });

  it("opens and closes its own tooltip", () => {
    const { value: tip } = inScope(() => useTooltipController());

    tip.show();
    expect(tip.open.value).toBe(true);

    tip.hide();
    expect(tip.open.value).toBe(false);
  });

  it("closes the previous tooltip when another opens", () => {
    const { value: first } = inScope(() => useTooltipController());
    const { value: second } = inScope(() => useTooltipController());

    first.show();
    second.show();

    expect(first.open.value).toBe(false);
    expect(second.open.value).toBe(true);
  });

  it("ignores a late hide from a tooltip that already lost the slot", () => {
    const { value: first } = inScope(() => useTooltipController());
    const { value: second } = inScope(() => useTooltipController());

    first.show();
    second.show();
    // A `mouseleave` arriving after the pointer already moved on to the next trigger: it must
    // not close the tooltip that trigger just opened.
    first.hide();

    expect(second.open.value).toBe(true);
  });

  it("closes on unmount", () => {
    const { value: tip, dispose } = inScope(() => useTooltipController());

    tip.show();
    expect(tip.open.value).toBe(true);

    dispose();

    const { value: other } = inScope(() => useTooltipController());
    other.show();
    expect(other.open.value).toBe(true);
  });
});
