<script setup lang="ts">
// Create an item from a tooltip screenshot: paste or drop the image, OCR reads it, the text
// stays editable, and the parser fills in the item's base stats and its game id.
//
// The recognised text is shown and editable on purpose. OCR here omits fields rather than
// getting them wrong, so the useful correction is usually "it missed a line", which is far
// easier to spot and fix in the text than in a half-filled form.
//
// Nothing is written to the catalog: "Create item" seeds an ordinary new draft in ItemForm,
// which still needs an explicit Save.
//
// Modal rather than in-flow: pasting is the whole point, and a paste only reaches a handler
// bound to an element once focus is already inside it. Owning the screen is what lets the
// screenshot land wherever the cursor happens to be when the window opens.
import { computed, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { CirclePlus, LoaderCircle } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseModal from "../ui/BaseModal.vue";
import { parseTooltip } from "../../lib/tooltip-parser";
import { label, signedStat } from "../../lib/format";
import type { Item } from "../../types";

const emit = defineEmits<{
  create: [draft: Partial<Item>];
  close: [];
}>();

/** The first image on a paste or drop, if there is one. Kept out of `ocr.ts` so that module
 *  -- and the OCR engine it pulls in -- stays behind the dynamic import in `read`. */
function imageFrom(
  items: DataTransferItemList | null | undefined,
): File | null {
  for (const item of items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

const text = ref("");
const busy = ref(false);
const error = ref("");
const result = computed(() => parseTooltip(text.value));
/** The game id is a field of the draft like any stat, so it counts towards -- and on its own
 *  can satisfy -- "there is something here worth creating an item from". */
const filled = computed(
  () => result.value.stats.length + (result.value.gameId ? 1 : 0),
);

async function read(image: Blob) {
  busy.value = true;
  error.value = "";
  try {
    // Loaded on demand: the engine and its model are several megabytes that nobody who
    // never opens this window should have to fetch.
    const { readTooltip } = await import("../../lib/ocr");
    text.value = await readTooltip(image);
    if (!text.value.trim()) error.value = "No text was found in that image.";
  } catch (e) {
    error.value = `Could not read that image: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    busy.value = false;
  }
}

function onPaste(event: ClipboardEvent) {
  const image = imageFrom(event.clipboardData?.items);
  if (!image) return; // plain text paste falls through to the textarea
  event.preventDefault();
  void read(image);
}

function onDrop(event: DragEvent) {
  const image = imageFrom(event.dataTransfer?.items);
  if (!image) return;
  event.preventDefault();
  void read(image);
}

function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void read(file);
}

// Document-level, not on the panel: Ctrl+V is the primary interaction, and it has to work the
// instant the window opens rather than after a click lands focus inside it. A plain text paste
// still falls through to whatever is focused -- `onPaste` only acts on an image.
useEventListener(document, "paste", onPaste);
</script>

<template>
  <BaseModal
    title="Create an item from a tooltip"
    panel-class="max-h-[85vh] w-[760px] max-w-[92vw]"
    data-testid="tooltip-import"
    @close="emit('close')"
    @dragover.prevent
    @drop="onDrop"
  >
    <div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="text-muted"
          >Paste or drop a screenshot. Base stats are filled in; bonuses stay
          yours to author.</span
        >
        <span class="flex-1"></span>
        <BaseButton as="label" :disabled="busy"
          >Choose image…
          <input
            type="file"
            accept="image/*"
            hidden
            data-testid="tooltip-import-file"
            @change="onPick"
        /></BaseButton>
      </div>

      <p v-if="busy" class="flex items-center gap-1.5 text-muted">
        <LoaderCircle class="animate-spin" />Reading the screenshot…
      </p>
      <p v-if="error" class="text-error" data-testid="tooltip-import-error">
        {{ error }}
      </p>

      <textarea
        v-model="text"
        rows="8"
        data-testid="tooltip-import-text"
        class="w-full flex-none resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono"
        placeholder="Paste a screenshot here — the recognised text appears in this box, where you can correct it before creating the item."
      ></textarea>

      <div v-if="text.trim()" class="flex flex-col gap-2 lg:flex-row">
        <section class="min-w-0 flex-1">
          <h4 class="mb-1 text-muted">Will be filled ({{ filled }})</h4>
          <p v-if="!filled" class="text-muted">No stat lines recognised yet.</p>
          <ul v-else data-testid="tooltip-import-stats" class="flex flex-col">
            <li
              v-if="result.gameId"
              data-testid="tooltip-import-game-id"
              class="flex justify-between gap-3 border-b border-line/45 py-0.5"
            >
              <span class="truncate">Game ID</span>
              <span class="min-w-0 truncate font-mono">{{
                result.gameId
              }}</span>
            </li>
            <li
              v-for="s in result.stats"
              :key="s.key"
              class="flex justify-between gap-3 border-b border-line/45 py-0.5"
            >
              <span class="truncate">{{ label(s.key) }}</span>
              <span class="flex-none font-mono">{{
                signedStat(s.key, s.value)
              }}</span>
            </li>
          </ul>
        </section>

        <section v-if="result.bonusLines.length" class="min-w-0 flex-1">
          <h4 class="mb-1 text-muted">
            Not applied — granted by an enchantment or kit ({{
              result.bonusLines.length
            }})
          </h4>
          <ul data-testid="tooltip-import-bonus-lines" class="flex flex-col">
            <li
              v-for="(line, i) in result.bonusLines"
              :key="i"
              class="truncate border-b border-line/45 py-0.5 text-muted"
            >
              {{ line }}
            </li>
          </ul>
        </section>

        <section v-if="result.unmatched.length" class="min-w-0 flex-1">
          <h4 class="mb-1 text-muted">
            Not recognised ({{ result.unmatched.length }})
          </h4>
          <ul data-testid="tooltip-import-unmatched" class="flex flex-col">
            <li
              v-for="(line, i) in result.unmatched"
              :key="i"
              class="truncate border-b border-line/45 py-0.5 text-muted"
            >
              {{ line }}
            </li>
          </ul>
        </section>
      </div>
    </div>

    <div class="flex flex-none gap-1.5 border-t border-line px-4 py-3">
      <BaseButton
        variant="primary"
        :disabled="!filled || busy"
        data-testid="tooltip-import-create"
        @click="emit('create', result.draft)"
        ><CirclePlus />Create item</BaseButton
      >
      <BaseButton @click="emit('close')">Cancel</BaseButton>
    </div>
  </BaseModal>
</template>
