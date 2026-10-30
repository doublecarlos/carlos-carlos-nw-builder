<script setup lang="ts">
// One condition leaf's controls: its type picker, then the fields that type edits, laid out by
// lib/condition-fields.ts's table. ConditionRows places them inline in a row; with `stacked`,
// the phone's condition editor gets them full-width, one under another, with pickers opening
// full-screen.
//
// The row is edited in place, as ConditionRows edits its own rows: the draft holding it watches
// deeply, so an edit is live the moment it is made.
import { computed } from "vue";
import ComboBox from "../ui/ComboBox.vue";
import BonusComboBox from "./BonusComboBox.vue";
import BonusOptionRow from "./BonusOptionRow.vue";
import FormField from "../ui/FormField.vue";
import BaseInput from "../ui/BaseInput.vue";
import TokenInput from "../ui/TokenInput.vue";
import RangeOrExactFields from "./RangeOrExactFields.vue";
import FormulaField from "./FormulaField.vue";
import { useEditorDb } from "../../composables/useEditorDb";
import {
  MULTI_VALUE_LEAF_TYPES,
  fromCsv,
  newLeafRow,
  type ConditionRow,
} from "../../engine/condition-draft";
import { conditionTypeLabel, leafLayout } from "../../lib/condition-fields";
import type { BonusOption, BuildParameterSlot } from "../../types";
import type { InputOption } from "../../lib/bonus-draft";

const row = defineModel<ConditionRow>("row", { required: true });

const props = withDefaults(
  defineProps<{
    /** Every known bonus, for the occurrences leaf's picker. */
    bonusOptions?: BonusOption[];
    /** The edited bonus's own inputs, for the `input` leaf's picker. */
    inputOptions?: InputOption[];
    /** The leaf types offered. */
    leafTypes: readonly string[];
    /** Full-width fields stacked in a column, for the phone's condition editor. */
    stacked?: boolean;
  }>(),
  { bonusOptions: () => [], inputOptions: () => [], stacked: false },
);

const layout = computed(() => leafLayout(row.value));

/** Inline, each control keeps its own width; stacked, it fills the editor. */
const width = (inline: string) => (props.stacked ? "w-full" : inline);
const fieldClass = computed(() =>
  props.stacked ? "min-w-0 basis-full" : "min-w-0",
);

const typeOptions = computed(() =>
  props.leafTypes.map((t) => ({ value: t, label: conditionTypeLabel(t) })),
);

// Each leaf type carries different fields; reset to the new type's defaults.
function changeType(type: string) {
  const target = row.value;
  const fresh = newLeafRow(type);
  Object.keys(target).forEach((key) => {
    if (key !== "uid" && key !== "kind")
      delete (target as unknown as Record<string, unknown>)[key];
  });
  Object.assign(target, fresh, { uid: target.uid });
}

/** The surrounding editor's catalog, so params from a disabled layer are still offered. */
const db = useEditorDb();

// Each condition leaf's valid values come from the matching `options` build_parameter slot in
// slots.json, the same source of truth the Options section itself renders from, so a value
// typo'd here can't drift from what's actually selectable in a build.
const PATH_FOR_TYPE: Record<string, string> = {
  role: "role",
  class: "class",
  damageType: "damageType",
};

// Off the composed catalog: a layer-authored param is as gateable as a shipped one, so it
// has to appear in this picker the moment it exists.
const paramSlots = computed(() =>
  db.value.slots.filter(
    (slot): slot is BuildParameterSlot => slot.type === "build_parameter",
  ),
);

