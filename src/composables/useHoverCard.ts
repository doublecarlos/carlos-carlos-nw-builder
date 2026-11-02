import {
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";
import { useEventListener, useTimeoutFn } from "@vueuse/core";
import { isFormControl } from "./focus";
import { useEscapeToClose } from "./useEscapeToClose";
import type BasePopover from "../components/ui/BasePopover.vue";
import type { PopoverAlign } from "../components/ui/BasePopover.vue";

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

/** Two targets name the same row when every field matches. */
function sameTarget<T extends object>(a: T | null, b: T): boolean {
  if (!a) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key as keyof T] === b[key as keyof T]);
}

/**
 * One hover card for a whole scrolling list of rows: positions via a `BasePopover` (which
 * Teleports to body and handles viewport-edge flipping). `T` is what a row hands over to name
 * itself, and `hasItem` gates opening on it (an empty slot has nothing to show).
 *
 * A pinned card stays where it is until closed: hovering other rows, leaving the card,
 * scrolling and focus moves all leave it alone. `pin` freezes the card on screen, and
 * `togglePinned` opens one already pinned from a row's own button.
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
 *
 * While `disabled` holds no card opens: a touch screen fires `mouseenter` on every tap, and a
 * card dropping over the row just tapped would cover what the tap was for.
 *
 * The card opens beside the row, from the pointer. `anchor` and `align` place it against
 * another rectangle instead, for rows whose card should keep clear of their neighbours.
 */
export function useHoverCard<T extends object>(
  tooltip: Ref<InstanceType<typeof BasePopover> | null>,
  hasItem: (target: T) => boolean,
  options: {
    disabled?: MaybeRefOrGetter<boolean>;
    anchor?: (row: HTMLElement) => DOMRect;
    align?: PopoverAlign;
  } = {},
) {
  const hover = shallowRef<T | null>(null);
  const pinned = ref(false);
  /** The row waiting to open, kept for the hover timers and, while suppressed, for the pointer
   *  move that lifts suppression. Its rect is read at open time because the row may still be
   *  scrolling when the pointer enters it. */
  let pending: {
    target: T;
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

  function placeBeside(
    row: HTMLElement,
    x?: number,
    align: PopoverAlign | undefined = options.align,
  ) {
    if (options.anchor)
      tooltip.value?.place(options.anchor(row), undefined, align);
    else tooltip.value?.place(row.getBoundingClientRect(), x, align);
  }

  function openPending() {
    if (pending) {
      placeBeside(pending.row, pending.x);
      hover.value = pending.target;
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

  function onRowEnter(event: MouseEvent, target: T) {
    if (
      toValue(options.disabled) ||
      pinned.value ||
      editing ||
      !hasItem(target)
    )
      return;
    stopHoverTimer();
    stopHoverTimerNow();
    stopLeaveTimer();
    pending = {
      target,
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
    if (pinned.value) return;
    // Grace period, not an instant close: the card sits outside the row's own bounds, so
    // reaching it always crosses this "gap" first. Without the grace period the card would
    // vanish the instant the pointer leaves the row, before it ever reaches the card.
    stopLeaveTimer();
    startLeaveTimer();
  }

  /** Entering the card itself cancels any pending close from leaving the row, and any row
   *  crossed on the way there, which would otherwise swap the card out from under the pointer. */
  function onCardEnter() {
    stopLeaveTimer();
    stopHoverTimer();
    stopHoverTimerNow();
    pending = null;
  }

  function onCardLeave() {
    if (!pinned.value) close();
  }

  function close() {
    stopLeaveTimer();
    if (hover.value) {
      lastHideAt = Date.now();
      tooltip.value?.close();
    }
    hover.value = null;
    pinned.value = false;
  }

  /** Freezes the card on screen as it is. */
  function pin() {
    if (!hover.value) return;
    stopLeaveTimer();
    pinned.value = true;
  }

  /** Opens `target`'s card pinned, beside `anchor`, or closes it when it is the one pinned.
   *  `align` overrides the hover card's own, for a button placed apart from where the pointer
   *  usually enters its row. */
  function togglePinned(target: T, anchor: HTMLElement, align?: PopoverAlign) {
    if (pinned.value && sameTarget(hover.value, target)) {
      close();
      return;
    }
    if (!hasItem(target)) return;
    stopHoverTimer();
    stopHoverTimerNow();
    stopLeaveTimer();
    pending = null;
    placeBeside(anchor, undefined, align ?? options.align);
    hover.value = target;
    pinned.value = true;
  }

  /** Closes on any scroll outside the card itself. The card is teleported, so it is found
   *  through the popover rather than as an ancestor of anything here. */
  function onScroll(event: Event) {
    if (tooltip.value?.el?.contains(event.target as Node)) return;
    stopHoverTimer();
    stopHoverTimerNow();
    if (hover.value && !pinned.value) close();
  }

  function onFocusIn(event: FocusEvent) {
    editing = isFormControl(event.target as Element | null);
    stopHoverTimer();
    stopHoverTimerNow();
    if (!pinned.value) close();
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
    pinned,
    pin,
    togglePinned,
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
