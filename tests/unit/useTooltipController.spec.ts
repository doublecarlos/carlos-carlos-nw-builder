// The controller owns the one piece of tooltip state that is genuinely shared: which tooltip
// is showing. Its whole job is that only one ever is.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectScope } from "vue";
import {
  useTooltipController,
  _resetTooltips,
  revealsOnFocus,
  pointerEntered,
  triggerFocused,
  triggerLeft,
  triggerClicked,
  pressedOutside,
  scrolled,
  enabledTrigger,
} from "../../src/composables/useTooltipController";

/** Each tooltip instance lives in its own component scope; `onScopeDispose` is what unmounting
 *  one is meant to trigger, so the tests need real scopes rather than bare calls. */
function inScope<T>(fn: () => T): { value: T; dispose: () => void } {
  const scope = effectScope();
  const value = scope.run(fn)!;
  return { value, dispose: () => scope.stop() };
}

beforeEach(() => _resetTooltips());

type FakeTrigger = Element & { attrs: Set<string> };

/** Stands in for a trigger element: the controller only marks it, asks what it contains and
 *  walks up to marked ancestors, so the rules run without a DOM. */
function fakeTrigger(parent: FakeTrigger | null = null): FakeTrigger {
  const attrs = new Set<string>();
  const el = {
    attrs,
    parentElement: parent,
    setAttribute: (name: string) => attrs.add(name),
    removeAttribute: (name: string) => attrs.delete(name),
    contains: (other: unknown) => other === el,
    closest: (): FakeTrigger | null =>
      attrs.size
        ? (el as unknown as FakeTrigger)
        : (parent?.closest("") ?? null),
  };
  return el as unknown as FakeTrigger;
}

/** A tooltip instance registered on its own fake trigger, revealing the way BaseTooltip
 *  does: straight into `show`. */
function attached(
  options: {
    delayMs?: number;
    tappable?: boolean;
    enabled?: boolean;
    parent?: FakeTrigger;
  } = {},
) {
  const trigger = fakeTrigger(options.parent);
  const { value: tip, dispose } = inScope(() => {
    const controller = useTooltipController();
    controller.attach(trigger, {
      enabled: () => options.enabled ?? true,
      delayMs: () => options.delayMs ?? 300,
      tappable: () => options.tappable ?? false,
      reveal: () => controller.show(),
    });
    return controller;
  });
  return { trigger, tip, dispose };
}

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

describe("revealsOnFocus", () => {
  it("opens for keyboard focus, before any press or after a key", () => {
    expect(revealsOnFocus(true, null)).toBe(true);
  });

  it("opens for a visible focus that follows a mouse press, as on a text field", () => {
    expect(revealsOnFocus(true, "mouse")).toBe(true);
  });

  it("stays shut for a focus that follows a tap, even a visible one", () => {
    expect(revealsOnFocus(true, "touch")).toBe(false);
    expect(revealsOnFocus(true, "pen")).toBe(false);
  });

  it("stays shut for a click's focus or a script's focus after one", () => {
    expect(revealsOnFocus(false, null)).toBe(false);
    expect(revealsOnFocus(false, "mouse")).toBe(false);
  });
});

