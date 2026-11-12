<script setup lang="ts">
// Confirms "Make global" on a bonus input, and picks the other bonuses defining an input of
// the same name and type that should read the new global input too. Builds keep their
// values: each converted bonus keeps the input's name, which is how a stored value finds its
// new address.
//
// A converted bonus defined outside this layer is copied into it. One a higher enabled layer
// overrides is shown but cannot be ticked, as the copy here would have no effect.
//
// The new global input's id starts as the default and can be edited, so an author can place
// it under the naming convention. A typed id that is taken is reported, never renamed.
import { computed, ref } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import BaseModal from "../ui/BaseModal.vue";
import FormField from "../ui/FormField.vue";
import type { MakeGlobalCandidate } from "../../lib/bonus-draft";
import {
  defaultGlobalId,
  globalIdError,
  type TakenGlobalIds,
} from "../../lib/make-global";
import type { InputDef } from "../../types";

const props = defineProps<{
  /** The input's id. */
  name: string;
  def: InputDef;
  /** Bonuses offered for converting along, unticked to start with. */
  others: MakeGlobalCandidate[];
  taken: TakenGlobalIds;
}>();

const emit = defineEmits<{
  confirm: [id: string, otherIds: string[]];
  close: [];
}>();

const ticked = ref<string[]>([]);
const id = ref(defaultGlobalId(props.name, props.def, props.taken));
const idError = computed(() => globalIdError(id.value.trim(), props.taken));

function submit() {
  if (idError.value !== null) return;
  // In offer order, whatever order they were ticked in.
  emit(
    "confirm",
    id.value.trim(),
    props.others
      .map((other) => other.bonus.id)
      .filter((otherId) => ticked.value.includes(otherId)),
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
      <FormField label="Global input id" class="mb-3">
        <BaseInput
          v-model="id"
          class="w-full font-mono"
          :aria-invalid="idError !== null"
          data-testid="make-global-id"
        />
        <p
          v-if="idError !== null"
          class="text-danger"
          data-testid="make-global-id-error"
        >
          {{ idError }}
        </p>
      </FormField>
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
        :disabled="idError !== null"
        @click="submit"
        >Make global</BaseButton
      >
    </div>
  </BaseModal>
</template>
