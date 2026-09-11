import { onScopeDispose, ref, type Ref } from "vue";
import { useEventListener, useTimeoutFn } from "@vueuse/core";
import { isFormControl } from "./focus";
import { useEscapeToClose } from "./useEscapeToClose";
import type BasePopover from "../components/ui/BasePopover.vue";

const HOVER_DELAY_MS = 220;
// If the pointer lands on a new row this soon after the last card closed, treat it as still
// "in" the tooltip session and skip the opening delay -- sweeping down a list of items should
// feel like one continuous hover, not a fresh 220ms wait per row.
const HOVER_RESUME_MS = 400;
const HOVER_CLOSE_GRACE_MS = 100;

export interface HoverPosition {
  slotId: string;
  /** Set only for a point_assignment row's per-item hover target (PointAssignmentInput.vue) --
   *  a row with no single item to default to, unlike item_picker's whole-row hover. */
  itemId?: string;
}

/**
 * One hover card for a whole scrolling list of rows: positions via a `BasePopover` (which
 * Teleports to body and handles viewport-edge flipping). `hasItem` gates opening (an empty
 * slot has nothing to show).
 *
 * The caller must wire `onFocusIn`/`onFocusOut` to the container's own `focusin`/`focusout` --
 * they can't be registered here via `addEventListener`, because `editing` has to turn on only
 * for a *real* form control (see `isFormControl`), and a plain `tabindex="-1"` row div
 * receiving programmatic focus (arrow-key nav, or a click that lands on non-focusable content
 * like a stat summary) must not count. Getting this distinction wrong is exactly what made the
 * card stop appearing until an unrelated gear change: `editing` used to latch true on *any*
 * focusin and nothing ever set it back, since only a picker's blur-to-`<body>` (a focusout with
 * no matching focusin) reset it.
 *
 * `suppressUntilPointerMoves` is for programmatic scrolls (keyboard cursor, jumps): the row
 * left under a still pointer gets no card until the pointer moves.
 */
export function useHoverCard(
  tooltip: Ref<InstanceType<typeof BasePopover> | null>,
  hasItem: (slotId: string, itemId?: string) => boolean,
) {
  const hover = ref<HoverPosition | null>(null);
  /** The row waiting to open, kept for the hover timers and, while suppressed, for the pointer
   *  move that lifts suppression. Its rect is read at open time because the row may still be
   *  scrolling when the pointer enters it. */
  let pending: {
    slotId: string;
    itemId?: string;
    row: HTMLElement;
    x: number;
  } | null = null;
  let lastHideAt = 0; // Date.now() of the last close, for the "resume" fast path
  let editing = false; // a real form control has focus: suppress the card so it cannot cover a dropdown
  /** No card until the pointer moves, after a programmatic scroll. */
  let suppressed = false;
  /** First pointer position seen after arming; only a move away from it lifts suppression. */
  let baseline: { x: number; y: number } | null = null;
  /** Stops the window `mousemove` listener, which exists only while suppressed. */
  let stopPointerWatch: (() => void) | null = null;

  function openPending() {
    if (pending) {
      tooltip.value?.place(pending.row.getBoundingClientRect(), pending.x);
      hover.value = { slotId: pending.slotId, itemId: pending.itemId };
    }
    pending = null;
  }

  const { start: startHoverTimer, stop: stopHoverTimer } = useTimeoutFn(
    openPending,
    HOVER_DELAY_MS,
  );

  // Immediate variant for the "resume" fast path - sweeping down a list should feel
  // like one continuous hover, not a fresh delay per row.
  const { start: startHoverTimerNow, stop: stopHoverTimerNow } = useTimeoutFn(
    openPending,
    0,
  );

  const { start: startLeaveTimer, stop: stopLeaveTimer } = useTimeoutFn(() => {
    close();
  }, HOVER_CLOSE_GRACE_MS);

  function onRowEnter(event: MouseEvent, slotId: string, itemId?: string) {
    if (editing || !hasItem(slotId, itemId)) return;
    stopHoverTimer();
    stopHoverTimerNow();
    stopLeaveTimer();
    pending = {
      slotId,
      itemId,
      row: event.currentTarget as HTMLElement,
      x: event.clientX,
    };
    if (suppressed) {
      notePointer(event.clientX, event.clientY);
      return;
    }
    const resuming = Date.now() - lastHideAt < HOVER_RESUME_MS;
    if (resuming) startHoverTimerNow();
    else startHoverTimer();
  }

  function onRowLeave() {
    stopHoverTimer();
    stopHoverTimerNow();
    pending = null;
    // Grace period, not an instant close: the card sits outside the row's own bounds, so
    // reaching it always crosses this "gap" first. Without the grace period the card would
    // vanish the instant the pointer leaves the row, before it ever reaches the card.
    stopLeaveTimer();
    startLeaveTimer();
  }

  /** Entering the card itself cancels any pending close from leaving the row. */
  function onCardEnter() {
    stopLeaveTimer();
  }

  function onCardLeave() {
    close();
  }

  function close() {
    stopLeaveTimer();
    if (hover.value) {
      lastHideAt = Date.now();
      tooltip.value?.close();
    }
    hover.value = null;
  }

  /**
   * Close on any scroll outside the card itself. With Teleport the card lives under
   * `<body>`, so `.itemcard` is checked globally - no need for a `root` ref.
   */
  function onScroll(event: Event) {
    if ((event.target as HTMLElement)?.closest?.(".itemcard")) return;
    stopHoverTimer();
    stopHoverTimerNow();
    if (hover.value) close();
  }

  function onFocusIn(event: FocusEvent) {
    editing = isFormControl(event.target as Element | null);
    stopHoverTimer();
    stopHoverTimerNow();
    close();
  }

  function onFocusOut() {
    editing = false;
  }

  /** Holds the card until the pointer moves, so a row scrolled under a still pointer gets no
   *  card. Also ends the "resume" session: the next card waits the full delay. */
  function suppressUntilPointerMoves() {
    suppressed = true;
    baseline = null;
    lastHideAt = 0;
    stopHoverTimer();
    stopHoverTimerNow();
    pending = null;
    stopPointerWatch ??= useEventListener(window, "mousemove", (event) =>
      notePointer(event.clientX, event.clientY),
    );
  }

  /** The first event after arming sets the baseline instead of counting as a move: a browser
   *  may replay a `mousemove` at the pointer's unchanged spot once a scroll settles. A move away
   *  from the baseline lifts suppression and opens the row under the pointer, whose `mouseenter`
   *  already fired. */
  function notePointer(x: number, y: number) {
    if (!baseline) {
      baseline = { x, y };
      return;
    }
    if (baseline.x === x && baseline.y === y) return;
    suppressed = false;
    stopPointerWatch?.();
    stopPointerWatch = null;
    if (pending) {
      pending.x = x;
      startHoverTimer();
    }
  }

  onScopeDispose(() => stopPointerWatch?.());

  useEventListener(window, "scroll", onScroll, true);

  useEscapeToClose(() => close());

  return {
    hover,
    onRowEnter,
    onRowLeave,
    onCardEnter,
    onCardLeave,
    onFocusIn,
    onFocusOut,
    closeCard: close,
    suppressUntilPointerMoves,
  };
}
