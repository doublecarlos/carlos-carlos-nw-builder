<script setup lang="ts">
// One row inside a BuildSection: an item_picker slot (today's picker + stat summary + typed
// dynamicStat mod), a point_assignment slot (a row of numeric steppers, one per item), or a
// build_parameter slot (a generic control over BuildParamInput). Row chrome (hover/diff
// highlighting, the click-to-cursor/ctrl-click-to-edit behaviour) is identical across all
// three -- only the content between the label and the diff notes differs.
//
// Keyboard cursor: there is no virtual cursor -- real focus IS the cursor. Each row carries an
// invisible, tabindex="-1" cursor anchor right after its input controller; the row highlights
// while the anchor or the input has focus (`focus-within:` classes), and onKeyStroke listeners
// scoped to the anchor own Enter/type-ahead/Backspace for this row. Only arrow navigation is
// cross-row, and it arrives as the `onArrow` prop from BuildEditor.
//
// Purely presentational for anything that needs cross-row coordination (hover card) -- those
// stay owned by BuildEditor.vue and arrive as props/emits. Its own single-slot mutations
// (choice, typed value, param, assignment, revert, apply-from-compare) go straight to the
// buildEditor store, same as every other component that edits build content.
import ItemPicker from "./ItemPicker.vue";
import BuildParamInput from "./BuildParamInput.vue";
import PointAssignmentInput from "./PointAssignmentInput.vue";
import BaseButton from "../ui/BaseButton.vue";
import * as buildEditor from "../../stores/buildEditor";
import { getPath } from "../../lib/build-path";
import { label as statLabel } from "../../lib/format";
import { isFormControl } from "../../composables/focus";
import { useCursorRowKeys } from "../../composables/useCursorRowKeys";
import { computed, useTemplateRef } from "vue";
import type {
  Slot,
  Item,
  EngineError,
  Build,
  BuildParameterSlot,
  PointAssignmentSlot,
} from "../../types";

/** The slice of ItemPicker/BuildParamInput/PointAssignmentInput's public surface the cursor
 *  anchor needs -- a structural type so the anchor doesn't care which component fills the row. */
interface CursorControl {
  focus: () => void;
  focusAndSeed: (char: string) => void;
}

const props = defineProps<{
  slotDef: Slot;
  build: Build;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  isHovered: boolean;
  /** Arrow keys on this row's cursor anchor: BuildEditor moves focus to the next/previous row. */
  onArrow: (dir: 1 | -1) => void;
  // item_picker only
  item?: Item | null;
  items?: Item[];
  statSummary?: string;
  choiceDiffers?: boolean;
  otherChoiceLabel?: string;
  bonusDiffs?: { id: string; message: string }[];
  valueDiffers?: boolean;
  otherValue?: number | null;
  // item_picker and point_assignment
  errors?: EngineError[];
  // build_parameter only
  paramDiffers?: boolean;
  otherParamLabel?: string;
  // point_assignment only
  assignmentDiffers?: boolean;
  otherAssignmentLabel?: string;
}>();

const emit = defineEmits<{
  /** `itemId` is set only for a point_assignment row's per-item hover target
   *  (PointAssignmentInput.vue's own `item-enter`), forwarded straight through. */
  enter: [event: MouseEvent, itemId?: string];
  leave: [];
  rowclick: [event: MouseEvent];
}>();

const anchor = useTemplateRef("anchor");
const picker = useTemplateRef<InstanceType<typeof ItemPicker>>("picker");
const param = useTemplateRef<InstanceType<typeof BuildParamInput>>("param");
const assignment =
  useTemplateRef<InstanceType<typeof PointAssignmentInput>>("assignment");

const control = computed<CursorControl | null>(() => {
  if (props.slotDef.type === "item_picker") return picker.value ?? null;
  if (props.slotDef.type === "point_assignment")
    return assignment.value ?? null;
  return param.value ?? null;
});

const choice = () => props.build.choices[props.slotDef.id] ?? "";
const value = () => props.build.values[props.slotDef.id];
const paramValue = () =>
  getPath(props.build.context, (props.slotDef as BuildParameterSlot).path) as
    string | number | boolean | undefined;
const assignmentValues = () => props.build.assignments[props.slotDef.id] ?? {};

/**
 * A plain click parks the cursor on this row: focus its anchor, unless the click landed on a
 * real control (the input focuses itself then). Clicks on picker menu rows bubble here too --
 * they carry the "choose this item" mousedown but by click-time the input has already blurred,
 * so parking the anchor is exactly what the old virtual cursor did on that path.
 */
function onRowClick(event: MouseEvent) {
  if (!isFormControl(event.target as Element | null)) anchor.value?.focus();
  emit("rowclick", event);
}

useCursorRowKeys(anchor, {
  // Wrappers read props at call time so they stay current across re-renders.
  onArrow: (dir) => props.onArrow(dir),
  onEnter: () => control.value?.focus(),
  onClear: () => {
    if (props.slotDef.type === "item_picker") {
      buildEditor.setChoice(props.slotDef.id, "");
    } else if (props.slotDef.type === "point_assignment") {
      buildEditor.resetAssignmentsToDefault(
        props.slotDef as PointAssignmentSlot,
      );
    } else {
      buildEditor.resetParamToDefault(props.slotDef as BuildParameterSlot);
    }
  },
  onSeed: (char) => control.value?.focusAndSeed(char),
});
</script>

