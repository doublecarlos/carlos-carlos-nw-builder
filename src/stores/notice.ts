// A single toast message, shared by anything that needs to tell the user something happened
// (saved, imported, a storage write failed, …). `storageFailed` latches on first failure so
// later ones in the same session don't re-notify.
import { computed, readonly, ref } from "vue";
import { useTimeoutFn } from "@vueuse/core";

export interface NoticeAction {
  label: string;
  run: () => void;
}

const _notice = ref("");
const _noticeAction = ref<NoticeAction | null>(null);
const _storageFailed = ref(false);

const NOTICE_MS = 6000;

const { start: startNoticeTimer, stop: stopNoticeTimer } = useTimeoutFn(() => {
  _notice.value = "";
  _noticeAction.value = null;
}, NOTICE_MS);

export const notice = readonly(_notice);
export const noticeAction = computed(() => _noticeAction.value);
export const storageFailed = computed(() => _storageFailed.value);

/** `action` renders as a small affordance next to the notice (e.g. "View import report") --
 *  only meaningful while this exact notice is still showing, so it clears with the text. */
export function showNotice(text: string, action: NoticeAction | null = null) {
  _notice.value = text;
  _noticeAction.value = action;
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
