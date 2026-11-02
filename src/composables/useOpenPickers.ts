import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

const openCount = ref(0);

/** True while any ComboBox is open, so a pinned card can step aside for its menu and preview. */
export const anyPickerOpen = computed(() => openCount.value > 0);

/** Counts `open` toward `anyPickerOpen` while it holds, including a picker unmounted open. */
export function trackPickerOpen(open: Ref<boolean>) {
  watch(open, (value) => {
    openCount.value += value ? 1 : -1;
  });
  onScopeDispose(() => {
    if (open.value) openCount.value -= 1;
  });
}
