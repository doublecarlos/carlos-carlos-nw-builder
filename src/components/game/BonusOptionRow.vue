<script setup lang="ts">
// How a bonus reads as a picker row, wherever one is offered: the name leads, the id sits
// under it in small type. Shared by BonusComboBox (one bonus) and the `excludes` TokenInput
// (several), so the two never drift on what a bonus row looks like.
import type { BonusOption } from "../../types";

defineProps<{ option: BonusOption }>();
</script>

<template>
  <div class="min-w-0 leading-tight">
    <div class="overflow-hidden text-ellipsis whitespace-nowrap">
      {{ option.label }}
    </div>
    <div
      class="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted"
      data-testid="bonus-option-id"
    >
      {{ option.value }}
    </div>
  </div>
</template>
