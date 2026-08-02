// A single toast message, shared by anything that needs to tell the user something happened
// (saved, imported, a storage write failed, …). `storageFailed` latches on first failure so
// later ones in the same session don't re-notify.
import { computed, readonly, ref } from "vue";
import { useTimeoutFn } from "@vueuse/core";

const _notice = ref("");
const _storageFailed = ref(false);

const NOTICE_MS = 6000;

const { start: startNoticeTimer, stop: stopNoticeTimer } = useTimeoutFn(() => {
  _notice.value = "";
}, NOTICE_MS);

export const notice = readonly(_notice);
export const storageFailed = computed(() => _storageFailed.value);

export function showNotice(text: string) {
  _notice.value = text;
  stopNoticeTimer();
  if (text) startNoticeTimer();
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
