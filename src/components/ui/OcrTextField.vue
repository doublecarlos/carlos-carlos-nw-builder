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
import { useAttrs, useTemplateRef, nextTick } from "vue";
import { onClickOutside } from "@vueuse/core";
import OcrHint from "./OcrHint.vue";
import OcrStatus from "./OcrStatus.vue";
import { useFormFieldControl } from "../../composables/useFormField";
import { useOcrPaste } from "../../composables/useOcrPaste";
import { insertText } from "../../lib/ocr-paste";

const props = withDefaults(
  defineProps<{
    rows?: number;
    /** The value belongs on one line, so a transcription is folded onto one. */
    singleLine?: boolean;
    placeholder?: string;
    type?: "input" | "textarea";
  }>(),
  { rows: 2, singleLine: false, placeholder: "", type: "textarea" },
);

// Defaulted so a caller can bind an optional field: an absent description arrives as
// `undefined` and is edited as "".
const model = defineModel<string>({ default: "" });

// `data-testid` and any extra classes belong on the control, not on the status wrapper.
defineOptions({ inheritAttrs: false });

const attrs = useAttrs();
const { id: controlId, describedBy } = useFormFieldControl(
  () => attrs.id as string | undefined,
);

const wrapper = useTemplateRef<HTMLElement>("wrapper");
const control = useTemplateRef<HTMLTextAreaElement>("control");
const { busy, error, clearError, readPaste } = useOcrPaste();

onClickOutside(wrapper, () => {
  if (error.value) clearError();
});

const onInput = (event: Event) => {
  clearError();
  model.value = (event.target as HTMLTextAreaElement).value;
};

async function onPaste(event: ClipboardEvent) {
  // Read before awaiting: recognition takes seconds, and the caret can move in the meantime.
  let start = 0;
  let end = 0;
  const text = await readPaste(event, props.singleLine, () => {
    start = control.value?.selectionStart ?? model.value.length;
    end = control.value?.selectionEnd ?? start;
  });
  if (!text) return;
  const insertion = insertText(model.value, start, end, text);
  model.value = insertion.value;
  await nextTick();
  control.value?.focus();
  control.value?.setSelectionRange(insertion.caret, insertion.caret);
}
</script>

<template>
  <div ref="wrapper" class="relative min-w-0">
    <component
      :is="type"
      v-bind="$attrs"
      :id="controlId"
      ref="control"
      :aria-describedby="describedBy"
      :value="model"
      :rows="rows"
      :placeholder="placeholder"
      :class="
        type === 'input'
          ? 'rounded-md border border-line bg-surface py-0.5 pl-1.5 pr-7 focus:outline-2 focus:-outline-offset-1 focus:outline-accent'
          : 'w-full resize-y rounded-md border border-line bg-surface p-2 pr-7 focus:outline-2 focus:-outline-offset-1 focus:outline-accent'
      "
      @input="onInput"
      @paste="onPaste"
    ></component>
    <span class="absolute top-2 right-2 z-sticky leading-none"
      ><OcrHint
    /></span>
    <OcrStatus :busy="busy" :error="error" />
  </div>
</template>
