<script setup lang="ts">
// A folder heading in a build list outside the sidebar (pickers, menus, import and export),
// indented to its depth so the list reads as the same tree the sidebar draws.
import { Folder } from "@lucide/vue";
import { treeIndent } from "../../lib/tree-rows";

defineProps<{ name: string; depth: number }>();
</script>

<template>
  <span
    class="flex min-w-0 items-center gap-1.5 font-semibold text-muted"
    :style="treeIndent(depth)"
    :title="name"
  >
    <Folder class="size-[13px] flex-none" />
    <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{
      name
    }}</span>
  </span>
</template>
