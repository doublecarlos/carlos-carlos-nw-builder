// The "go to" palette: whether it is open, and where it last asked the Build editor to go.
//
// A store rather than component state for the same reason stores/shortcutHelp.ts is one -- the
// header button and the Mod+K handler in composables/useGlobalShortcuts.ts both open it, and
// the latter has no component to hold a ref for.
//
// The jump request is parked here rather than called directly because BuildEditor owns both
// the scrolling and the keyboard cursor and is not always mounted (the Layer editor takes its
// place): the palette states a destination, and whichever editor is up consumes it. Same shape
// stores/slotFilter.ts already uses for the Bonuses tab's reach into the slot list.
import { readonly, ref } from "vue";

const _isOpen = ref(false);

export const isOpen = readonly(_isOpen);

export function open() {
  _isOpen.value = true;
}

// Handing focus back on close is BaseModal's job -- see `releaseFocus` there for the one case
// (choosing a destination) that deliberately opts out of it.
export function close() {
  _isOpen.value = false;
}

export function toggle() {
  if (_isOpen.value) close();
  else open();
}

export interface JumpTarget {
  sectionId: string;
  /** Omitted for a whole-section jump. */
  slotId?: string;
}

const _jump = ref<JumpTarget | null>(null);

export const jump = readonly(_jump);

export function requestJump(target: JumpTarget) {
  _jump.value = target;
}

/** Called by whoever acted on the request, so a later remount does not replay it. */
export function consumeJump() {
  _jump.value = null;
}
