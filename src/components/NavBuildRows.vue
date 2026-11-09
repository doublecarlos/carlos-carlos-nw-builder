<script setup lang="ts">
// One container's rows in the sidebar's build tree: the top level, or what an open folder
// holds. A folder renders its own rows through this same component, inside a list of its own
// that is a further drop target. Everything shared across the tree comes from NavBuilds by
// injection (see navBuildsContext.ts).
import { inject } from "vue";
import { FileSliders, Folder, FolderOpen } from "@lucide/vue";
import NavRow from "./NavRow.vue";
import DropIndicator from "./ui/DropIndicator.vue";
import {
  NAV_BUILDS_CONTEXT,
  type DropList,
  type NavBuildRow,
} from "../composables/navBuildsContext";

defineProps<{
  rows: NavBuildRow[];
  /** The drop list these rows belong to. */
  drop: DropList;
  /** The folder holding these rows, or null at the top level. */
  parentId: string | null;
}>();

const ctx = inject(NAV_BUILDS_CONTEXT)!;
const { state, on } = ctx;
</script>

<template>
  <template
    v-for="row in rows"
    :key="row.kind === 'build' ? row.build.id : row.folder.id"
  >
    <NavRow
      v-if="row.kind === 'build'"
      :id="row.build.id"
      :name="row.build.name"
      kind="build"
      :data-nested="parentId !== null || undefined"
      :icon="FileSliders"
      :active="state.selectedId === row.build.id"
      :renaming="state.renamingId === row.build.id"
      :rename-text="state.renameText"
      :menu-open="state.menuOpenId === row.build.id"
      :menu-items="state.menuOpenId === row.build.id ? state.menuItems : []"
      :menu-origin="state.menuOrigin"
      :handle-props="
        ctx.handleProps('build', row.build.id, row.index, parentId)
      "
      :row-props="drop.rowProps(row.index)"
      :is-drop-into="false"
      @activate="on.select"
      @select="on.select"
      @rename-start="on.renameStart"
      @rename-commit="on.renameCommit"
      @rename-cancel="on.renameCancel"
      @move-up="on.moveUp"
      @move-down="on.moveDown"
      @delete-request="on.deleteRequest"
      @menu-open="on.menuOpen"
      @menu-action="on.menuAction"
      @menu-close="on.menuClose"
    />

    <template v-else>
      <NavRow
        :id="row.folder.id"
        :name="row.folder.name"
        kind="folder"
        :data-nested="parentId !== null || undefined"
        :icon="ctx.isOpen(row.folder) ? FolderOpen : Folder"
        :count="row.count"
        :active="false"
        :renaming="state.renamingId === row.folder.id"
        :rename-text="state.renameText"
        :menu-open="state.menuOpenId === row.folder.id"
        :menu-items="state.menuOpenId === row.folder.id ? state.menuItems : []"
        :menu-origin="state.menuOrigin"
        :handle-props="
          ctx.handleProps('folder', row.folder.id, row.index, parentId)
        "
        :row-props="
          drop.rowProps(row.index, { into: ctx.canDropInto(row.folder.id) })
        "
        :is-drop-into="drop.intoIndex.value === row.index"
        :collapsed="row.folder.collapsed"
        @activate="on.toggle"
        @select="on.select"
        @folder-toggle="on.toggle"
        @rename-start="on.renameStart"
        @rename-commit="on.renameCommit"
        @rename-cancel="on.renameCancel"
        @move-up="on.moveUp"
        @move-down="on.moveDown"
        @delete-request="on.deleteRequest"
        @menu-open="on.menuOpen"
        @menu-action="on.menuAction"
        @menu-close="on.menuClose"
      />

      <div
        v-if="ctx.isOpen(row.folder)"
        v-bind="ctx.folderDrop(row.folder.id).listProps()"
        :data-flip-key="`${row.folder.id}:builds`"
        data-testid="nav-folder-list"
        class="relative ml-2 space-y-1 pl-1 before:absolute before:inset-y-1 before:left-0 before:w-px before:bg-line before:content-['']"
      >
        <DropIndicator
          :pos="ctx.folderDrop(row.folder.id).separatorStyle.value"
        />
        <NavBuildRows
          :rows="row.rows"
          :drop="ctx.folderDrop(row.folder.id)"
          :parent-id="row.folder.id"
        />
      </div>
    </template>
  </template>
</template>
