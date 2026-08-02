import { ref, type Ref } from "vue";
import { useEventListener, useTimeoutFn } from "@vueuse/core";
import { isFormControl } from "./focus";
import type BasePopover from "../components/ui/BasePopover.vue";

const HOVER_DELAY_MS = 220;
// If the pointer lands on a new row this soon after the last card closed, treat it as still
// "in" the tooltip session and skip the opening delay -- sweeping down a list of items should
// feel like one continuous hover, not a fresh 220ms wait per row.
const HOVER_RESUME_MS = 400;
const HOVER_CLOSE_GRACE_MS = 100;

export interface HoverPosition {
  slotId: string;
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
 */
export function useHoverCard(
  tooltip: Ref<InstanceType<typeof BasePopover> | null>,
  hasItem: (slotId: string) => boolean,
) {
  const hover = ref<HoverPosition | null>(null);
  /** Stashed arguments for the hover timer callback, since the timer delay varies. */
  const hoverArgs = ref<{ slotId: string; rect: DOMRect; x: number } | null>(
    null,
  );
  let lastHideAt = 0; // Date.now() of the last close, for the "resume" fast path
  let editing = false; // a real form control has focus: suppress the card so it cannot cover a dropdown

  const { start: startHoverTimer, stop: stopHoverTimer } = useTimeoutFn(() => {
    const args = hoverArgs.value;
    if (args) {
      tooltip.value?.place(args.rect, args.x);
      hover.value = { slotId: args.slotId };
    }
    hoverArgs.value = null;
  }, HOVER_DELAY_MS);

  // Immediate variant for the "resume" fast path — sweeping down a list should feel
  // like one continuous hover, not a fresh delay per row.
  const { start: startHoverTimerNow, stop: stopHoverTimerNow } = useTimeoutFn(
    () => {
      const args = hoverArgs.value;
      if (args) {
        tooltip.value?.place(args.rect, args.x);
        hover.value = { slotId: args.slotId };
      }
      hoverArgs.value = null;
    },
    0,
  );

  const { start: startLeaveTimer, stop: stopLeaveTimer } = useTimeoutFn(() => {
    close();
  }, HOVER_CLOSE_GRACE_MS);

  function onRowEnter(event: MouseEvent, slotId: string) {
    if (editing || !hasItem(slotId)) return;
    stopHoverTimer();
    stopHoverTimerNow();
    stopLeaveTimer();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const resuming = Date.now() - lastHideAt < HOVER_RESUME_MS;
    hoverArgs.value = { slotId, rect, x };
    if (resuming) startHoverTimerNow();
    else startHoverTimer();
  }

  function onRowLeave() {
    stopHoverTimer();
    stopHoverTimerNow();
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
   * `<body>`, so `.itemcard` is checked globally — no need for a `root` ref.
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

  useEventListener(window, "scroll", onScroll, true);

  return {
    hover,
    onRowEnter,
    onRowLeave,
    onCardEnter,
    onCardLeave,
    onFocusIn,
    onFocusOut,
  };
}
