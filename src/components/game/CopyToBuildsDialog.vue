<script setup lang="ts">
// Picks the builds a section is copied into. The list draws the sidebar's folder tree
// (lib/tree-rows.ts), and each folder's box ticks every build under it at any depth, reading
// as mixed while only some are (lib/check-tree.ts). The filter matches a build's name or its
// folders, and a folder's box covers only the builds on screen, so ticking never reaches a
// build the filter hides. Ticks outside the filter are kept and still counted.
//
// A build that already holds this build's values for the section is marked as the same and
// can't be ticked, so a folder's box passes over it: copying there would change nothing.
import { computed, ref } from "vue";
import { Copy } from "@lucide/vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseModal from "../ui/BaseModal.vue";
import ClearableInput from "../ui/ClearableInput.vue";
import FolderHeading from "./FolderHeading.vue";
import * as builds from "../../stores/builds";
import { db } from "../../stores/resolved";
import { sameSection } from "../../lib/build-changes";
import { checkState, headingMembers, setTicked } from "../../lib/check-tree";
import { matchesQuery } from "../../lib/text-filter";
import { pathLabel, treeIndent, treeRows } from "../../lib/tree-rows";
import type { BuildOption } from "../../types";

const props = defineProps<{
  sectionId: string;
  /** The section being copied, for the dialog's wording. */
  label: string;
  /** The builds to offer, the one being copied from left out. */
  targets: BuildOption[];
}>();

const emit = defineEmits<{
  copy: [toIds: string[]];
  close: [];
}>();

const filter = ref("");
const ticked = ref<Set<string>>(new Set());

/** The builds this section already matches in, against the build being copied from. */
const same = computed(() => {
  const source = builds.build.value;
  const ids = new Set<string>();
  if (!source) return ids;
  for (const target of props.targets) {
    const b = builds.get(target.value);
    if (b && sameSection(db.value, source, b, props.sectionId))
      ids.add(target.value);
  }
  return ids;
});

/** The tree as filtered, without tick state, so ticking does not redraw it. */
const tree = computed(() => {
  const shown = props.targets.filter((build) =>
    matchesQuery([build.label, pathLabel(build.path)], filter.value),
  );
  const rows = treeRows(shown, (build) => build.path);
  const members = headingMembers(rows, (build) => build.value);
  const copyable = (ids: string[]) => ids.filter((id) => !same.value.has(id));
  return rows.map((row, index) =>
    row.kind === "heading"
      ? {
          kind: "folder" as const,
          key: `folder:${row.step.key}`,
          label: row.step.label,
          depth: row.depth,
          ids: copyable(members.get(index)!),
        }
      : {
          kind: "build" as const,
          key: row.item.value,
          label: row.item.label,
          depth: row.depth,
          ids: copyable([row.item.value]),
          same: same.value.has(row.item.value),
        },
  );
});

const rows = computed(() =>
  tree.value.map((row) => ({
    ...row,
    state: checkState(row.ids, ticked.value),
  })),
);

const copyableIds = computed(() =>
  tree.value.flatMap((row) => (row.kind === "build" ? row.ids : [])),
);

const allState = computed(() => checkState(copyableIds.value, ticked.value));

function tick(ids: readonly string[], on: boolean | string[]) {
  ticked.value = setTicked(ticked.value, ids, on === true);
}

/** In list order, so builds are copied top to bottom as the user sees them. */
const chosen = computed(() =>
  props.targets
    .map((build) => build.value)
    .filter((id) => ticked.value.has(id)),
);

function submit() {
  if (!chosen.value.length) return;
  emit("copy", chosen.value);
  emit("close");
}
</script>

<template>
  <BaseModal
    :title="`Copy ${label} to other builds`"
    panel-class="max-h-[80vh] w-[28rem] max-w-[92vw]"
    data-testid="copy-to-builds"
    @close="emit('close')"
  >
    <div class="flex flex-none flex-col gap-2 px-4 pt-3">
      <p class="text-muted">
        Replaces {{ label }} in each build you tick with this build's.
      </p>
      <ClearableInput
        v-model="filter"
        placeholder="Filter builds…"
        testid="copy-to-builds-filter"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-2">
      <template v-if="rows.length">
        <BaseCheckbox
          class="py-0.5 font-semibold"
          :model-value="allState === 'on'"
          :indeterminate="allState === 'mixed'"
          :disabled="!copyableIds.length"
          data-testid="copy-to-builds-all"
          @update:model-value="(on) => tick(copyableIds, on)"
          >{{ filter ? "All matching builds" : "All builds" }}</BaseCheckbox
        >
        <template v-for="row in rows" :key="row.key">
          <BaseCheckbox
            v-if="row.kind === 'folder'"
            class="py-0.5"
            :style="treeIndent(row.depth + 1)"
            :model-value="row.state === 'on'"
            :indeterminate="row.state === 'mixed'"
            :disabled="!row.ids.length"
            data-testid="copy-to-builds-folder"
            @update:model-value="(on) => tick(row.ids, on)"
            ><FolderHeading :name="row.label" :depth="0"
          /></BaseCheckbox>
          <div
            v-else
            class="flex items-center gap-2 py-0.5"
            :style="treeIndent(row.depth + 1)"
          >
            <BaseCheckbox
              :model-value="row.state === 'on'"
              :disabled="row.same"
              :inline="row.same"
              data-testid="copy-to-builds-build"
              @update:model-value="(on) => tick(row.ids, on)"
              >{{ row.label }}</BaseCheckbox
            >
            <span
              v-if="row.same"
              class="text-xs text-muted"
              data-testid="copy-to-builds-same"
              >already the same</span
            >
          </div>
        </template>
      </template>
      <p v-else class="py-2 text-muted">No builds match.</p>
    </div>

    <div
      class="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3"
    >
      <BaseButton data-testid="copy-to-builds-cancel" @click="emit('close')"
        >Cancel</BaseButton
      >
      <BaseButton
        variant="primary"
        :disabled="!chosen.length"
        data-testid="copy-to-builds-submit"
        @click="submit"
        ><Copy />{{
          chosen.length === 1
            ? "Copy to 1 build"
            : `Copy to ${chosen.length} builds`
        }}</BaseButton
      >
    </div>
  </BaseModal>
</template>
