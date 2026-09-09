<script setup lang="ts">
// GoToPalette's own search field: a combobox trigger, not an ordinary form field -- full width,
// underlined rather than boxed, and with no focus ring of its own since the palette opening is
// already the state that matters. Exposes `focus()` so the palette can land keystrokes the
// instant it opens, the one thing its caller needs from the underlying element.
//
// Role/aria-* and data-testid are left to fall through from the caller: they read off the
// palette's own result list and highlight state, which this field knows nothing about.
import { useTemplateRef } from "vue";

withDefaults(defineProps<{ placeholder?: string }>(), { placeholder: "" });

const model = defineModel<string>({ default: "" });
const el = useTemplateRef<HTMLInputElement>("el");

defineExpose({
  focus: () => el.value?.focus(),
});
</script>

<template>
  <input
    ref="el"
    v-model="model"
    type="text"
    class="w-full border-b border-line bg-surface px-3 py-2.5 focus:outline-none"
    :placeholder="placeholder"
  />
</template>
