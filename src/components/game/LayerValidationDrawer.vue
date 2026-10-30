<script setup lang="ts">
// LayerEditor's validation findings list: every lint error/warning across the composed
// catalog (see catalog.validate). Purely a list -- jumping to what a finding points at is
// the parent's job, since that means switching section/selection, which only it owns.
import BaseLink from "../ui/BaseLink.vue";
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
  <BaseDrawer
    data-testid="validation-drawer"
    class="mb-2 max-h-48 flex-none overflow-y-auto max-md:max-h-32"
  >
    <div class="uppercase text-muted">Validation</div>
    <ul class="mt-1 list-none">
      <li
        v-for="(finding, i) in findings.slice(0, 40)"
        :key="i"
        class="flex gap-2 py-0.5 max-md:flex-wrap max-md:gap-x-1.5"
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
        <!-- Ids are long unbroken words; let them break rather than widen a phone's page. -->
        <BaseLink
          v-if="finding.name"
          class="min-w-0 wrap-anywhere"
          @click="$emit('select', finding)"
          >{{ finding.name }}</BaseLink
        >
        <span class="min-w-0 wrap-anywhere">{{ finding.message }}</span>
      </li>
    </ul>
    <p v-if="findings.length > 40" class="mt-1 text-muted">
      …and {{ findings.length - 40 }} more.
    </p>
  </BaseDrawer>
</template>
