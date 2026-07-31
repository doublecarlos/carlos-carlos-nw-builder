<script setup lang="ts">
// Percent field, in the spirit of a percent-formatted spreadsheet cell.
//
// The engine stores percentages as decimals (0.09 === 9%), which is right for the maths and
// awful to type: `0.09` is easy to enter as `9`, and `catalog.validate` exists partly to catch
// exactly that mistake. This widget removes the mistake instead of reporting it -- you read and
// type percent units, and the decimal never surfaces.
//
// Float hygiene matters more here than it looks. `3.6 / 100` is 0.036000000000000004, not
// 0.036, so a naive conversion would perturb every value it touched: the item would diff
// against the shipped data, and the export would fill with noise digits. Both directions round
// to a precision far finer than any real game value.
import { ref, computed, nextTick } from "vue";

/** decimal -> percent number. 0.036 -> 3.6, not 3.5999999999999996. */
const toPercent = (value: number | string) =>
  Number((Number(value) * 100).toFixed(10));

/** percent number -> decimal. 3.6 -> 0.036, not 0.036000000000000004. */
const toDecimal = (percent: number | string) =>
  Number((Number(percent) / 100).toFixed(12));

/** Up to 4 decimals, trailing zeros trimmed: 9, 3.6, 9.85. The % sign is a fixed suffix in
 * the template, not part of this text, so it stays visible while typing too. */
const display = (value: number | string) => {
  if (value === "" || value == null || !Number.isFinite(Number(value)))
    return "";
  const percent = toPercent(value);
  return String(Number(percent.toFixed(4)));
};

const props = withDefaults(
  defineProps<{
    placeholder?: string;
    step?: number; // percentage points per arrow press
  }>(),
  {
    placeholder: "",
    step: 1,
  },
);

const model = defineModel<number | string>({ default: "" });

const focused = ref(false);
const text = ref("");

const shown = computed(() =>
  focused.value ? text.value : display(model.value),
);

function onFocus(event: FocusEvent) {
  focused.value = true;
  const value = model.value;
  text.value =
    value === "" || value == null || !Number.isFinite(Number(value))
      ? ""
      : String(toPercent(value));
  // Select the whole value, so typing replaces rather than appends -- the spreadsheet
  // behaviour, and the reason retyping a rate is not fiddly.
  nextTick(() => (event.target as HTMLInputElement).select());
}

function onBlur() {
  focused.value = false;
}

function onInput(event: Event) {
  text.value = (event.target as HTMLInputElement).value;
  commit(text.value);
}

function commit(raw: string) {
  const cleaned = String(raw).replace(/[%\s]/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") {
    model.value = "";
    return;
  }
  const percent = Number(cleaned);
  // Mid-typing states like "9." or "-" are left alone rather than snapped to 0.
  if (!Number.isFinite(percent)) return;
  model.value = toDecimal(percent);
}

function nudge(direction: number, event: KeyboardEvent) {
  event.preventDefault();
  const current =
    Number.isFinite(Number(model.value)) && model.value !== ""
      ? toPercent(model.value)
      : 0;
  const factor = event.shiftKey ? 10 : 1;
  const next = Number((current + direction * props.step * factor).toFixed(10));
  text.value = String(next);
  model.value = toDecimal(next);
}
</script>

<template>
  <span class="relative inline-block w-28">
    <input
      ref="input"
      class="w-full border border-line rounded-md pr-5 text-right tabular-nums text-accent focus:text-text"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      :value="shown"
      :placeholder="placeholder"
      @focus="onFocus"
      @blur="onBlur"
      @input="onInput"
      @keydown.up="nudge(1, $event)"
      @keydown.down="nudge(-1, $event)"
    />
    <span
      class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted"
      >%</span
    >
  </span>
</template>
