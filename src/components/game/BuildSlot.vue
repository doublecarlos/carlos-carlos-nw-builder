<script setup lang="ts">
// One row inside a BuildSection: an item_picker slot (today's picker + stat summary + typed
// dynamicStat mod), a point_assignment slot (a row of numeric steppers, one per item), or a
// build_parameter slot (a generic control over BuildParamInput). Row chrome (hover/diff
// highlighting, the click-to-cursor/ctrl-click-to-edit behaviour, the cursor anchor, the
// errors list) is identical across all three and lives here; each type's own control + diff
// note pairing lives in its own row component (ItemPickerRow/PointAssignmentRow/
// BuildParameterRow), picked below by `slotDef.type`.
//
// Keyboard cursor: there is no virtual cursor -- real focus IS the cursor. Each row carries an
// invisible, tabindex="-1" cursor anchor right after its input controller; the row highlights
// while the anchor or the input has focus (`focus-within:` classes), and onKeyStroke listeners
// scoped to the anchor own Enter/type-ahead/Backspace for this row. Only arrow navigation is
// cross-row, and it arrives as the `onArrow` prop from BuildEditor.
//
// Purely presentational for anything that needs cross-row coordination (hover card) -- those
// stay owned by BuildEditor.vue and arrive as props/emits.
import ItemPickerRow from "./ItemPickerRow.vue";
import BuildParameterRow from "./BuildParameterRow.vue";
import PointAssignmentRow from "./PointAssignmentRow.vue";
import * as buildEditor from "../../stores/buildEditor";
import { isFormControl } from "../../composables/focus";
import { useCursorRowKeys } from "../../composables/useCursorRowKeys";
import { useTemplateRef } from "vue";
import type {
  RowSlot,
  Item,
  EngineError,
  Build,
  Db,
  BuildParameterSlot,
  PointAssignmentSlot,
} from "../../types";

const props = defineProps<{
  slotDef: RowSlot;
  build: Build;
  /** Passed straight through to ItemPickerRow for its picker's bonus-aware preview. */
  db: Db;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  isHovered: boolean;
  /** Arrow keys on this row's cursor anchor: BuildEditor moves focus to the next/previous row. */
  onArrow: (dir: 1 | -1) => void;
  // item_picker and build_parameter (a build_parameter row's item is its resolved
  // `linkedItem`, if it has one -- see build-path.ts's `resolveLinkedItem`)
  item?: Item | null;
  statSummary?: string;
  bonusDiffs?: { id: string; message: string }[];
  // item_picker only
  items?: Item[];
  choiceDiffers?: boolean;
  otherChoiceLabel?: string;
  valueDiffers?: boolean;
  otherValue?: number | null;
  occurrenceDiffers?: boolean;
  otherOccurrenceLabel?: string;
  // item_picker, point_assignment and build_parameter (when it has a linked item)
  errors?: EngineError[];
  // build_parameter only
  paramDiffers?: boolean;
  otherParamLabel?: string;
  // point_assignment only
  assignmentDiffers?: boolean;
  otherAssignmentLabel?: string;
  /** True for the row immediately above a separator -- its own bottom border would otherwise
   *  double up against the separator's, so BuildEditor.vue suppresses it for that one row. */
  noBorder?: boolean;
}>();

const emit = defineEmits<{
  /** `itemId` is set only for a point_assignment row's per-item hover target
   *  (PointAssignmentInput.vue's own `item-enter`), forwarded straight through. */
  enter: [event: MouseEvent, itemId?: string];
  leave: [];
  rowclick: [event: MouseEvent, itemId?: string];
  /** This row's "new item" shortcut (ItemPickerRow/PointAssignmentRow's own `add-item`),
   *  carrying the slot's own `filter` so the item editor opens pre-filtered to it. */
  addItem: [filter: string];
}>();

