// What a bonus's input rows need to offer "Make shared": where the conversion writes, and how
// to ask for it. Provided once by the layer editor, so a bonus reached through the item
// carrying it offers the same action as one opened on the standalone Bonuses form.
import { inject, provide, type ComputedRef, type InjectionKey } from "vue";
import type { MakeSharedScope } from "../lib/bonus-draft";
import type { MakeSharedRequest } from "../lib/make-shared";

export interface MakeSharedContext {
  /** Which bonuses this layer owns or overrides, and the ids a new shared input must avoid. */
  scope: ComputedRef<MakeSharedScope>;
  /** Writes a confirmed conversion as one layer edit. */
  request: (request: MakeSharedRequest) => void;
}

const MAKE_SHARED: InjectionKey<MakeSharedContext> = Symbol("makeShared");

/** Offers "Make shared" to every bonus form below. */
export function provideMakeShared(context: MakeSharedContext) {
  provide(MAKE_SHARED, context);
}

/** The surrounding layer editor's "Make shared" writer, or null outside one. */
export function useMakeShared(): MakeSharedContext | null {
  return inject(MAKE_SHARED, null);
}