const valueOptions = computed(() => {
  const type = row.value.type;
  if (type === "toggle") {
    return paramSlots.value
      .filter((slot) => slot.path.startsWith("toggles."))
      .map((slot) => ({
        value: slot.path.slice("toggles.".length),
        label: slot.label,
      }));
  }
  const path = type ? PATH_FOR_TYPE[type] : undefined;
  if (!path) return [];
  const slot = paramSlots.value.find((s) => s.path === path);
  // Drop a slot's own "- none -" row: "" is a build-editor value, not a condition value. A
  // `class: ""` leaf would serialize to nothing anyway (`fromCsv`).
  const fromSlot = (slot?.options ?? []).filter((o) => o.value);
  if (fromSlot.length) return fromSlot;
  // No parameter declares this path, so the vocabulary is whatever items publish at it, which
  // is where `class` lives. Labeled by the publishing item, and deduped since several items
  // may legitimately assert the same value.
  const byValue = new Map<string, string>();
  for (const item of db.value.items) {
    const value = item.publishes?.[path];
    if (typeof value === "string" && value && !byValue.has(value))
      byValue.set(value, item.name);
  }
  return [...byValue].map(([value, label]) => ({ value, label }));
});

// A list-valued leaf is matched as "one of", so its values are edited as a set of chips rather
// than one pick. The row model keeps them comma-separated; the control speaks arrays.
const isMultiValue = computed(() =>
  MULTI_VALUE_LEAF_TYPES.includes(row.value.type ?? ""),
);

const paramKeyOptions = computed(() =>
  paramSlots.value.map((slot) => ({
    value: slot.path,
    label: `${slot.label} (${slot.path})`,
  })),
);

function paramSlotFor(key?: string) {
  return paramSlots.value.find((slot) => slot.path === key);
}

/** Options for a `param` leaf's "equals" field, when the addressed slot is a `list`. */
const paramValueOptions = computed(() =>
  (paramSlotFor(row.value.key)?.options ?? []).filter((o) => o.value),
);

/** Picking a key resets the comparison to match its `paramType`: the old fields would
 *  otherwise carry over nonsensically (e.g. a leftover `atLeast` after switching to a boolean). */
function changeParamKey(key: string) {
  const target = row.value;
  target.key = key;
  const slot = paramSlotFor(key);
  target.form =
    slot?.paramType === "boolean"
      ? "boolean"
      : slot?.paramType === "list"
        ? "string"
        : "number";
  target.atLeast = null;
  target.below = null;
  target.exactly = null;
  target.rangeMode = "range";
  target.is = null;
  target.equals = "";
}

/** Same reset as `changeParamKey`, by the input's declared type. */
function changeInputKey(key: string) {
  changeParamKey(key);
  const input = props.inputOptions.find((option) => option.value === key);
  row.value.form = input?.type === "boolean" ? "boolean" : "number";
}

/** Whether a `param` or `input` leaf compares a percent, whose fields take percent units. */
const comparesPercent = computed(() => {
  const { type, key } = row.value;
  if (type === "input")
    return (
      props.inputOptions.find((option) => option.value === key)?.type ===
      "percent"
    );
  if (type !== "param") return false;
  return paramSlotFor(key)?.paramType === "percent";
});

/** The name doubles as search text, as a bonus picker's id does. */
const searchableInputs = computed(() =>
  props.inputOptions.map((option) => ({ ...option, search: option.value })),
);
</script>

