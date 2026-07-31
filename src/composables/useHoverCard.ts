import { nextTick, onMounted, onUnmounted, ref, type Ref } from "vue";
import { isFormControl } from "./focus";

const HOVER_DELAY_MS = 220;
// If the pointer lands on a new row this soon after the last card closed, treat it as still
// "in" the tooltip session and skip the opening delay -- sweeping down a list of items should
// feel like one continuous hover, not a fresh 220ms wait per row.
const HOVER_RESUME_MS = 400;
const HOVER_CLOSE_GRACE_MS = 100;
const CARD_W = 320; // must match ItemCard.vue's root `w-80` (320px) utility

export interface HoverPosition {
  slotId: string;
  left: number;
  top: number;
}

/**
 * One hover card for a whole scrolling list of rows: `hover` holds at most one entry, moved
 * and refilled by the caller (which resolves the item/bonuses for `hover.value.slotId`) rather
 * than each row owning its own card. `root` is where `place()` looks for the rendered
 * `.itemcard` to measure its real height for the vertical flip; `hasItem` gates opening (an
 * empty slot has nothing to show).
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
  root: Ref<HTMLElement | null>,
  hasItem: (slotId: string) => boolean,
) {
  const hover = ref<HoverPosition | null>(null);
  let hoverTimer: number | undefined;
  let leaveTimer: number | undefined; // grace period before a leave actually closes the card
  let lastHideAt = 0; // Date.now() of the last close, for the "resume" fast path
  let editing = false; // a real form control has focus: suppress the card so it cannot cover a dropdown

  function onRowEnter(event: MouseEvent, slotId: string) {
    if (editing || !hasItem(slotId)) return;
    window.clearTimeout(hoverTimer);
    window.clearTimeout(leaveTimer);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX;
    const resuming = Date.now() - lastHideAt < HOVER_RESUME_MS;
    hoverTimer = window.setTimeout(
      () => place(slotId, rect, x),
      resuming ? 0 : HOVER_DELAY_MS,
    );
  }

  function onRowLeave() {
    window.clearTimeout(hoverTimer);
    // Grace period, not an instant close: the card sits outside the row's own bounds, so
    // reaching it always crosses this "gap" first. Without the grace period the card would
    // vanish the instant the pointer leaves the row, before it ever reaches the card.
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => close(), HOVER_CLOSE_GRACE_MS);
  }

  /** Entering the card itself cancels any pending close from leaving the row. */
  function onCardEnter() {
    window.clearTimeout(leaveTimer);
  }

  function onCardLeave() {
    close();
  }

  function close() {
    window.clearTimeout(leaveTimer);
    if (hover.value) lastHideAt = Date.now();
    hover.value = null;
  }

  /**
   * Anchored to the pointer horizontally and to the row vertically. Anchoring to the row's
   * right edge instead would be tidier, but a slot row spans almost the full column, so
   * the card would always land on top of the stat panel.
   *
   * The vertical flip needs the card's real height, not its CSS max-height, or a short
   * card near the bottom of the screen flips for no reason -- so it is measured once the
   * card exists and nudged only if it actually overflows.
   */
  function place(slotId: string, rect: DOMRect, pointerX: number) {
    const margin = 10;
    let left = pointerX + 18;
    if (left + CARD_W > window.innerWidth - margin)
      left = pointerX - CARD_W - 18;
    hover.value = {
      slotId,
      left: Math.max(left, margin),
      top: rect.bottom + 6,
    };

    nextTick(() => {
      const card = root.value?.querySelector(".itemcard") as HTMLElement | null;
      if (!card || !hover.value) return;
      const height = card.offsetHeight;
      if (hover.value.top + height <= window.innerHeight - margin) return;
      const flipped = Math.max(rect.top - height - 6, margin);
      hover.value = { ...hover.value, top: flipped };
    });
  }

  /**
   * The rect is viewport-relative, so any scroll of the page invalidates it -- close
   * immediately, skipping the leave grace period that exists only for reaching the card by
   * pointer. Registered on the capture phase so a scroll anywhere reaches it even inside a
   * section body that stops propagation -- but capture-phase 'scroll' fires for *every*
   * scrollable element's own scrolling too, including the card's own `overflow-y: auto`.
   * Without this check, scrolling the long card's contents would look indistinguishable from
   * scrolling the page and close the card on its first wheel tick.
   */
  function onScroll(event: Event) {
    if ((event.target as HTMLElement)?.closest?.(".itemcard")) return;
    window.clearTimeout(hoverTimer);
    if (hover.value) close();
  }

  function onFocusIn(event: FocusEvent) {
    editing = isFormControl(event.target as Element | null);
    window.clearTimeout(hoverTimer);
    close();
  }

  function onFocusOut() {
    editing = false;
  }

  onMounted(() => window.addEventListener("scroll", onScroll, true));
  onUnmounted(() => {
    window.clearTimeout(hoverTimer);
    window.clearTimeout(leaveTimer);
    window.removeEventListener("scroll", onScroll, true);
  });

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
