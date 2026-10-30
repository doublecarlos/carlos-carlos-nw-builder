<script setup lang="ts">
// The ordinary multi-line text field, replacing the raw `<textarea>` class string duplicated at
// each call site the same way BaseInput replaces `<input>`.
import { useAttrs } from "vue";
import { useFormFieldControl } from "../../composables/useFormField";

const model = defineModel<string>({ default: "" });

const attrs = useAttrs();
const { id, describedBy } = useFormFieldControl(
  () => attrs.id as string | undefined,
);
</script>

<template>
  <textarea
    :id="id"
    v-model="model"
    :aria-describedby="describedBy"
    class="resize-y rounded-md border border-line bg-surface p-2"
  ></textarea>
</template>