<template>
  <FormField label="Condition" :class="fieldClass">
    <ComboBox
      :class="width('w-30')"
      :model-value="row.type"
      :options="typeOptions"
      :phone-screen="stacked"
      screen-label="Condition"
      @update:model-value="changeType"
    />
  </FormField>

  <template v-for="field in layout.fields" :key="field">
    <FormField v-if="field === 'bonus'" label="Bonus" :class="fieldClass">
      <BonusComboBox
        :class="width('w-44')"
        :model-value="row.bonus"
        :options="bonusOptions"
        self
        :phone-screen="stacked"
        screen-label="Bonus"
        @update:model-value="(v) => (row.bonus = v)"
      />
    </FormField>
    <FormField v-else-if="field === 'tag'" label="Tag" :class="fieldClass"
      ><BaseInput v-model="row.tag" class="w-full" type="text" list="nw-tags"
    /></FormField>
    <FormField
      v-else-if="field === 'item'"
      label="Or exact item id"
      :class="fieldClass"
      ><BaseInput v-model="row.item" class="w-full" type="text"
    /></FormField>
    <FormField
      v-else-if="field === 'formula'"
      label="Formula"
      :class="stacked ? 'min-w-0 basis-full' : 'min-w-72 flex-1'"
    >
      <FormulaField
        :formula="row.formula ?? ''"
        :label="row.label ?? ''"
        testid="condition-formula"
        @update:formula="(v) => (row.formula = v)"
        @update:label="(v) => (row.label = v)"
      />
    </FormField>
    <FormField
      v-else-if="field === 'paramKey'"
      label="Parameter"
      :class="fieldClass"
    >
      <ComboBox
        :class="width('w-48')"
        :model-value="row.key"
        :options="paramKeyOptions"
        placeholder="- parameter -"
        :phone-screen="stacked"
        screen-label="Parameter"
        @update:model-value="changeParamKey"
      />
    </FormField>
    <FormField
      v-else-if="field === 'inputKey'"
      label="Input"
      :class="fieldClass"
    >
      <ComboBox
        :class="width('w-48')"
        data-testid="condition-input-key"
        :model-value="row.key"
        :options="searchableInputs"
        :placeholder="
          inputOptions.length ? '- input -' : '- no inputs declared -'
        "
        menu-class="w-max min-w-(--anchor-width) max-w-[min(22rem,80vw)]"
        :phone-screen="stacked"
        screen-label="Input"
        @update:model-value="changeInputKey"
      >
        <template #option="{ option }">
          <BonusOptionRow :option="option" />
        </template>
      </ComboBox>
    </FormField>
    <FormField v-else-if="field === 'is'" label="Is" :class="fieldClass">
      <ComboBox
        :class="width('w-24')"
        data-testid="condition-is"
        :model-value="row.is === true ? 'on' : row.is === false ? 'off' : ''"
        :options="[
          { value: 'on', label: 'on' },
          { value: 'off', label: 'off' },
        ]"
        placeholder="- is -"
        :phone-screen="stacked"
        screen-label="Is"
        @update:model-value="(v) => (row.is = v === 'on')"
      />
    </FormField>
    <FormField
      v-else-if="field === 'equals'"
      label="Any of"
      :class="fieldClass"
    >
      <TokenInput
        :class="width('w-56')"
        data-testid="condition-values"
        :model-value="fromCsv(row.equals)"
        :options="paramValueOptions"
        :allow-free="!paramValueOptions.length"
        placeholder="- value -"
        @update:model-value="(v) => (row.equals = v.join(', '))"
      />
    </FormField>
    <RangeOrExactFields
      v-else-if="field === 'range'"
      v-model:at-least="row.atLeast"
      v-model:below="row.below"
      v-model:exactly="row.exactly"
      v-model:range-mode="row.rangeMode"
      :unit-suffix="layout.unitSuffix"
      :allow-at-least-one="layout.allowAtLeastOne"
      :percent="comparesPercent"
      :fill="stacked"
    />
    <FormField
      v-else
      :label="isMultiValue ? 'Any of' : 'Value'"
      :class="fieldClass"
    >
      <TokenInput
        v-if="isMultiValue"
        :class="width('w-56')"
        data-testid="condition-values"
        :model-value="fromCsv(row.value)"
        :options="valueOptions"
        :allow-free="!valueOptions.length"
        placeholder="- value -"
        @update:model-value="(v) => (row.value = v.join(', '))"
      />
      <ComboBox
        v-else-if="valueOptions.length"
        :class="width('w-38')"
        :model-value="row.value"
        :options="valueOptions"
        :phone-screen="stacked"
        screen-label="Value"
        @update:model-value="(v) => (row.value = v)"
      />
      <BaseInput v-else v-model="row.value" class="w-full" type="text" />
    </FormField>
  </template>
</template>
