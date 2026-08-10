<script setup lang="ts">
// "Import from game" wizard: explain how to produce a demo file, take the file, let the user
// pick which loadouts to import, and commit them as new builds. Three back-navigable steps;
// almost all state lives in stores/gameImport.ts so this stays a thin renderer of it.
import { computed, ref, useTemplateRef } from "vue";
import { Copy, Upload } from "@lucide/vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import CodeBlock from "./ui/CodeBlock.vue";
import GameImportReport from "./GameImportReport.vue";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import {
  step,
  parseError,
  rows,
  selected,
  isSelected,
  toggleSelected,
  nameFor,
  setName,
  close,
  goToStep,
  parseFile,
  commit,
  type LoadoutRow,
} from "../stores/gameImport";

const DEMO_COMMAND = "/demo_record build_export $$ demo_record_stop";

const fileInput = useTemplateRef("fileInput");
const isDragging = ref(false);

async function handleFile(file: File) {
  const text = await file.text();
  parseFile(text);
}

function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) handleFile(file);
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) handleFile(file);
}

function triggerFilePick() {
  fileInput.value?.click();
}

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(DEMO_COMMAND);
  } catch {
    // Clipboard permission denied -- the command block is still selectable by hand.
  }
}

/** Loadouts sorted alphabetically (numeric-aware, so "2." sorts before "10.") within each
 *  character -- #190, matching the order the game's own loadout switcher shows them in,
 *  rather than the demo file's recording order. */
const rowsByCharacter = computed(() => {
  const map = new Map<string, LoadoutRow[]>();
  for (const row of rows.value) {
    const list = map.get(row.characterName);
    if (list) list.push(row);
    else map.set(row.characterName, [row]);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      a.loadoutName.localeCompare(b.loadoutName, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }
  return map;
});

const hasSelection = computed(() => selected.value.size > 0);

useEscapeToClose(() => close());
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
    data-testid="game-import-drawer"
    @click.self="close()"
  >
    <div
      class="flex max-h-[85vh] flex-col rounded-lg border border-line bg-surface shadow-xl"
      :class="step === 4 ? 'w-[680px]' : 'w-[560px]'"
    >
      <div
        class="flex items-center justify-between border-b border-line px-4 py-3"
      >
        <h2 class="text-base font-semibold">Import from game</h2>
        <button
          type="button"
          class="cursor-pointer text-muted hover:text-text"
          data-testid="game-import-close"
          @click="close()"
        >
          ✕
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4">
        <!-- Step 1: instructions -->
        <div
          v-if="step === 1"
          class="flex flex-col gap-3"
          data-testid="game-import-step-instructions"
        >
          <div>
            <p class="mb-1 text-sm font-medium">1. In game, run this command</p>
            <div class="flex items-start gap-2">
              <CodeBlock
                :value="DEMO_COMMAND"
                :rows="1"
                class="flex-1"
                data-testid="game-import-command"
              />
              <BaseButton @click="copyCommand"><Copy />Copy</BaseButton>
            </div>
          </div>
          <p class="text-sm">
            <strong>2.</strong> The file appears at
            <code>&lt;game install path&gt;\demos\build_export.demo</code>.
            Steam installs put it under
            <code>steamapps\common\Neverwinter\</code>; the Arc/standalone
            client uses its own install directory.
          </p>
          <p class="text-sm">
            <strong>3.</strong> The recording captures whatever character you're
            logged in as, and includes
            <strong>all of that character's saved loadouts</strong> — switch
            loadouts first only if you want the "currently equipped" marker on a
            particular one.
          </p>
          <p class="text-sm text-muted">
            <strong>4.</strong> The file is plain text and contains the
            character name; nothing is uploaded — parsing happens in your
            browser.
          </p>
          <div class="flex justify-end">
            <BaseButton
              variant="primary"
              data-testid="game-import-next"
              @click="goToStep(2)"
              >Next</BaseButton
            >
          </div>
        </div>

        <!-- Step 2: pick the file -->
        <div
          v-else-if="step === 2"
          class="flex flex-col gap-3"
          data-testid="game-import-step-file"
        >
          <div
            class="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-8 text-center"
            :class="isDragging ? 'border-accent bg-accent-soft' : 'border-line'"
            data-testid="game-import-dropzone"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop="onDrop"
          >
            <Upload class="size-6 text-muted" />
            <p class="text-sm">Drag a demo file here, or</p>
            <BaseButton @click="triggerFilePick">Choose file…</BaseButton>
            <input
              ref="fileInput"
              type="file"
              accept=".demo,.txt"
              class="hidden"
              data-testid="game-import-file-input"
              @change="onFileInputChange"
            />
          </div>
          <p
            v-if="parseError"
            class="text-sm text-danger"
            data-testid="game-import-error"
          >
            {{ parseError }}
          </p>
          <div class="flex justify-between">
            <BaseButton @click="goToStep(1)">Back</BaseButton>
          </div>
        </div>

        <!-- Step 3: pick loadouts -->
        <div
          v-else-if="step === 3"
          class="flex flex-col gap-3"
          data-testid="game-import-step-loadouts"
        >
          <div
            v-for="[characterName, characterRows] in rowsByCharacter"
            :key="characterName"
          >
            <p class="mb-1 text-sm font-semibold">{{ characterName }}</p>
            <div
              v-for="row in characterRows"
              :key="row.key"
              class="mb-1.5 flex items-center gap-2 rounded-md border border-line p-2"
              data-testid="game-import-loadout-row"
            >
              <BaseCheckbox
                :model-value="isSelected(row.key)"
                data-testid="game-import-loadout-checkbox"
                @update:model-value="toggleSelected(row.key)"
              >
                {{ row.loadoutName || "(unnamed loadout)" }}
              </BaseCheckbox>
              <span
                v-if="row.active"
                class="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent"
                data-testid="game-import-active-badge"
                >currently equipped</span
              >
              <span class="text-xs text-muted"
                >{{ row.recognisedCount }}/{{ row.itemCount }} recognised</span
              >
              <span class="flex-1"></span>
              <input
                :value="nameFor(row.key)"
                class="w-56 rounded-md border border-line bg-surface px-1.5 py-0.5 text-sm"
                data-testid="game-import-name-input"
                @input="
                  setName(row.key, ($event.target as HTMLInputElement).value)
                "
              />
            </div>
          </div>
          <div class="flex justify-between">
            <BaseButton @click="goToStep(2)">Back</BaseButton>
            <BaseButton
              variant="primary"
              :disabled="!hasSelection"
              data-testid="game-import-commit"
              @click="commit()"
              >Import selected</BaseButton
            >
          </div>
        </div>

        <!-- Step 4: coverage report -->
        <div
          v-else
          class="flex flex-col gap-3"
          data-testid="game-import-step-report"
        >
          <GameImportReport />
          <div class="flex justify-end">
            <BaseButton
              variant="primary"
              data-testid="game-import-done"
              @click="close()"
              >Done</BaseButton
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
