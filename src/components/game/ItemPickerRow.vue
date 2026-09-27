<script setup lang="ts">
// The item_picker case of BuildSlot.vue's row content: the picker itself, its typed values
// (useSlotInputs.ts) and this type's diff notes (choice/bonus/value). Row chrome (label, cursor
// anchor, hover/diff highlighting, the errors list) stays in BuildSlot.vue since it's identical
// across every slot type.
import { computed, useTemplateRef } from "vue";
import ItemPicker from "./ItemPicker.vue";
import BuildInputControl from "./BuildInputControl.vue";
import InlineRepetitionStepper from "./InlineRepetitionStepper.vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseLink from "../ui/BaseLink.vue";
import IconButton from "../ui/IconButton.vue";
import { PinOff, Replace, Table, Trash } from "@lucide/vue";
import * as buildEditor from "../../stores/buildEditor";
import * as stableBrowser from "../../stores/stableBrowser";
import {
  PREFERRED_MARK,
  bonusGroupsFor,
  itemDisplay,
  stableRef,
} from "../../engine/insignia";
import { useSlotInputs } from "../../composables/useSlotInputs";
import { inputKey } from "../../lib/build-inputs";
import type { Build, Db, Item, ItemPickerSlot } from "../../types";
import type { InputDiff } from "../../composables/useCompareDiff";

const props = defineProps<{
  slotDef: ItemPickerSlot;
  build: Build;
  /** The active build's resolved db -- only needed for the picker's bonus-aware preview
   *  (ItemPicker.vue's `bonusPreview` prop below). */
  db: Db;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  /** This row's `toggleable` checkbox is unchecked: the pick stays, struck through. */
  disabled?: boolean;
  item?: Item | null;
  items?: Item[];
  /** Why each of `items` would normally be withheld, when the editor's lens is re-showing
   *  them -- passed straight to the picker. */
  hiddenReasons?: ReadonlyMap<string, string> | null;
  statSummary?: string;
  /** Forwarded to the picker: what this row reads as while it holds nothing. */
  placeholder?: string;
  invalid?: boolean;
  choiceDiffers?: boolean;
  otherChoiceLabel?: string;
  bonusDiffs?: { id: string; message: string }[];
  inputDiffs?: InputDiff[];
  /** DOM id for the picker input, so BuildSlot's row label can point at it. */
  inputId?: string;
}>();

const picker = useTemplateRef<InstanceType<typeof ItemPicker>>("picker");

/** The item this slot's pick would migrate to, or null when it has no replacement. */
const replacement = computed(() =>
  props.db.replacementFor(props.build.choices?.[props.slotDef.id]),
);

defineExpose({
  focus: () => picker.value?.focus(),
  focusAndSeed: (char: string) => picker.value?.focusAndSeed(char),
});

const choice = () => props.build.choices[props.slotDef.id] ?? "";

/** Not always the row's item: an unpinned stable bonus row is about the derived bonus, but the
 * picker holds nothing, which is what lets its placeholder name the derived bonus. */
const pickedItem = computed(() => (choice() ? props.item : null));

const inputs = useSlotInputs(
  () => props.slotDef,
  () => (props.inputDiffs ?? []).map((diff) => diff.address),
);

/** The pick's own repetition count sits beside the picker; every other value lists below. */
const repetition = computed(() =>
  inputs.value.find((input) => input.kind === "repetition"),
);
const listed = computed(() =>
  inputs.value.filter((input) => input.kind !== "repetition"),
);

function setRepetition(count: number) {
  const input = repetition.value;
  if (input) buildEditor.setInput(input.address, count, input.spec.label);
}

/** The picker's own box is a fixed width, so the star sits out here with the summary. */
const preferredPick = computed(
  () => !!props.item && itemDisplay(props.db, props.item).preferred,
);

/** A stable bonus row states what its group derives; the group is what the player edits. A
 * stored pick still shows, so a build carrying one from elsewhere keeps it until unpinned. */
const derivedBonusRow = computed(
  () => stableRef(props.db, props.slotDef.id)?.role === "bonus",
);

const insigniaGroups = computed(() =>
  bonusGroupsFor(props.db, props.build, props.slotDef.id, props.items ?? []),
);

