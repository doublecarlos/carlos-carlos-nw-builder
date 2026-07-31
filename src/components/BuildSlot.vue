<script setup lang="ts">
// One row inside a BuildSection: an item_picker slot (today's picker + stat summary + typed
// dynamicStat mod), or a build_parameter slot (a generic control over BuildParamInput). Row
// chrome (hover/cursor/diff highlighting, the click-to-cursor/ctrl-click-to-edit behaviour) is
// identical either way -- only the content between the label and the diff notes differs.
//
// Purely presentational for anything that needs cross-row coordination (hover card, keyboard
// cursor) -- those stay owned by BuildEditor.vue/BuildSection.vue and arrive as props/emits.
// Its own single-slot mutations (choice, typed value, param, revert, apply-from-compare) go
// straight to the buildEditor store, same as every other component that edits build content.
import ItemPicker from "./ItemPicker.vue";
import BuildParamInput from "./ui/BuildParamInput.vue";
import IconButton from "./ui/IconButton.vue";
import BaseButton from "./ui/BaseButton.vue";
import UnsavedDot from "./ui/UnsavedDot.vue";
import * as buildEditor from "../stores/buildEditor";
import { getPath } from "../build-path";
import { label as statLabel } from "../format";
import type { ComponentPublicInstance } from "vue";
import type {
  Slot,
  Item,
  EngineError,
  Build,
  BuildParameterSlot,
} from "../types";

const props = defineProps<{
  slotDef: Slot;
  build: Build;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  isHovered: boolean;
  isCursor: boolean;
  unsaved: boolean;
  // item_picker only
  item?: Item | null;
  items?: Item[];
  errors?: EngineError[];
  statSummary?: string;
  choiceDiffers?: boolean;
  otherChoiceLabel?: string;
  bonusDiffs?: { id: string; message: string }[];
  valueDiffers?: boolean;
  otherValue?: number | null;
  // build_parameter only
  paramDiffers?: boolean;
  otherParamLabel?: string;
}>();

const emit = defineEmits<{
  enter: [event: MouseEvent];
  leave: [];
  rowclick: [event: MouseEvent];
  pickerRef: [el: Element | ComponentPublicInstance | null];
  paramRef: [el: Element | ComponentPublicInstance | null];
}>();

const choice = () => props.build.choices[props.slotDef.id] ?? "";
const value = () => props.build.values[props.slotDef.id];
const paramValue = () =>
  getPath(props.build.context, (props.slotDef as BuildParameterSlot).path) as
    string | number | boolean | undefined;
</script>

<template>
  <div
    class="flex items-baseline gap-2.5 border-b border-line/45 py-1 last:border-b-0"
    tabindex="-1"
    :class="[
      isHovered && 'is-hovered bg-accent-soft/40',
      isCursor && 'is-cursor outline-2 -outline-offset-1 outline-accent',
      highlightDiff &&
        (choiceDiffers ||
          valueDiffers ||
          paramDiffers ||
          (bonusDiffs?.length ?? 0) > 0) &&
        'is-diff bg-diff/20',
    ]"
    :data-cursor-key="'slot:' + slotDef.id"
    :data-slot-kind="slotDef.type"
    @mouseenter="emit('enter', $event)"
    @mouseleave="emit('leave')"
    @click="emit('rowclick', $event)"
  >
    <div class="flex w-36 shrink-0 items-center justify-between min-w-0">
      <label
        class="slot-label min-w-0 flex-1 truncate text-muted"
        :for="slotDef.id"
        >{{ slotDef.label }}</label
      >
      <span v-if="unsaved" class="flex flex-none items-center gap-0.5">
        <UnsavedDot title="Unsaved change" />
        <IconButton
          icon="undo-2"
          title="Revert to saved"
          @click="buildEditor.revertSlot(slotDef.id)"
        />
      </span>
    </div>

    <div class="min-w-0 flex-1">
      <template v-if="slotDef.type === 'item_picker'">
        <div class="flex flex-wrap items-center gap-2.5">
          <ItemPicker
            :ref="
              (el) =>
                emit(
                  'pickerRef',
                  el as Element | ComponentPublicInstance | null,
                )
            "
            class="grow-0 basis-80 min-w-40"
            :items="items ?? []"
            :model-value="choice()"
            :selected-item="item"
            :invalid="(errors?.length ?? 0) > 0"
            @update:model-value="buildEditor.setChoice(slotDef.id, $event)"
          />
          <span v-if="item" class="min-w-0 flex-1 truncate text-sm text-text">{{
            statSummary
          }}</span>
        </div>

        <p
          v-if="highlightDiff && choiceDiffers"
          class="slot-diff-note mt-0.5 text-sm text-muted"
        >
          {{ compareBuild?.name }}: {{ otherChoiceLabel || "(empty)" }}
          <BaseButton
            variant="link"
            class="ml-0.5 text-accent"
            @click.stop="buildEditor.applyFromCompare(slotDef.id)"
          >
            apply
          </BaseButton>
        </p>

        <template v-if="highlightDiff">
          <p
            v-for="bonusDiff in bonusDiffs ?? []"
            :key="bonusDiff.id"
            class="mt-0.5 text-sm font-semibold text-diff"
          >
            {{ bonusDiff.message }}
          </p>
        </template>

        <!-- Dynamic weapon modifications carry a user-typed magnitude. Driven by the item's own
             `dynamicStat`, not by a hard-coded slot id, so a second one would work with no UI
             change -- item-local params (later phase) generalize this further. -->
        <div v-if="item?.dynamicStat" class="mt-1 flex items-center gap-1.5">
          <input
            type="number"
            class="w-20 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
            :min="item?.dynamicMin"
            :max="item?.dynamicMax"
            :value="value() ?? ''"
            :placeholder="String(item?.dynamicMin ?? '')"
            @input="
              buildEditor.setValue(
                slotDef.id,
                ($event.target as HTMLInputElement).value,
              )
            "
          />
          <span class="text-sm text-muted">
            {{ statLabel(item?.dynamicStat as string) }}
            {{ item?.dynamicMin }}–{{ item?.dynamicMax }}
          </span>
        </div>

        <p
          v-if="highlightDiff && valueDiffers"
          class="slot-diff-note mt-0.5 text-sm text-muted"
        >
          {{ compareBuild?.name }}: {{ otherValue ?? "(none)" }}
          <BaseButton
            variant="link"
            class="ml-0.5 text-accent"
            @click.stop="buildEditor.applyValueFromCompare(slotDef.id)"
          >
            apply
          </BaseButton>
        </p>

        <p
          v-for="error in errors ?? []"
          :key="error.kind + error.choice"
          class="mt-0.5 text-sm text-danger"
        >
          {{ error.message }}
        </p>
      </template>

      <template v-else>
        <!-- No label in the slot content -- `.slot-label` on the left already shows it, unlike
             QuickOptions.vue's compact strip which has no separate label column. -->
        <BuildParamInput
          :ref="(el) => emit('paramRef', el)"
          :slot-def="slotDef"
          :wide="true"
          :model-value="paramValue()"
          @update:model-value="buildEditor.setParam(slotDef, $event!)"
        />

        <p
          v-if="highlightDiff && paramDiffers"
          class="slot-diff-note mt-0.5 text-sm text-muted"
        >
          {{ compareBuild?.name }}: {{ otherParamLabel }}
          <BaseButton
            variant="link"
            class="ml-0.5 text-accent"
            @click.stop="buildEditor.applyParamFromCompare(slotDef)"
          >
            apply
          </BaseButton>
        </p>
      </template>
    </div>
  </div>
</template>
