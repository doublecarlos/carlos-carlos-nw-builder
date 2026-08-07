<script setup lang="ts">
// LayerEditor's validation findings list: every lint error/warning across the composed
// catalogue (see catalog.validate). Purely a list -- jumping to what a finding points at is
// the parent's job, since that means switching section/selection, which only it owns.
import BaseButton from "../ui/BaseButton.vue";
import BaseDrawer from "../ui/BaseDrawer.vue";
import type { LintFinding } from "../../types";

defineProps<{
  findings: LintFinding[];
}>();

defineEmits<{
  select: [finding: LintFinding];
}>();
</script>

<template>
  <BaseDrawer class="mb-2 max-h-48 flex-none overflow-y-auto">
    <div class="text-sm uppercase text-muted">Validation</div>
    <ul class="mt-1 list-none">
      <li
        v-for="(finding, i) in findings.slice(0, 40)"
        :key="i"
        class="flex gap-2 py-0.5 text-sm"
      >
        <span
          class="flex-none rounded px-1.5 uppercase"
          :class="
            finding.level === 'error'
              ? 'bg-danger-soft text-danger'
              : 'bg-warn/25 text-warn'
          "
          >{{ finding.level }}</span
        >
        <BaseButton
          v-if="finding.name"
          variant="link"
          @click="$emit('select', finding)"
          >{{ finding.name }}</BaseButton
        >
        <span>{{ finding.message }}</span>
      </li>
    </ul>
    <p v-if="findings.length > 40" class="mt-1 text-sm text-muted">
      …and {{ findings.length - 40 }} more.
    </p>
  </BaseDrawer>
</template>
