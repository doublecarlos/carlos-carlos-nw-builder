// The hover card opens on row enter after a delay, resumes instantly when sweeping between
// rows, and stays shut after a programmatic scroll until the pointer moves.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useHoverCard } from "../../src/composables/useHoverCard";
import type BasePopover from "../../src/components/ui/BasePopover.vue";

const HOVER_DELAY_MS = 220;

/** The composable listens on `window`; a bare EventTarget covers that in Node. The mousemove
 *  listener count shows whether the suppression watch is on. */
let fakeWindow: EventTarget;
let mousemoveListeners: number;

function installFakeWindow() {
  fakeWindow = new EventTarget();
  mousemoveListeners = 0;
  const add = fakeWindow.addEventListener.bind(fakeWindow);
  const remove = fakeWindow.removeEventListener.bind(fakeWindow);
  fakeWindow.addEventListener = (type, ...rest) => {
    if (type === "mousemove") mousemoveListeners += 1;
    add(type, ...rest);
  };
  fakeWindow.removeEventListener = (type, ...rest) => {
    if (type === "mousemove") mousemoveListeners -= 1;
    remove(type, ...rest);
  };
  vi.stubGlobal("window", fakeWindow);
}

function mouseMove(x: number, y: number) {
  fakeWindow.dispatchEvent(
    Object.assign(new Event("mousemove"), { clientX: x, clientY: y }),
  );
}

/** Enough of a row `mouseenter` for `onRowEnter`: a target with a rect and pointer coordinates. */
function rowEnterEvent(x = 10, y = 10): MouseEvent {
  return {
    currentTarget: { getBoundingClientRect: () => ({}) as DOMRect },
    clientX: x,
    clientY: y,
  } as unknown as MouseEvent;
}

function setup() {
  const tooltip = ref({
    place: vi.fn(),
    close: vi.fn(),
  } as unknown as InstanceType<typeof BasePopover>);
  const scope = effectScope();
  const card = scope.run(() => useHoverCard(tooltip, () => true))!;
  return { card, tooltip, dispose: () => scope.stop() };
}

beforeEach(() => {
  vi.useFakeTimers();
  installFakeWindow();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useHoverCard", () => {
  it("opens after the hover delay", () => {
    const { card, dispose } = setup();
    card.onRowEnter(rowEnterEvent(), "head");
    expect(card.hover.value).toBeNull();
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    expect(card.hover.value).toEqual({ slotId: "head", itemId: undefined });
    dispose();
  });

  it("resumes instantly when re-entering a row soon after a close", () => {
    const { card, dispose } = setup();
    card.onRowEnter(rowEnterEvent(), "head");
    vi.advanceTimersByTime(HOVER_DELAY_MS);
    card.closeCard();
    expect(card.hover.value).toBeNull();

    vi.advanceTimersByTime(100);
    card.onRowEnter(rowEnterEvent(), "neck");
    vi.advanceTimersByTime(0);
    expect(card.hover.value).toEqual({ slotId: "neck", itemId: undefined });
    dispose();
  });

  describe("suppressUntilPointerMoves", () => {
    it("watches the window only while armed", () => {
      const { card, dispose } = setup();
      expect(mousemoveListeners).toBe(0);

      card.suppressUntilPointerMoves();
      expect(mousemoveListeners).toBe(1);
      // Re-arming before the pointer moved keeps the one watch.
      card.suppressUntilPointerMoves();
      expect(mousemoveListeners).toBe(1);

      mouseMove(50, 50);
      mouseMove(53, 50);
      expect(mousemoveListeners).toBe(0);
      dispose();
    });

    it("drops an armed watch when the scope is disposed", () => {
      const { card, dispose } = setup();
      card.suppressUntilPointerMoves();
      expect(mousemoveListeners).toBe(1);

      dispose();
      expect(mousemoveListeners).toBe(0);
    });

    it("keeps the card shut on row enter, even once the delay elapses", () => {
      const { card, dispose } = setup();
      card.suppressUntilPointerMoves();

      card.onRowEnter(rowEnterEvent(), "head");
      vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
      expect(card.hover.value).toBeNull();
      dispose();
    });

    it("cancels a hover already pending when armed", () => {
      const { card, dispose } = setup();
      card.onRowEnter(rowEnterEvent(), "head");
      card.suppressUntilPointerMoves();
      vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
      expect(card.hover.value).toBeNull();
      dispose();
    });

    it("takes the first event after arming as the baseline, not as a move", () => {
      const { card, dispose } = setup();
      card.suppressUntilPointerMoves();
      mouseMove(50, 50);

      card.onRowEnter(rowEnterEvent(50, 50), "head");
      vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
      expect(card.hover.value).toBeNull();
      dispose();
    });

    it("ignores further events at the baseline coordinates", () => {
      const { card, dispose } = setup();
      card.suppressUntilPointerMoves();
      mouseMove(50, 50);
      mouseMove(50, 50);

      card.onRowEnter(rowEnterEvent(50, 50), "head");
      mouseMove(50, 50);
      vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
      expect(card.hover.value).toBeNull();
      dispose();
    });

    it("lifts on a move away from the baseline, opening the pending row after the full delay", () => {
      const { card, dispose } = setup();
      // A card closes right before the jump, which would normally put the next row on the
      // "resume" fast path.
      card.onRowEnter(rowEnterEvent(), "head");
      vi.advanceTimersByTime(HOVER_DELAY_MS);
      card.closeCard();
      card.suppressUntilPointerMoves();

      // The browser's replay for the row now under the still pointer, then a real move.
      card.onRowEnter(rowEnterEvent(50, 50), "neck");
      mouseMove(50, 50);
      mouseMove(53, 52);
      vi.advanceTimersByTime(HOVER_DELAY_MS - 1);
      expect(card.hover.value).toBeNull();
      vi.advanceTimersByTime(1);
      expect(card.hover.value).toEqual({ slotId: "neck", itemId: undefined });
      dispose();
    });

    it("lets a suppressed mouseenter supply the baseline", () => {
      const { card, dispose } = setup();
      card.suppressUntilPointerMoves();
      card.onRowEnter(rowEnterEvent(50, 50), "head");

      mouseMove(50, 50);
      vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
      expect(card.hover.value).toBeNull();

      mouseMove(48, 50);
      vi.advanceTimersByTime(HOVER_DELAY_MS);
      expect(card.hover.value).toEqual({ slotId: "head", itemId: undefined });
      dispose();
    });

    it("forgets a latched row the pointer left before moving", () => {
      const { card, dispose } = setup();
      card.suppressUntilPointerMoves();
      card.onRowEnter(rowEnterEvent(50, 50), "head");
      card.onRowLeave();

      mouseMove(53, 52);
      vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
      expect(card.hover.value).toBeNull();
      dispose();
    });
  });
});
