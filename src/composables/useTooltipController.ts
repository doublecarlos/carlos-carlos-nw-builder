// Shared open/close bookkeeping for BaseTooltip.
//
// Tooltips are mutually exclusive -- a pointer or focus can only be in one place -- so which
// one is showing is module state rather than a flag per instance. That falls out of the
// exclusivity, and pays for itself: the Escape listener is bound once for the whole app
// instead of once per trigger, and there are ~70 icon buttons.
import { computed, onScopeDispose, ref } from "vue";

/** The tooltip currently showing, identified by the token its instance was handed. */
const active = ref<symbol | null>(null);

let escapeBound = false;

/** Bound on first use rather than at import time, so importing this module has no effect on
 *  the document. The `document` check is for Vitest's `environment: "node"` (see
 *  vitest.config.ts): the open/close logic below is worth unit testing without a DOM, while
 *  the key handling itself is covered by tests/e2e/tooltip.spec.ts. Setting the flag only
 *  after a successful bind keeps a DOM-less first call from marking it done. */
function bindEscape() {
  if (escapeBound || typeof document === "undefined") return;
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") active.value = null;
  });
  escapeBound = true;
}

/** The pointer type behind the last press, or null once a key goes down after it. Lets a
 *  focus caused by a tap be told apart from one the keyboard caused. */
let lastPress: string | null = null;
let modalityBound = false;

/** Capture phase, so the press is recorded before any focus it causes reaches a trigger. */
function bindModality() {
  if (modalityBound || typeof document === "undefined") return;
  document.addEventListener(
    "pointerdown",
    (event: PointerEvent) => (lastPress = event.pointerType),
    true,
  );
  document.addEventListener("keydown", () => (lastPress = null), true);
  modalityBound = true;
}

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

/** True when `el`'s focus should open its tooltip, per `revealsOnFocus`. */
export function focusReveals(el: Element): boolean {
  return revealsOnFocus(el.matches(":focus-visible"), lastPress);
}

/** True when the last press was a finger or pen rather than a mouse. */
export function pressedByTouch(): boolean {
  return lastPress !== null && lastPress !== "mouse";
}

export function useTooltipController() {
  const token = Symbol("tooltip");
  bindModality();

  const open = computed(() => active.value === token);

  function show() {
    bindEscape();
    // Assigning replaces whatever was showing, so the previous tooltip closes on its own --
    // no cross-instance messaging needed.
    active.value = token;
  }

  /** Guarded so a late `mouseleave` from a tooltip that already lost the slot can't close
   *  whichever one took it over. */
  function hide() {
    if (active.value === token) active.value = null;
  }

  onScopeDispose(hide);

  return { open, show, hide };
}

/** Test seam: drops whatever is showing, so one spec's leftover state can't reach the next. */
export function _resetTooltips() {
  active.value = null;
}
