<script setup lang="ts">
// The keyboard shortcut list, as a modal overlay. Everything it shows comes from
// data/shortcuts.json via src/data/shortcuts.ts -- it states no binding of its own, so there
// is one place to edit when a binding changes.
import { useTemplateRef, watch, nextTick } from "vue";
import { SHORTCUT_GROUPS } from "../data/shortcuts";
import { chordKeys } from "../lib/shortcut-keys";
import { isMac } from "../lib/platform";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import * as shortcutHelp from "../stores/shortcutHelp";

const panel = useTemplateRef<HTMLElement>("panel");

/** Focus moves into the dialog on open so Escape and Tab belong to it; the store hands focus
 *  back to wherever it came from on close. */
watch(
  () => shortcutHelp.isOpen.value,
  async (open) => {
    if (!open) return;
    await nextTick();
    panel.value?.focus();
  },
  { immediate: true },
);

useEscapeToClose(() => shortcutHelp.close());
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    data-testid="shortcut-help"
    @click.self="shortcutHelp.close()"
  >
    <div
      ref="panel"
      class="flex max-h-[80vh] w-[560px] flex-col rounded-lg border border-line bg-surface shadow-xl focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      tabindex="-1"
    >
      <div
        class="flex items-center justify-between border-b border-line px-4 py-3"
      >
        <h2 id="shortcut-help-title" class="text-base font-semibold">
          Keyboard shortcuts
        </h2>
        <button
          type="button"
          class="cursor-pointer text-muted hover:text-text"
          aria-label="Close"
          data-testid="shortcut-help-close"
          @click="shortcutHelp.close()"
        >
          ✕
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <section
          v-for="group in SHORTCUT_GROUPS"
          :key="group.id"
          class="mb-4 last:mb-0"
          :data-testid="`shortcut-group-${group.id}`"
        >
          <h3 class="mb-1.5 text-sm font-semibold uppercase text-muted">
            {{ group.label }}
          </h3>
          <dl class="flex flex-col gap-1">
            <div
              v-for="shortcut in group.shortcuts"
              :key="shortcut.description"
              class="flex items-baseline gap-3"
            >
              <dt class="flex w-60 flex-none flex-wrap items-baseline gap-1">
                <template v-for="(chord, index) in shortcut.keys" :key="chord">
                  <span v-if="index > 0" class="text-muted">or</span>
                  <!-- Each chord is its own inline-flex run, so a row with alternatives wraps
                       between them rather than through the middle of one. Inside a run, one
                       <kbd> per key, so a chord reads as the keys it is rather than as a
                       run-together string. -->
                  <span class="inline-flex items-baseline gap-1">
                    <template
                      v-for="(key, keyIndex) in chordKeys(chord, isMac)"
                      :key="key"
                    >
                      <span v-if="keyIndex > 0" class="text-muted">+</span>
                      <kbd
                        class="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs whitespace-nowrap"
                        >{{ key }}</kbd
                      >
                    </template>
                  </span>
                </template>
              </dt>
              <dd class="min-w-0 flex-1">{{ shortcut.description }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  </div>
</template>
