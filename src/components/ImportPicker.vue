<script setup lang="ts">
// What a file holds, row by row, with the ticks and conflict choices that decide what lands.
// Opens ready to take everything, with the Import button focused: Enter is the whole happy
// path, however much is in the file.
import { computed, onMounted, reactive, useTemplateRef } from "vue";
import { Check } from "@lucide/vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseModal from "./ui/BaseModal.vue";
import ImportPickerRow from "./ImportPickerRow.vue";
import FolderHeading from "./game/FolderHeading.vue";
import { treeIndent, treeRows } from "../lib/tree-rows";
import * as importFile from "../stores/importFile";
import {
  acceptAll,
  conflictCount,
  type ImportPlan,
  type Resolution,
} from "../lib/import-plan";

const props = defineProps<{ plan: ImportPlan }>();

const decisions = reactive(acceptAll(props.plan));

const entries = computed(() => [
  ...props.plan.builds.map((entry, i) => ({ entry, d: decisions.builds[i] })),
  ...props.plan.layers.map((entry, i) => ({ entry, d: decisions.layers[i] })),
]);

const selectedCount = computed(
  () => entries.value.filter(({ d }) => d.selected).length,
);
const conflicts = computed(() => conflictCount(props.plan));
const replacingCount = computed(
  () =>
    entries.value.filter(
      ({ entry, d }) =>
        entry.conflictName && d.selected && d.resolution === "replace",
    ).length,
);

const summary = computed(() =>
  (
    [
      [props.plan.builds.length, "build"],
      [props.plan.layers.length, "layer"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, noun]) => `${n} ${noun}${n === 1 ? "" : "s"}`)
    .join(" and "),
);

/** The file's builds in its own order, with a folder heading wherever the path enters a
 *  folder the previous build was not in (lib/tree-rows.ts). */
const buildRows = computed(() =>
  treeRows(
    props.plan.builds.map((entry, index) => ({ entry, index })),
    (row) => row.entry.path,
  ),
);

function setAllSelected(selected: boolean) {
  for (const { d } of entries.value) d.selected = selected;
}

function setAllConflicts(resolution: Resolution) {
  for (const { entry, d } of entries.value) {
    if (entry.conflictName) d.resolution = resolution;
  }
}

const confirmButton =
  useTemplateRef<InstanceType<typeof BaseButton>>("confirmButton");
onMounted(() => confirmButton.value?.focus());

function runImport() {
  importFile.applyImport(props.plan, {
    builds: decisions.builds,
    layers: decisions.layers,
  });
}
</script>

<template>
  <BaseModal
    title="Import"
    panel-class="max-h-[80vh] w-[560px]"
    data-testid="import-picker"
    @close="importFile.cancelImport()"
  >
    <div
      class="flex flex-none items-center gap-2 border-b border-line px-4 py-2 text-sm"
    >
      <span data-testid="import-summary">
        {{ summary }}
        <span v-if="plan.fileName" class="text-muted"
          >in {{ plan.fileName }}</span
        >
      </span>
      <span class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="cursor-pointer text-accent hover:underline"
          data-testid="import-select-all"
          @click="setAllSelected(true)"
        >
          All
        </button>
        <span class="text-muted">/</span>
        <button
          type="button"
          class="cursor-pointer text-accent hover:underline"
          data-testid="import-select-none"
          @click="setAllSelected(false)"
        >
          None
        </button>
      </span>
    </div>

    <!-- Conflicts are the only thing here that can cost the user work, so they are stated up
         front and settled in one click rather than row by row. -->
    <div
      v-if="conflicts"
      class="flex flex-none items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-sm"
      data-testid="import-conflict-bar"
    >
      <span>
        {{ conflicts }} of {{ conflicts === 1 ? "these is" : "these are" }}
        already here.
      </span>
      <span class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="cursor-pointer text-accent hover:underline"
          data-testid="import-all-new"
          @click="setAllConflicts('new')"
        >
          Keep both
        </button>
        <span class="text-muted">/</span>
        <button
          type="button"
          class="cursor-pointer text-accent hover:underline"
          data-testid="import-all-replace"
          @click="setAllConflicts('replace')"
        >
          Replace all
        </button>
      </span>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-3">
      <section v-if="plan.builds.length">
        <h3 class="mb-1 text-sm font-medium text-muted">Builds</h3>
        <template v-for="(row, position) in buildRows" :key="position">
          <p
            v-if="row.kind === 'heading'"
            class="pt-1 text-sm"
            data-testid="import-folder-label"
          >
            <FolderHeading :name="row.step.label" :depth="row.depth" />
          </p>
          <ImportPickerRow
            v-else
            v-model:selected="decisions.builds[row.item.index].selected"
            v-model:resolution="decisions.builds[row.item.index].resolution"
            kind="build"
            :style="treeIndent(row.depth)"
            :name="row.item.entry.name"
            :conflict-name="row.item.entry.conflictName"
          />
        </template>
      </section>

      <section
        v-if="plan.layers.length"
        :class="plan.builds.length ? 'mt-3' : ''"
      >
        <h3 class="mb-1 text-sm font-medium text-muted">Layers</h3>
        <ImportPickerRow
          v-for="(entry, index) in plan.layers"
          :key="index"
          v-model:selected="decisions.layers[index].selected"
          v-model:resolution="decisions.layers[index].resolution"
          kind="layer"
          :name="entry.name"
          :conflict-name="entry.conflictName"
        />
      </section>
    </div>

    <p
      v-if="plan.catalogStale"
      class="flex-none px-4 pb-2 text-sm text-warning"
      data-testid="import-stale"
    >
      Made against an older item catalog; some items may no longer resolve.
    </p>

    <div
      class="flex flex-none items-center gap-2 border-t border-line px-4 py-3"
    >
      <p
        v-if="replacingCount"
        class="text-sm text-warning"
        data-testid="import-replace-warning"
      >
        {{ replacingCount }} will be replaced; the old
        {{ replacingCount === 1 ? "copy goes" : "copies go" }} to the trash.
      </p>
      <div class="ml-auto flex flex-none items-center gap-2">
        <BaseButton
          data-testid="import-cancel"
          @click="importFile.cancelImport()"
        >
          Cancel
        </BaseButton>
        <BaseButton
          ref="confirmButton"
          variant="primary"
          :disabled="!selectedCount"
          data-testid="import-confirm"
          @click="runImport"
        >
          <Check />
          Import {{ selectedCount }}
        </BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
