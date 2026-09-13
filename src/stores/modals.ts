// Whether a BaseModal is on screen. A modal owns the screen while it is up, so app-level
// editing shortcuts stay silent rather than reaching the page behind it. A counter, not a
// flag, because modals stack (a confirm over an import): the last one to close clears it.
import { computed, ref } from "vue";

const openCount = ref(0);

export const isModalOpen = computed(() => openCount.value > 0);

/** BaseModal calls these from its mount/unmount lifecycle. */
export function modalOpened() {
  openCount.value += 1;
}

export function modalClosed() {
  openCount.value = Math.max(0, openCount.value - 1);
}
