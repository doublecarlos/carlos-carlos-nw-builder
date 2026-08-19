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

export function useTooltipController() {
  const token = Symbol("tooltip");

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
