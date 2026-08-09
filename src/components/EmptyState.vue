<script setup lang="ts">
// Centered empty state: shown when there are no builds and no layers.
import { useTemplateRef } from "vue";
import { Plus, Upload } from "@lucide/vue";
import * as builds from "../stores/builds";
import * as layers from "../stores/layers";

const importFileInput = useTemplateRef("importFileInput");

function triggerImport() {
  importFileInput.value?.click();
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    if (parsed?.kind === "layer") {
      layers.importLayerText(text);
    } else {
      builds.importBuildText(text);
    }
  } catch {
    builds.importBuildText(text);
  }
}
</script>

<template>
  <div
    class="flex flex-1 items-center justify-center"
    data-testid="empty-state"
  >
    <div
      class="flex flex-col items-center gap-4 rounded-md border border-dashed border-line p-8 text-center"
    >
      <p class="text-lg text-muted">No builds yet</p>
      <div class="flex gap-3">
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-accent-soft px-4 py-2 font-semibold text-accent hover:bg-accent-soft/80"
          data-testid="empty-new-build"
          @click="builds.createBuild()"
        >
          <Plus class="size-[14px]" />
          New build
        </button>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2 hover:bg-surface-2"
          data-testid="empty-import"
          @click="triggerImport"
        >
          <Upload class="size-[14px]" />
          Import…
        </button>
        <input
          ref="importFileInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onImportFile"
        />
      </div>
    </div>
  </div>
</template>
