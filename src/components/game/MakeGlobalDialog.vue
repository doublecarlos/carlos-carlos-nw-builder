<script setup lang="ts">
// Confirms "Make global" on a bonus input, and picks the other bonuses defining an input of
// the same name and type that should read the new global input too. Builds keep their
// values: each converted bonus keeps the input's name, which is how a stored value finds its
// new address.
//
// A converted bonus defined outside this layer is copied into it. One a higher enabled layer
// overrides is shown but cannot be ticked, as the copy here would have no effect.
import { ref } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseModal from "../ui/BaseModal.vue";
import type { MakeGlobalCandidate } from "../../lib/bonus-draft";

const props = defineProps<{
  /** The input's id. */
  name: string;
  /** Bonuses offered for converting along, unticked to start with. */
  others: MakeGlobalCandidate[];
}>();

const emit = defineEmits<{
  confirm: [otherIds: string[]];
  close: [];
}>();

const ticked = ref<string[]>([]);

function submit() {
  // In offer order, whatever order they were ticked in.
  emit(
    "confirm",
    props.others
      .map((other) => other.bonus.id)
      .filter((id) => ticked.value.includes(id)),
  );
  emit("close");
}
</script>

<template>
  <BaseModal
    :title="`Make “${name}” global`"
    panel-class="max-h-[80vh] w-[28rem] max-w-[92vw]"
    phone="card"
    data-testid="make-global"
    @close="emit('close')"
  >
    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <p class="mb-2 text-muted">
        Moves this input to a new global input in the Global inputs section, in
        this layer. Builds keep the value they hold. A bonus from another layer
        or the shipped catalog is copied into this layer to convert it.
      </p>
      <template v-if="others.length">
        <p class="mb-1">Other bonuses with an input “{{ name }}” to convert:</p>
        <div
          v-for="other in others"
          :key="other.bonus.id"
          class="flex items-baseline gap-2 py-0.5"
          data-testid="make-global-other"
        >
          <BaseCheckbox
            v-model="ticked"
            :value="other.bonus.id"
            :disabled="other.shadowedBy !== undefined"
            :inline="other.shadowedBy !== undefined"
            >{{ other.bonus.name || other.bonus.id }}</BaseCheckbox
          >
          <span
            v-if="other.shadowedBy !== undefined"
            class="text-xs text-muted"
            data-testid="make-global-shadowed"
            >overridden by “{{ other.shadowedBy }}”</span
          >
          <span
            v-else-if="other.copied"
            class="text-xs text-muted"
            data-testid="make-global-copied"
            >copied into this layer</span
          >
        </div>
      </template>
      <p v-else class="text-muted" data-testid="make-global-none">
        No other bonus has an input “{{ name }}” of this type.
      </p>
    </div>
    <div
      class="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3"
    >
      <BaseButton data-testid="make-global-cancel" @click="emit('close')"
        >Cancel</BaseButton
      >
      <BaseButton
        variant="primary"
        data-testid="make-global-submit"
        @click="submit"
        >Make global</BaseButton
      >
    </div>
  </BaseModal>
</template>
