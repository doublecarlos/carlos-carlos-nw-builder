// A single toast message, shared by anything that needs to tell the user something happened
// (saved, imported, a storage write failed, …). `storageFailed` latches on first failure so
// later ones in the same session don't re-notify.
import { computed, readonly, ref } from "vue";

const _notice = ref("");
const _storageFailed = ref(false);
let timer: number | undefined;

const NOTICE_MS = 6000;

export const notice = readonly(_notice);
export const storageFailed = computed(() => _storageFailed.value);

export function showNotice(text: string) {
  _notice.value = text;
  window.clearTimeout(timer);
  if (text)
    timer = window.setTimeout(() => {
      _notice.value = "";
    }, NOTICE_MS);
}

export function clearNotice() {
  showNotice("");
}

/** First storage failure in the session surfaces a notice; later ones don't pile on. */
export function flagStorageFailed(text: string) {
  if (_storageFailed.value) return;
  _storageFailed.value = true;
  showNotice(text);
}