const anchor = useTemplateRef("anchor");
/** The active row component -- only one of ItemPickerRow/PointAssignmentRow/BuildParameterRow
 *  is ever rendered at a time, so they can share this one ref name. Each exposes the same
 *  `{ focus, focusAndSeed }` surface regardless of which fills the row. */
const control = useTemplateRef<{
  focus: () => void;
  focusAndSeed: (char: string) => void;
}>("control");

/**
 * A plain click parks the cursor on this row: focus its anchor, unless the click landed on a
 * real control (the input focuses itself then). Clicks on picker menu rows bubble here too --
 * they carry the "choose this item" mousedown but by click-time the input has already blurred,
 * so parking the anchor is exactly what the old virtual cursor did on that path.
 *
 * A point_assignment row has no single item (item_picker/build_parameter rows do, via
 * BuildEditor's `itemIn`), so ctrl-click-to-edit needs to know *which* of its stepper items was
 * clicked -- PointAssignmentInput.vue tags each item's label with `data-item-id` for that.
 */
function onRowClick(event: MouseEvent) {
  if (!isFormControl(event.target as Element | null)) anchor.value?.focus();
  const itemId = (event.target as Element | null)?.closest<HTMLElement>(
    "[data-item-id]",
  )?.dataset.itemId;
  emit("rowclick", event, itemId);
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
    class="relative flex justify-center gap-2.5 px-2.5 py-1 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent"
    :class="[
      noBorder ? 'border-b-0' : 'border-b border-line/45 last:border-b-0',
      isHovered && 'is-hovered bg-accent-soft/40',
      highlightDiff &&
        (choiceDiffers ||
          valueDiffers ||
          occurrenceDiffers ||
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
    <div class="flex w-40 shrink-0 items-center justify-between min-w-0">
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

      <ItemPickerRow
        v-if="slotDef.type === 'item_picker'"
        ref="control"
        :slot-def="slotDef"
        :build="build"
        :db="db"
        :compare-build="compareBuild"
        :highlight-diff="highlightDiff"
        :item="item"
        :items="items"
        :stat-summary="statSummary"
        :invalid="errors?.some((e) => e.severity !== 'warning') ?? false"
        :choice-differs="choiceDiffers"
        :other-choice-label="otherChoiceLabel"
        :bonus-diffs="bonusDiffs"
        :value-differs="valueDiffers"
        :other-value="otherValue"
        :occurrence-differs="occurrenceDiffers"
        :other-occurrence-label="otherOccurrenceLabel"
        @add-item="emit('addItem', slotDef.filter)"
      />
      <PointAssignmentRow
        v-else-if="slotDef.type === 'point_assignment'"
        ref="control"
        :slot-def="slotDef"
        :build="build"
        :compare-build="compareBuild"
        :highlight-diff="highlightDiff"
        :assignment-differs="assignmentDiffers"
        :other-assignment-label="otherAssignmentLabel"
        @item-enter="(event, itemId) => emit('enter', event, itemId)"
        @item-leave="emit('leave')"
        @add-item="emit('addItem', slotDef.filter)"
      />
      <BuildParameterRow
        v-else
        ref="control"
        :slot-def="slotDef"
        :build="build"
        :compare-build="compareBuild"
        :highlight-diff="highlightDiff"
        :item="item"
        :stat-summary="statSummary"
        :bonus-diffs="bonusDiffs"
        :param-differs="paramDiffers"
        :other-param-label="otherParamLabel"
      />

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

      <!-- `errors` (engine.ts's findErrors) is populated for item_picker and point_assignment
           rows, and for a build_parameter row only when its linked item itself has a problem
           (class restriction, maxCopies) -- an empty list otherwise just renders nothing. -->
      <p
        v-for="error in errors ?? []"
        :key="error.kind + error.choice"
        class="mt-0.5 text-sm"
        :class="error.severity === 'warning' ? 'text-warn' : 'text-danger'"
      >
        {{ error.message }}
      </p>
    </div>
  </div>
</template>