<template>
  <div
    class="relative flex justify-center gap-2.5 border-b border-line/45 py-1 last:border-b-0 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent"
    :class="[
      isHovered && 'is-hovered bg-accent-soft/40',
      highlightDiff &&
        (choiceDiffers ||
          valueDiffers ||
          paramDiffers ||
          assignmentDiffers ||
          (bonusDiffs?.length ?? 0) > 0) &&
        'is-diff bg-diff/20',
    ]"
    :data-cursor-key="'slot:' + slotDef.id"
    @mouseenter="emit('enter', $event)"
    @mouseleave="emit('leave')"
    @click="onRowClick"
  >
    <div class="flex w-36 shrink-0 items-center justify-between min-w-0">
      <label
        class="slot-label min-w-0 flex-1 truncate text-muted"
        :for="slotDef.id"
        >{{ slotDef.label }}</label
      >
    </div>

    <div class="min-w-0 flex-1">
      <!-- The keyboard cursor anchor, point_assignment case: placed before the row's controls
           here specifically, since a point_assignment row has several real tab stops (a
           -/+/input trio per item) instead of one -- a parked cursor's Tab should step into
           the row's own first control, not skip straight past every stepper to the next row's.
           See the shared anchor comment below for what the anchor itself is. -->
      <span
        v-if="slotDef.type === 'point_assignment'"
        ref="anchor"
        tabindex="-1"
        data-cursor-anchor
        class="sr-only"
      />

      <!-- Shared flex container so ItemPicker and BuildParamInput (via ComboBox)
           get the same grow-0 basis-80 min-w-40 sizing -- consistent row width
           regardless of slot type. -->
      <div class="flex flex-wrap items-center gap-2.5">
        <ItemPicker
          v-if="slotDef.type === 'item_picker'"
          ref="picker"
          class="grow-0 basis-80 min-w-40"
          :items="items ?? []"
          :model-value="choice()"
          :selected-item="item"
          :invalid="(errors?.length ?? 0) > 0"
          @update:model-value="buildEditor.setChoice(slotDef.id, $event)"
        />
        <PointAssignmentInput
          v-else-if="slotDef.type === 'point_assignment'"
          ref="assignment"
          :slot-def="slotDef"
          :values="assignmentValues()"
          @change="
            (itemId, count) =>
              buildEditor.setAssignment(
                slotDef as PointAssignmentSlot,
                itemId,
                count,
              )
          "
          @item-enter="(event, itemId) => emit('enter', event, itemId)"
          @item-leave="emit('leave')"
        />
        <BuildParamInput
          v-else
          ref="param"
          class="grow-0 basis-80 min-w-40"
          :slot-def="slotDef"
          :wide="true"
          :model-value="paramValue()"
          @update:model-value="buildEditor.setParam(slotDef, $event!)"
        />
        <span
          v-if="slotDef.type === 'item_picker' && item"
          class="min-w-0 flex-1 truncate text-sm text-text"
          >{{ statSummary }}</span
        >
      </div>

      <!-- The keyboard cursor anchor: invisible, out of the tab order, but focusable. Focus
           here (or on the input below) lights the row's focus-within outline; keydowns land
           here when the row "has the cursor". The row div above is `relative` on purpose:
           sr-only is `position: absolute`, so without a positioned ancestor the anchor's
           containing block would be the document and its static position at the end of the
           last row would extend the page's scrollable area.

           Every slot type but point_assignment keeps the anchor here, after its one control --
           see the point_assignment case above. -->
      <span
        v-if="slotDef.type !== 'point_assignment'"
        ref="anchor"
        tabindex="-1"
        data-cursor-anchor
        class="sr-only"
      />

      <template v-if="slotDef.type === 'item_picker'">
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
      </template>

      <p
        v-if="
          slotDef.type === 'point_assignment' &&
          highlightDiff &&
          assignmentDiffers
        "
        class="slot-diff-note mt-0.5 text-sm text-muted"
      >
        {{ compareBuild?.name }}: {{ otherAssignmentLabel }}
        <BaseButton
          variant="link"
          class="ml-0.5 text-accent"
          @click.stop="
            buildEditor.applyAssignmentsFromCompare(
              slotDef as PointAssignmentSlot,
            )
          "
        >
          apply
        </BaseButton>
      </p>

      <p
        v-if="
          slotDef.type === 'build_parameter' && highlightDiff && paramDiffers
        "
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

      <!-- item_picker and point_assignment are the only kinds `errors` is ever populated for
           (engine.ts's findErrors) -- an empty list on build_parameter just renders nothing. -->
      <p
        v-for="error in errors ?? []"
        :key="error.kind + error.choice"
        class="mt-0.5 text-sm text-danger"
      >
        {{ error.message }}
      </p>
    </div>
  </div>
</template>
