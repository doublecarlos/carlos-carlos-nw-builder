// The app's one confirmation dialog as shared state: callers `ask` and await the outcome,
// ConfirmDialog.vue renders whatever is pending. Keeps callers plain functions.
import { computed, ref } from "vue";
import { isMac } from "../lib/platform";

export const UNDO_NOTE = `${isMac ? "⌘" : "Ctrl"}+Z undoes this.`;

export interface ConfirmCheckbox {
  label: string;
  /** Ticked when the dialog opens, and the answer a skipped confirmation reports. */
  checked: boolean;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  /** Red confirm button and a warning icon. */
  danger?: boolean;
  /** A line under the question saying how the thing comes back, or that it does not. */
  note?: string;
  /** Extra decision, carried back in the outcome. */
  checkbox?: ConfirmCheckbox;
}

export interface ConfirmOutcome {
  ok: boolean;
  /** The checkbox's final state, or its default when the dialog was skipped. */
  checked: boolean;
}

interface Pending {
  request: ConfirmRequest;
  settle: (outcome: ConfirmOutcome) => void;
}

const _pending = ref<Pending | null>(null);

export const pending = computed(() => _pending.value?.request ?? null);

/** Resolves once the user answers. A request arriving while another is up cancels the older
 *  one rather than queueing; only one dialog is ever rendered. */
export function ask(request: ConfirmRequest): Promise<ConfirmOutcome> {
  _pending.value?.settle({ ok: false, checked: false });
  return new Promise<ConfirmOutcome>((resolve) => {
    _pending.value = { request, settle: resolve };
  });
}

/** `ask`, unless `skip` (the Shift-held shortcut). Skipping answers yes with the checkbox at
 *  its default. */
export function askUnless(
  skip: boolean,
  request: ConfirmRequest,
): Promise<ConfirmOutcome> {
  if (skip)
    return Promise.resolve({
      ok: true,
      checked: request.checkbox?.checked ?? false,
    });
  return ask(request);
}

/** ConfirmDialog.vue is the only caller. */
export function settle(ok: boolean, checked = false) {
  const p = _pending.value;
  if (!p) return;
  _pending.value = null;
  p.settle({ ok, checked });
}