/** The group a mount row heads, which the browse button opens onto. */
const stableGroup = computed(() => {
  const ref = stableRef(props.db, props.slotDef.id);
  return ref?.role === "mount" ? ref.group : null;
});
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <ItemPicker
      ref="picker"
      :placeholder="placeholder"
      class="grow-0 basis-80 min-w-40"
      :class="disabled && '[&_input]:text-muted [&_input]:line-through'"
      :items="items ?? []"
      :input-id="inputId"
      :model-value="choice()"
      :selected-item="pickedItem"
      :invalid="invalid"
      :db="db"
      :hidden-reasons="hiddenReasons"
      :readonly="derivedBonusRow"
      :groups="insigniaGroups"
      :bonus-preview="{ db, build, slotId: slotDef.id }"
      :hide-preview="slotDef.hidePreview"
      :allow-empty="!slotDef.disallowEmpty"
      @update:model-value="buildEditor.setChoice(slotDef.id, $event)"
    />
    <IconButton
      v-if="derivedBonusRow && choice()"
      title="Unpin and go back to this group's bonus"
      :data-testid="'unpin-bonus:' + slotDef.id"
      @click.stop="buildEditor.setChoice(slotDef.id, '')"
    >
      <PinOff />
    </IconButton>
    <IconButton
      v-if="stableGroup"
      title="Browse stable"
      :data-testid="'open-stable-browser:' + slotDef.id"
      @click.stop="
        stableBrowser.openFor(
          stableGroup,
          item ? { tab: 'mount', query: item.name } : null,
        )
      "
    >
      <Table />
    </IconButton>
    <!-- Rows of an item_picker_list are the only removable ones; a hand-authored slot has no
         `list` and so no button. -->
    <IconButton
      v-if="slotDef.list"
      :title="`Remove ${slotDef.label}`"
      :data-testid="'list-remove:' + slotDef.id"
      @click.stop="buildEditor.removeListRow(slotDef.id)"
    >
      <Trash />
    </IconButton>
    <InlineRepetitionStepper
      v-if="repetition"
      :item-id="repetition.anchor.itemId!"
      :label="repetition.spec.label"
      :value="repetition.value"
      :min="repetition.spec.min"
      :max="repetition.spec.max"
      testid-prefix="repetition"
      @change="setRepetition"
    />
    <!-- The build-wide notice, scoped to this row. -->
    <span
      v-if="replacement || pickedItem?.hideFromPicker"
      class="flex shrink-0 items-center gap-1"
      :data-testid="'slot-retired:' + slotDef.id"
    >
      <BaseBadge variant="warn">retired</BaseBadge>
      <IconButton
        v-if="replacement"
        :title="`Replace with ${replacement.name}`"
        :data-testid="'slot-retired-apply:' + slotDef.id"
        @click="buildEditor.applyRetiredItem(slotDef.id)"
        ><Replace
      /></IconButton>
    </span>
    <span
      v-if="preferredPick"
      class="shrink-0 text-accent"
      data-testid="slot-preferred"
      title="Preferred"
      >{{ PREFERRED_MARK }}</span
    >
    <span
      class="min-w-0 flex-1 truncate text-text"
      data-testid="slot-stat-summary"
      >{{ item ? statSummary : "" }}</span
    >
  </div>

  <div v-if="listed.length" class="mt-1 flex flex-col gap-1.5">
    <BuildInputControl
      v-for="input in listed"
      :key="inputKey(input.address)"
      :input="input"
    />
  </div>

  <p
    v-if="highlightDiff && choiceDiffers"
    class="slot-diff-note mt-0.5 text-muted"
  >
    {{ compareBuild?.name }}: {{ otherChoiceLabel || "(empty)" }}
    <BaseLink
      class="ml-0.5"
      @click.stop="buildEditor.applyFromCompare(slotDef.id)"
    >
      apply
    </BaseLink>
  </p>

  <template v-if="highlightDiff">
    <p
      v-for="bonusDiff in bonusDiffs ?? []"
      :key="bonusDiff.id"
      class="mt-0.5 font-semibold text-diff"
    >
      {{ bonusDiff.message }}
    </p>
  </template>

  <template v-if="highlightDiff">
    <p
      v-for="diff in inputDiffs ?? []"
      :key="inputKey(diff.address)"
      class="slot-diff-note mt-0.5 text-muted"
    >
      {{ compareBuild?.name }}: {{ diff.label }} {{ diff.otherLabel }}
      <BaseLink
        class="ml-0.5"
        @click.stop="buildEditor.applyInputFromCompare(diff.address)"
      >
        apply
      </BaseLink>
    </p>
  </template>
</template>
