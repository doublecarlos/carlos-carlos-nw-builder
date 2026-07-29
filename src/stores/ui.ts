// Which page is showing: the builder, or the data editor overlay on top of it.
import { computed, ref } from 'vue';

const _view = ref<'builder' | 'editor'>('builder');

export const view = computed(() => _view.value);

export function openEditor() {
  _view.value = 'editor';
}

export function closeEditor() {
  _view.value = 'builder';
}

/** For route sync (restoring `view` from the URL on back/forward), which needs to set it
 * without implying either open or close semantically. */
export function setView(value: 'builder' | 'editor') {
  _view.value = value;
}
