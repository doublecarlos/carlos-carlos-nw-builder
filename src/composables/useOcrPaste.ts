// The state behind "paste a screenshot into a field": the busy flag, the self-clearing failure
// message, and the paste handling up to the recognized text. What the text is put into stays
// with the field.
import { ref } from "vue";
import { useTimeoutFn } from "@vueuse/core";
import { imageFrom, tidyOcrText } from "../lib/ocr-paste";

export function useOcrPaste() {
  const busy = ref(false);
  const error = ref("");

  // A failure is drawn over the form rather than in it, so nothing pushes it aside and it would
  // otherwise sit there until the next paste. It goes on any of the three things that mean it
  // has been read: typing in the field, a click anywhere else, or simply time passing.
  const { start: holdError, stop: dropError } = useTimeoutFn(
    () => (error.value = ""),
    6000,
    { immediate: false },
  );

  function clearError() {
    dropError();
    error.value = "";
  }

  function fail(message: string) {
    error.value = message;
    holdError();
  }

  /**
   * Recognizes the image on a paste, or resolves `null` when there is none (an ordinary paste,
   * left alone) or nothing could be read (the failure is shown). `onStart` runs once the paste
   * is claimed and before the wait, for state that can move while recognition runs.
   */
  async function readPaste(
    event: ClipboardEvent,
    singleLine: boolean,
    onStart?: () => void,
  ): Promise<string | null> {
    const image = imageFrom(event.clipboardData?.items);
    if (!image) return null;
    event.preventDefault();
    // One reading at a time: a second paste mid-read is dropped rather than racing the first.
    if (busy.value) return null;
    onStart?.();

    busy.value = true;
    clearError();
    try {
      // Loaded on demand: the engine and its model are several megabytes that nobody who never
      // pastes a screenshot should have to fetch.
      const { readTooltip } = await import("../lib/ocr");
      const text = tidyOcrText(await readTooltip(image), singleLine);
      if (!text) fail("No text was found in that image.");
      return text || null;
    } catch (e) {
      fail(
        `Could not read that image: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, clearError, fail, readPaste };
}
