<script setup lang="ts">
// The ordinary multi-line text field, replacing the raw `<textarea>` class string duplicated at
// each call site the same way BaseInput replaces `<input>`.
const model = defineModel<string>({ default: "" });
</script>

<template>
  <textarea
    v-model="model"
    class="resize-y rounded-md border border-line bg-surface p-2"
  ></textarea>
</template>
