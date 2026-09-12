<script setup lang="ts">
// How one attached bonus counts on the item being edited. Plain state: no config, one line
// with a "Customize" link. Full state: Fixed/Toggle/Range modes over the `OccurrenceDraft`,
// a "Use ×1" link back to plain, and for the player-input modes a preview of the build
// editor's control. `editing` keeps the full state up while the draft is null, since writes
// normalize a "×1" draft to null and the fields must not vanish mid-edit. `mode` is local
// state seeded from the draft, not derived: a Range being typed passes through shapes that
// read as Fixed, and the watcher re-seeds it only when an outside draft no longer fits.
import { computed, shallowRef, watch } from "vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BaseInput from "../ui/BaseInput.vue";
import BaseLink from "../ui/BaseLink.vue";
import FormField from "../ui/FormField.vue";
import FormGrid from "../ui/FormGrid.vue";
import SegmentedControl from "../ui/SegmentedControl.vue";
import BonusOccurrenceInputs from "./BonusOccurrenceInputs.vue";
import type { OccurrenceDraft } from "../../lib/item-draft";
import {
  OCCURRENCE_MODES,
  PLAIN_OCCURRENCE,
  occurrenceDefaultOn,
  occurrenceDraftForMode,
  occurrenceModeOf,
  occurrenceModeSpec,
  occurrenceNumber,
  withOccurrenceDefaultOn,
  withOccurrenceLabel,
  type OccurrenceMode,
} from "../../lib/occurrence-mode";
import type { OccurrenceRow } from "../../composables/useItemBonusOccurrences";

const props = defineProps<{
  /** The attachment's config; null for a plain-id attachment (always 1 occurrence). */
  occurrence: OccurrenceDraft | null;
  bonusId: string;
  /** The bonus's own name, what the player sees when the attachment sets no label. */
  bonusName: string;
}>();

const emit = defineEmits<{
  "update:occurrence": [occurrence: OccurrenceDraft | null];
}>();

const editing = shallowRef(false);
const full = computed(() => props.occurrence !== null || editing.value);

const mode = shallowRef<OccurrenceMode>(occurrenceModeOf(props.occurrence));

watch(
  () => props.occurrence,
  (occurrence) => {
    if (!occurrenceModeSpec(mode.value).fits(occurrence))
      mode.value = occurrenceModeOf(occurrence);
  },
);

const spec = computed(() => occurrenceModeSpec(mode.value));

const modeOptions = OCCURRENCE_MODES.map((entry) => ({
  value: entry.value,
  label: entry.label,
  testid: `occurrence-mode-${entry.value}`,
}));

/** Every field write keeps the full state up, even when it normalized the draft to null. */
function update(occurrence: OccurrenceDraft | null) {
  editing.value = true;
  emit("update:occurrence", occurrence);
}

function setMode(next: OccurrenceMode) {
  mode.value = next;
  update(occurrenceDraftForMode(props.occurrence, next));
}

function customize() {
  editing.value = true;
}

function reset() {
  editing.value = false;
  emit("update:occurrence", null);
}

/** The label the player sees: the attachment's override, else the bonus's own name, the
 *  same fallback useItemBonusOccurrences.ts applies in the build editor. */
const playerLabel = computed(
  () => props.occurrence?.label.trim() || props.bonusName || props.bonusId,
);

/** The build-editor row this attachment would produce; null in Fixed, which has no control. */
const previewRow = computed<OccurrenceRow | null>(() => {
  if (mode.value === "fixed") return null;
  const draft = props.occurrence ?? PLAIN_OCCURRENCE;
  const min = occurrenceNumber(draft.min) ?? 0;
  const max = occurrenceNumber(draft.max) ?? 0;
  const defaultValue = occurrenceNumber(draft.default) ?? min;
  return {
    bonusId: props.bonusId,
    label: playerLabel.value,
    value: defaultValue,
    min,
    max,
    defaultValue,
    kind: mode.value === "toggle" ? "checkbox" : "stepper",
  };
});
</script>

<template>
  <!-- Ruled off below: the attachment's settings end here and the bonus's own definition
       follows. -->
  <div data-testid="occurrence-section" class="border-b border-line pb-2">
    <template v-if="full">
      <FormGrid>
        <FormField label="Occurrences">
          <SegmentedControl
            data-testid="occurrence-mode"
            :model-value="mode"
            :options="modeOptions"
            @update:model-value="setMode"
          />
        </FormField>
        <FormField
          v-for="field in spec.numberFields"
          :key="field.key"
          :label="field.label"
        >
          <BaseInput
            class="w-16"
            type="number"
            min="0"
            :data-testid="`occurrence-${field.key}-input`"
            :model-value="field.read(occurrence) ?? ''"
            @update:model-value="update(field.write(occurrence, $event))"
          />
        </FormField>
        <FormField v-if="spec.hasDefaultToggle" label="&nbsp;">
          <BaseCheckbox
            data-testid="occurrence-default-toggle"
            :model-value="occurrenceDefaultOn(occurrence)"
            @update:model-value="
              update(withOccurrenceDefaultOn(occurrence, $event as boolean))
            "
            >On by default</BaseCheckbox
          >
        </FormField>
        <FormField v-if="spec.hasLabel" label="Label">
          <BaseInput
            class="w-40"
            type="text"
            data-testid="occurrence-label-input"
            :placeholder="bonusName"
            :model-value="occurrence?.label ?? ''"
            @update:model-value="
              update(withOccurrenceLabel(occurrence, String($event ?? '')))
            "
          />
        </FormField>
        <FormField label="&nbsp;">
          <BaseLink data-testid="occurrence-reset" @click="reset"
            >Use ×1</BaseLink
          >
        </FormField>
      </FormGrid>

      <!-- The preview is the real build-editor control, made inert: it shows exactly what
           the player gets without taking input. -->
      <div
        v-if="previewRow"
        class="mt-3 flex flex-wrap items-center gap-2 text-muted"
      >
        <span>Preview:</span>
        <div
          inert
          class="flex flex-wrap items-center gap-2 outline outline-line p-2"
          data-testid="occurrence-preview"
        >
          <BonusOccurrenceInputs
            :rows="[previewRow]"
            testid-prefix="occurrence-preview"
          />
        </div>
      </div>
    </template>
    <p v-else class="text-muted" data-testid="occurrence-plain">
      Counts ×1 on this item ·
      <BaseLink data-testid="occurrence-customize" @click="customize"
        >Customize</BaseLink
      >
    </p>
  </div>
</template>
