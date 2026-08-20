<script setup lang="ts">
// Create an item from a tooltip screenshot: paste or drop the image, OCR reads it, the text
// stays editable, and the parser fills in the item's base stats.
//
// The recognised text is shown and editable on purpose. OCR here omits fields rather than
// getting them wrong, so the useful correction is usually "it missed a line", which is far
// easier to spot and fix in the text than in a half-filled form.
//
// Nothing is written to the catalog: "Create item" seeds an ordinary new draft in ItemForm,
// which still needs an explicit Save.
import { computed, ref } from "vue";
import { CirclePlus, LoaderCircle } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseDrawer from "../ui/BaseDrawer.vue";
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
const hasStats = computed(() => result.value.stats.length > 0);

async function read(image: Blob) {
  busy.value = true;
  error.value = "";
  try {
    // Loaded on demand: the engine and its model are several megabytes that nobody who
    // never opens this drawer should have to fetch.
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
</script>

<template>
  <BaseDrawer>
    <div
      class="flex flex-col gap-2.5"
      data-testid="tooltip-import"
      @paste="onPaste"
      @dragover.prevent
      @drop="onDrop"
    >
      <div class="flex flex-wrap items-baseline gap-2">
        <span class="font-medium">Create an item from a tooltip</span>
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
        class="w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 font-mono"
        placeholder="Paste a screenshot here — the recognised text appears in this box, where you can correct it before creating the item."
      ></textarea>

      <!-- Bounded: a long tooltip produces enough unmatched lines to push the actions below
           the fold, and the drawer itself is not a scroll container. -->
      <div
        v-if="text.trim()"
        class="flex max-h-64 flex-col gap-2 overflow-y-auto lg:flex-row"
      >
        <section class="min-w-0 flex-1">
          <h4 class="mb-1 text-muted">
            Will be filled ({{ result.stats.length }})
          </h4>
          <p v-if="!hasStats" class="text-muted">
            No stat lines recognised yet.
          </p>
          <ul v-else data-testid="tooltip-import-stats" class="flex flex-col">
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

      <div class="flex gap-1.5">
        <BaseButton
          variant="primary"
          :disabled="!hasStats || busy"
          data-testid="tooltip-import-create"
          @click="emit('create', result.draft)"
          ><CirclePlus />Create item</BaseButton
        >
        <BaseButton @click="emit('close')">Cancel</BaseButton>
      </div>
    </div>
  </BaseDrawer>
</template>
