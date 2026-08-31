<script setup lang="ts">
// Landing screen: what stands in front of the builder whenever the app holds nothing at all.
// Says what the app is for and offers the three ways in -- start fresh, import a file, or
// read a build back out of the game.
import { useTemplateRef } from "vue";
import { Gamepad2, Plus, Upload } from "@lucide/vue";
import * as builds from "../stores/builds";
import { DISCLAIMER } from "../lib/app-info";
import { importFileText } from "../stores/importFile";
// Only asks for the wizard: it is mounted once, in AppHeader, for every entry point.
import { openWizard as openGameImport } from "../stores/gameImport";

const importFileInput = useTemplateRef("importFileInput");

// Each way in just makes content; selecting it is what puts the builder up, so nothing here
// has to dismiss this screen by hand. An import that fails, or a wizard the user backs out
// of, therefore leaves them here with the ways in still in front of them.

/** The builds store keeps one build alive at all times, so a fresh visit already has an empty
 *  "Build 1" waiting behind this screen. Starting here commits that one; minting another
 *  would only leave the newcomer with a stray "Build 1" they never asked for. */
function startBuilding() {
  builds.commitActive();
}

function triggerImport() {
  importFileInput.value?.click();
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  importFileText(await file.text(), file.name);
}
</script>

<template>
  <div
    class="relative flex flex-1 items-center justify-center overflow-hidden px-6"
    data-testid="landing"
  >
    <!-- Decoration only: the app icon blown up behind the text. Faint enough that the copy
         over it keeps its contrast, and lifted a little in dark mode, where the same opacity
         against a dark ground reads as nothing at all. -->
    <img
      src="/icon-512.png"
      alt=""
      aria-hidden="true"
      class="pointer-events-none absolute w-[min(70vh,34rem)] max-w-[80%] -translate-y-4 opacity-[0.07] select-none dark:opacity-[0.1]"
      data-testid="landing-watermark"
    />

    <div class="relative flex max-w-xl flex-col items-center gap-6 text-center">
      <div class="flex flex-col gap-3">
        <h2 class="text-3xl font-semibold tracking-wide">
          Carlos Carlos' NW Builder
        </h2>
        <p class="text-lg text-muted">Create and compare Neverwinter builds.</p>
        <p class="text-muted">
          You can define your own items and bonuses using customization layers.
          <br />
          Built-in database contains recent gear for Hellbringer and Arbiter.
          <br />
          Everything is saved on your browser - export to download a permanent
          copy.
        </p>
      </div>

      <button
        type="button"
        class="inline-flex cursor-pointer items-center gap-2 rounded-md bg-accent-soft px-6 py-3 text-lg font-semibold text-accent hover:bg-accent-soft/80"
        data-testid="landing-new-build"
        @click="startBuilding"
      >
        <Plus class="size-[18px]" />
        New build
      </button>

      <!-- The two ways in that start from something you already have, kept quieter than the
           one that needs nothing. -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2 hover:bg-surface-2"
          data-testid="landing-import"
          @click="triggerImport"
        >
          <Upload class="size-[14px]" />
          Import…
        </button>
        <button
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2 hover:bg-surface-2"
          data-testid="landing-import-from-game"
          @click="openGameImport"
        >
          <Gamepad2 class="size-[14px]" />
          Import from game…
        </button>
        <input
          ref="importFileInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onImportFile"
        />
      </div>

      <!-- Also in the About dialog, which is the only place a returning user would see it. -->
      <p class="text-xs text-muted" data-testid="landing-disclaimer">
        {{ DISCLAIMER }}
      </p>
    </div>
  </div>
</template>
