<script setup lang="ts">
// Renders whatever `stores/confirm` has pending. App.vue mounts exactly one.
// The go-ahead button takes focus on open so Delete then Enter completes a keyboard delete.
import { nextTick, ref, useTemplateRef, watch } from "vue";
import { TriangleAlert } from "@lucide/vue";
import BaseModal from "./ui/BaseModal.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import * as confirm from "../stores/confirm";

const pending = confirm.pending;
const checked = ref(false);
const accept = useTemplateRef<InstanceType<typeof BaseButton>>("accept");

watch(pending, async (request) => {
  if (!request) return;
  checked.value = request.checkbox?.checked ?? false;
  await nextTick();
  (accept.value?.$el as HTMLElement | undefined)?.focus();
});
</script>

<template>
  <BaseModal
    v-if="pending"
    :title="pending.title"
    panel-class="w-[26rem] max-w-[92vw]"
    data-testid="confirm-dialog"
    @close="confirm.settle(false)"
  >
    <div class="flex flex-col gap-3 px-4 py-4">
      <div class="flex items-start gap-2">
        <TriangleAlert
          v-if="pending.danger"
          class="mt-0.5 size-4 flex-none text-danger"
        />
        <p data-testid="confirm-message">{{ pending.message }}</p>
      </div>

      <BaseCheckbox
        v-if="pending.checkbox"
        v-model="checked"
        data-testid="confirm-checkbox"
        >{{ pending.checkbox.label }}</BaseCheckbox
      >

      <p v-if="pending.note" class="text-xs text-muted">{{ pending.note }}</p>
    </div>

    <div
      class="flex flex-none items-center gap-2 border-t border-line px-4 py-3"
    >
      <span class="text-xs text-muted">Hold Shift to skip this dialog.</span>
      <BaseButton
        class="ml-auto"
        data-testid="confirm-cancel"
        @click="confirm.settle(false)"
        >Cancel</BaseButton
      >
      <BaseButton
        ref="accept"
        variant="primary"
        :danger="pending.danger"
        data-testid="confirm-accept"
        @click="confirm.settle(true, checked)"
        >{{ pending.confirmLabel }}</BaseButton
      >
    </div>
  </BaseModal>
</template>
