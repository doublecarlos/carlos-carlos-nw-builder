import { ref } from "vue";
import { useTimeoutFn } from "@vueuse/core";

/**
 * Two-step confirm with auto-expiry. First call to `run(key)` arms the confirmation and
 * returns false; if `run(key)` is called again before the timeout, it fires and returns
 * true. Use `isConfirming(key)` and `label(key, base)` for UI state.
 */
export function useConfirm(ms = 4000) {
  const key_ = ref<string | null>(null);
  const { start, stop } = useTimeoutFn(() => {
    key_.value = null;
  }, ms);

  function isConfirming(key: string) {
    return key_.value === key;
  }

  function label(key: string, baseLabel: string) {
    return isConfirming(key) ? "Really?" : baseLabel;
  }

  /** Arms on first call (returns false), fires on second call (returns true). */
  function run(key: string): boolean {
    if (!isConfirming(key)) {
      key_.value = key;
      stop();
      start();
      return false;
    }
    stop();
    key_.value = null;
    return true;
  }

  return { isConfirming, label, run };
}