// The delegated listeners resolve an event to its trigger and hand it to these rules; the
// rules are what decide when a bubble opens and closes.
describe("tooltip trigger rules", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("marks a registered trigger and unmarks it on unmount", () => {
    const { trigger, dispose } = attached();
    // The delegated listeners find triggers by this attribute.
    expect(trigger.attrs.has("data-tooltip")).toBe(true);

    dispose();

    expect(trigger.attrs.has("data-tooltip")).toBe(false);
  });

  it("passes over a trigger with no text to the tooltip around it", () => {
    // A BaseButton wraps itself in a tooltip for its `title`, so a caller's tooltip around
    // a button without one must still answer for it.
    const outer = attached();
    const inner = attached({ enabled: false, parent: outer.trigger });

    expect(enabledTrigger(inner.trigger)).toBe(outer.trigger);
  });

  it("lets the innermost trigger with text answer", () => {
    const outer = attached();
    const inner = attached({ parent: outer.trigger });

    expect(enabledTrigger(inner.trigger)).toBe(inner.trigger);
  });

  it("opens on hover only after the delay", () => {
    const { trigger, tip } = attached({ delayMs: 300 });

    pointerEntered(trigger);
    vi.advanceTimersByTime(299);
    expect(tip.open.value).toBe(false);

    vi.advanceTimersByTime(1);
    expect(tip.open.value).toBe(true);
  });

  it("drops a pending open when the pointer leaves first", () => {
    const { trigger, tip } = attached();

    pointerEntered(trigger);
    triggerLeft(trigger);
    vi.runAllTimers();

    expect(tip.open.value).toBe(false);
  });

  it("runs one hover delay at a time, for the trigger entered last", () => {
    const first = attached();
    const second = attached();

    pointerEntered(first.trigger);
    pointerEntered(second.trigger);
    vi.runAllTimers();

    expect(first.tip.open.value).toBe(false);
    expect(second.tip.open.value).toBe(true);
  });

  it("keeps a pending open when a different trigger is left", () => {
    // Over and out arrive in either order when the pointer crosses between two triggers.
    const first = attached();
    const second = attached();

    pointerEntered(second.trigger);
    triggerLeft(first.trigger);
    vi.runAllTimers();

    expect(second.tip.open.value).toBe(true);
  });

  it("opens on keyboard focus at once and cancels a pending hover", () => {
    const hovered = attached();
    const focused = attached();

    pointerEntered(hovered.trigger);
    triggerFocused(focused.trigger);
    expect(focused.tip.open.value).toBe(true);

    vi.runAllTimers();
    expect(hovered.tip.open.value).toBe(false);
    expect(focused.tip.open.value).toBe(true);
  });

  it("closes on a click, so it can't cover what the click opened", () => {
    const { trigger, tip } = attached();
    triggerFocused(trigger);

    triggerClicked(trigger, false);

    expect(tip.open.value).toBe(false);
  });

  it("toggles a tappable tooltip on tap, but not on a mouse click", () => {
    const { trigger, tip } = attached({ tappable: true });

    triggerClicked(trigger, false);
    expect(tip.open.value).toBe(false);

    triggerClicked(trigger, true);
    expect(tip.open.value).toBe(true);

    triggerClicked(trigger, true);
    expect(tip.open.value).toBe(false);
  });

  it("does not open a plain tooltip on tap", () => {
    const { trigger, tip } = attached();

    triggerClicked(trigger, true);

    expect(tip.open.value).toBe(false);
  });

  it("closes a tapped-open tooltip on a press outside its trigger only", () => {
    const { trigger, tip } = attached({ tappable: true });
    triggerClicked(trigger, true);

    pressedOutside(trigger as unknown as Node);
    expect(tip.open.value).toBe(true);

    pressedOutside(null);
    expect(tip.open.value).toBe(false);
  });

  it("leaves a plain tooltip open on a press elsewhere", () => {
    // A hovered bubble closes when the pointer leaves, not on a press.
    const { trigger, tip } = attached();
    triggerFocused(trigger);

    pressedOutside(null);

    expect(tip.open.value).toBe(true);
  });

  it("closes on scroll but keeps a pending hover open", () => {
    const open = attached();
    const pending = attached();
    triggerFocused(open.trigger);
    pointerEntered(pending.trigger);

    scrolled();
    expect(open.tip.open.value).toBe(false);

    // The scroll may be what brought the trigger under the pointer.
    vi.runAllTimers();
    expect(pending.tip.open.value).toBe(true);
  });

  it("drops an unmounted trigger's pending open", () => {
    const { trigger, tip, dispose } = attached();
    const reveal = vi.spyOn(tip, "show");

    pointerEntered(trigger);
    dispose();
    vi.runAllTimers();

    expect(reveal).not.toHaveBeenCalled();
  });
});
