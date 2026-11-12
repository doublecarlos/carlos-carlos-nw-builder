// Shared open/close bookkeeping and event handling for BaseTooltip.
//
// Tooltips are mutually exclusive, since a pointer or focus can only be in one place, so
// which one is showing is module state rather than a flag per instance. The same holds for
// the hover delay, so one timer serves them all. Event handling is delegated: one set of
// listeners on `document` finds the trigger under an event through its `data-tooltip` mark
// and looks up what that trigger registered, so a page of tooltips costs no listeners of its
// own.
import { computed, onScopeDispose, ref } from "vue";

/** The tooltip currently showing, identified by the token its instance was handed. */
const active = ref<symbol | null>(null);

/** What a trigger registers with `attach`. Getters, so a caller's props stay reactive. */
export interface TooltipTriggerOptions {
  /** Whether it has text to show. An empty one lets events reach a tooltip around it. */
  enabled: () => boolean;
  /** Hover open delay in ms. */
  delayMs: () => number;
  /** A tap toggles the bubble, and a press anywhere else closes it. */
  tappable: () => boolean;
  /** Opens and places the bubble. Does nothing when there is no text to show. */
  reveal: () => void;
}

interface TriggerEntry extends TooltipTriggerOptions {
  token: symbol;
}

/** Marks a registered trigger, so a delegated event finds it with `closest()`. */
const TRIGGER_ATTR = "data-tooltip";

const triggers = new WeakMap<Element, TriggerEntry>();

/** The trigger whose tooltip is showing, for the tappable outside press. */
let activeTrigger: Element | null = null;

/** The one pending hover open, if any. */
let pending: {
  trigger: Element;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

/** Drops the pending open, or only `trigger`'s when given. */
function cancelPending(trigger?: Element) {
  if (!pending || (trigger && pending.trigger !== trigger)) return;
  clearTimeout(pending.timer);
  pending = null;
}

function hideEntry(entry: TriggerEntry) {
  if (active.value === entry.token) active.value = null;
}

/** The pointer entered `trigger`: its tooltip opens after the delay. */
export function pointerEntered(trigger: Element) {
  const entry = triggers.get(trigger);
  if (!entry) return;
  cancelPending();
  pending = {
    trigger,
    timer: setTimeout(() => {
      pending = null;
      entry.reveal();
    }, entry.delayMs()),
  };
}

/** Keyboard focus landed on `trigger`: its tooltip opens with no delay, since a keyboard
 *  user has already committed to the control. */
export function triggerFocused(trigger: Element) {
  const entry = triggers.get(trigger);
  if (!entry) return;
  cancelPending();
  entry.reveal();
}

/** The pointer or focus left `trigger`: its pending open is dropped and its bubble closes. */
export function triggerLeft(trigger: Element) {
  const entry = triggers.get(trigger);
  if (!entry) return;
  cancelPending(trigger);
  hideEntry(entry);
}

/** A click usually opens something, a menu or a dialog, and a bubble left over it would cover
 *  what the click produced, so it closes. A tap on a tappable trigger opens it instead. */
export function triggerClicked(trigger: Element, byTouch: boolean) {
  const entry = triggers.get(trigger);
  if (!entry) return;
  if (entry.tappable() && byTouch && active.value !== entry.token) {
    entry.reveal();
  } else {
    triggerLeft(trigger);
  }
}

/** A tap-opened bubble has no pointer leaving to close it, so a press outside its trigger
 *  does. */
export function pressedOutside(target: Node | null) {
  if (!activeTrigger) return;
  const entry = triggers.get(activeTrigger);
  if (entry?.tappable() && !activeTrigger.contains(target)) hideEntry(entry);
}

/** A scroll leaves an open bubble pointing at where its trigger used to be. A pending open
 *  is kept: that scroll is often what brought the trigger under the pointer, and `reveal`
 *  reads a fresh rect when the timer fires. */
export function scrolled() {
  active.value = null;
}

/** The pointer type behind the last press, or null once a key goes down after it. Lets a
 *  focus caused by a tap be told apart from one the keyboard caused. */
let lastPress: string | null = null;

/** Pure. Whether focus landing on a trigger opens its tooltip: only keyboard focus does.
 *  `:focus-visible` rules out a click, and a script's focus after one (a modal handing focus
 *  back). The last press rules out a tap, since a tapped text field matches `:focus-visible`
 *  too. */
export function revealsOnFocus(
  focusVisible: boolean,
  press: string | null,
): boolean {
  return focusVisible && (press === null || press === "mouse");
}

/** The innermost registered trigger at or above `el` that has text to show. A BaseButton
 *  wraps itself in a tooltip for its `title`, so a caller's tooltip around one sits outside
 *  an empty inner trigger. */
export function enabledTrigger(el: Element | null): Element | null {
  let trigger = el?.closest(`[${TRIGGER_ATTR}]`) ?? null;
  while (trigger && !triggers.get(trigger)?.enabled()) {
    trigger = trigger.parentElement?.closest(`[${TRIGGER_ATTR}]`) ?? null;
  }
  return trigger;
}

function triggerOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? enabledTrigger(target) : null;
}

