<script setup lang="ts">
// A description field that also takes a screenshot: paste an image and OCR's reading of it
// lands in the text, over the selection, still editable.
//
// The image has to be cropped to the wanted text. Recognition transcribes the whole picture,
// and once a tooltip is text there is no telling its prose from its chrome and stat lines --
// which is what the OcrHint.vue marker in the field's corner says.
//
// Always a textarea, so a short description and the long one beside it are the same control at
// the same height. `singleLine` is about the value rather than the box: a field rendered on one
// line takes its transcription folded onto one.
//
// Progress and failure sit out of flow, over whatever follows the field. A control that grows
// a line while it works moves everything below it, and this one works mid-edit.
import { ref, useTemplateRef, nextTick } from "vue";
import { onClickOutside, useTimeoutFn } from "@vueuse/core";
import { LoaderCircle } from "@lucide/vue";
import OcrHint from "./OcrHint.vue";
import { imageFrom, insertText, tidyOcrText } from "../../lib/ocr-paste";

const props = withDefaults(
  defineProps<{
    rows?: number;
    /** The value belongs on one line, so a transcription is folded onto one. */
    singleLine?: boolean;
    placeholder?: string;
  }>(),
  { rows: 2, singleLine: false, placeholder: "" },
);

// Defaulted so a caller can bind an optional field: an absent description arrives as
// `undefined` and is edited as "".
const model = defineModel<string>({ default: "" });

// `data-testid` and any extra classes belong on the control, not on the status wrapper.
defineOptions({ inheritAttrs: false });

const wrapper = useTemplateRef<HTMLElement>("wrapper");
const control = useTemplateRef<HTMLTextAreaElement>("control");
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

onClickOutside(wrapper, () => {
  if (error.value) clearError();
});

const onInput = (event: Event) => {
  clearError();
  model.value = (event.target as HTMLTextAreaElement).value;
};

async function onPaste(event: ClipboardEvent) {
  const image = imageFrom(event.clipboardData?.items);
  if (!image) return; // a text paste is an ordinary paste
  event.preventDefault();

  // Read before awaiting: recognition takes seconds, and the caret can move in the meantime.
  const start = control.value?.selectionStart ?? model.value.length;
  const end = control.value?.selectionEnd ?? start;

  busy.value = true;
  clearError();
  try {
    // Loaded on demand: the engine and its model are several megabytes that nobody who never
    // pastes a screenshot should have to fetch.
    const { readTooltip } = await import("../../lib/ocr");
    const text = tidyOcrText(await readTooltip(image), props.singleLine);
    if (!text) {
      fail("No text was found in that image.");
      return;
    }
    const insertion = insertText(model.value, start, end, text);
    model.value = insertion.value;
    await nextTick();
    control.value?.focus();
    control.value?.setSelectionRange(insertion.caret, insertion.caret);
  } catch (e) {
    fail(
      `Could not read that image: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div ref="wrapper" class="relative min-w-0">
    <textarea
      ref="control"
      v-bind="$attrs"
      :value="model"
      :rows="rows"
      :placeholder="placeholder"
      class="w-full resize-y rounded-md border border-line bg-surface p-2 pr-7 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      @input="onInput"
      @paste="onPaste"
    ></textarea>
    <span class="absolute top-2 right-2 z-10 leading-none"><OcrHint /></span>
    <p
      v-if="busy"
      class="absolute top-full left-0 z-10 flex items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-muted shadow-lg"
      data-testid="ocr-field-busy"
    >
      <LoaderCircle class="animate-spin" />Reading the screenshot…
    </p>
    <p
      v-else-if="error"
      class="absolute top-full left-0 z-10 max-w-full rounded-md border border-line bg-surface px-1.5 py-0.5 text-error shadow-lg"
      data-testid="ocr-field-error"
    >
      {{ error }}
    </p>
  </div>
</template>
