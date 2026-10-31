// What a page hosting an editor form tells that form's DraftFormBar. The phone layer editor
// shows one form at a time with no room to spare, so its bar carries Back and folds its
// actions into a menu.
import type { Component, InjectionKey, Ref } from "vue";

/** An entry the host adds to the compact bar's menu, after the form's own actions. */
export interface FormBarHostAction {
  key: string;
  label: string;
  icon: Component;
  disabled: boolean;
  run: () => void;
}

export interface FormBarContext {
  /** Leaves the form for the list it was opened from. */
  back: () => void;
  /** The host's own actions that its hidden chrome would otherwise hold (undo, redo). */
  actions: FormBarHostAction[];
}

/** Provided as a ref so the host can switch it off when its layout changes. */
export const FORM_BAR_CONTEXT: InjectionKey<Ref<FormBarContext | null>> =
  Symbol("form-bar-context");