/** Whether a pointer coming from or going to `related` crosses `trigger`'s edge. Over and out
 *  bubble from every descendant, unlike enter and leave, so moves inside are filtered out. */
function crossesEdge(trigger: Element, related: EventTarget | null): boolean {
  return !(related instanceof Node && trigger.contains(related));
}

let bound = false;

/** Bound on first `attach` rather than at import time, so importing this module has no
 *  effect on the document. The `document` check is for Vitest's `environment: "node"` (see
 *  vitest.config.ts): the rules above are unit tested without a DOM, while the wiring is
 *  covered by tests/e2e/tooltip.spec.ts.
 *
 *  Trigger events listen in the capture phase, so a `@click.stop` on a trigger can't keep
 *  its bubble from closing. The innermost of nested triggers with text is the one that
 *  responds. */
function bindListeners() {
  if (bound || typeof document === "undefined") return;
  bound = true;
  const capture = { capture: true };

  // Recorded before any focus the press causes reaches a trigger. A mouse press on a trigger
  // closes its bubble as a click would, since a press that becomes a drag never clicks and
  // its pointer never leaves the trigger it captured.
  document.addEventListener(
    "pointerdown",
    (event: PointerEvent) => {
      lastPress = event.pointerType;
      pressedOutside(event.target as Node | null);
      const trigger = triggerOf(event.target);
      if (trigger && event.pointerType === "mouse") triggerLeft(trigger);
    },
    capture,
  );
  document.addEventListener("keydown", () => (lastPress = null), capture);
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") active.value = null;
  });

  // Mouse only, so the compatibility events a tap fires are ignored.
  document.addEventListener(
    "pointerover",
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const trigger = triggerOf(event.target);
      if (trigger && crossesEdge(trigger, event.relatedTarget)) {
        pointerEntered(trigger);
      }
    },
    capture,
  );
  document.addEventListener(
    "pointerout",
    (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const trigger = triggerOf(event.target);
      if (trigger && crossesEdge(trigger, event.relatedTarget)) {
        triggerLeft(trigger);
      }
    },
    capture,
  );

  // Focus inside a trigger counts, so one that wraps its own focusable (a label around an
  // input) still reports as focused.
  document.addEventListener(
    "focusin",
    (event: FocusEvent) => {
      const trigger = triggerOf(event.target);
      const target = event.target as Element;
      if (
        trigger &&
        revealsOnFocus(target.matches(":focus-visible"), lastPress)
      ) {
        triggerFocused(trigger);
      }
    },
    capture,
  );
  document.addEventListener(
    "focusout",
    (event: FocusEvent) => {
      const trigger = triggerOf(event.target);
      if (trigger) triggerLeft(trigger);
    },
    capture,
  );

  document.addEventListener(
    "click",
    (event: MouseEvent) => {
      const trigger = triggerOf(event.target);
      const byTouch = lastPress !== null && lastPress !== "mouse";
      if (trigger) triggerClicked(trigger, byTouch);
    },
    capture,
  );

  window.addEventListener("scroll", scrolled, capture);
}

export function useTooltipController() {
  const token = Symbol("tooltip");
  let attached: Element | null = null;

  const open = computed(() => active.value === token);

  function show() {
    // Assigning replaces whatever was showing, so the previous tooltip closes on its own,
    // with no cross-instance messaging needed.
    active.value = token;
    activeTrigger = attached;
  }

  /** Guarded so a late leave from a tooltip that already lost the slot can't close
   *  whichever one took it over. */
  function hide() {
    if (active.value === token) active.value = null;
  }

  /** Registers `trigger` with the delegated listeners. */
  function attach(trigger: Element, options: TooltipTriggerOptions) {
    bindListeners();
    attached = trigger;
    triggers.set(trigger, { ...options, token });
    trigger.setAttribute(TRIGGER_ATTR, "");
  }

  function detach() {
    if (!attached) return;
    cancelPending(attached);
    if (triggers.get(attached)?.token === token) {
      triggers.delete(attached);
      attached.removeAttribute(TRIGGER_ATTR);
    }
    if (activeTrigger === attached) activeTrigger = null;
    attached = null;
  }

  onScopeDispose(() => {
    detach();
    hide();
  });

  return { open, show, hide, attach, detach };
}

/** Test seam: drops whatever is showing or pending, so one spec's leftover state can't reach
 *  the next. */
export function _resetTooltips() {
  cancelPending();
  active.value = null;
  activeTrigger = null;
  lastPress = null;
}
