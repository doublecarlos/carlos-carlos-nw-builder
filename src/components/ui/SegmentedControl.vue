<script setup lang="ts" generic="T extends string">
// "Pick exactly one of a few options" as a row of joined buttons: bonus payload kind, problem
// severity, condition range/exact, the phone's Editor | Stats switch. Tone is per option rather
// than per control: problem severity's error/warning pair share one control but read in two
// different palettes when active.
//
// A label never wraps inside its segment. When the one-row width does not fit the space the
// control is given, the options become a full-width grid of equal cells in the fewest rows
// that fit, down to one column. Both inputs to that decision are layout independent, so
// switching never feeds back into it: each label's own text width (an inline-block, never
// stretched by its button), and the root's width, which takes the one-row width as its
// preferred size in either layout.
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import {
  fitsOneRow,
  gridColumns,
  oneRowWidth,
  type SegmentChrome,
} from "../../lib/segmented-fit";
import { useFormFieldLabelId } from "../../composables/useFormField";

const props = withDefaults(
  defineProps<{
    options: {
      value: T;
      label: string;
      tone?: "accent" | "danger" | "warn";
      testid?: string;
    }[];
    /** Spread across the full width, the options sharing it equally. */
    fill?: boolean;
  }>(),
  { fill: false },
);

const model = defineModel<T>({ required: true });

const labelledBy = useFormFieldLabelId();

const toneClasses: Record<"accent" | "danger" | "warn", string> = {
  accent: "border-accent bg-accent-soft text-text",
  danger: "border-danger bg-danger-soft text-danger",
  warn: "border-warn bg-warn/25 text-warn",
};

const root = useTemplateRef<HTMLElement>("root");
const labels = useTemplateRef<HTMLElement[]>("labels");

/** Label text widths and segment chrome, once measured; null before the first measurement. */
const measured = ref<{ widths: number[]; chrome: SegmentChrome } | null>(null);
const available = ref(0);
const rowWidth = computed(() =>
  measured.value
    ? oneRowWidth(measured.value.widths, measured.value.chrome)
    : null,
);
const stacked = computed(
  () =>
    rowWidth.value !== null &&
    available.value > 0 &&
    !fitsOneRow(rowWidth.value, available.value),
);
const columns = computed(() =>
  stacked.value && measured.value
    ? gridColumns(measured.value.widths, measured.value.chrome, available.value)
    : 1,
);

function measureRow() {
  const spans = labels.value ?? [];
  const first = spans[0]?.parentElement;
  if (!first) return;
  const widths = spans.map((span) => span.getBoundingClientRect().width);
  // Not rendered (a hidden pane): keep the last measurement until it shows.
  if (widths.every((width) => width === 0)) return;
  const style = getComputedStyle(first);
  measured.value = {
    widths,
    chrome: {
      paddingX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
      border: parseFloat(style.borderRightWidth),
    },
  };
}

function measureAvailable() {
  if (!root.value) return;
  const style = getComputedStyle(root.value);
  const width =
    root.value.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  if (width > 0) available.value = width;
}

function measure() {
  measureAvailable();
  measureRow();
}

let observer: ResizeObserver | null = null;
let frame = 0;

function observe() {
  observer?.disconnect();
  if (!root.value) return;
  observer?.observe(root.value);
  for (const span of labels.value ?? []) observer?.observe(span);
}

onMounted(() => {
  measure();
  // Applied on the next frame: switching layout resizes the observed root, and doing that
  // inside the callback trips the browser's ResizeObserver loop warning.
  observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  });
  observe();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(frame);
});

watch(
  () => props.options.map((option) => option.label),
  async () => {
    await nextTick();
    observe();
    measure();
  },
);

/** The one-row width as the group's preferred size, capped by the space it is given. */
const groupStyle = computed(() =>
  props.fill || rowWidth.value === null
    ? undefined
    : { width: `${rowWidth.value}px` },
);

/** The grid's columns, or nothing in a row. */
const gridStyle = computed(() =>
  stacked.value
    ? { gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))` }
    : undefined,
);

/** Per-segment grid placement: the outer corners rounded, neighbors overlapping onto one
 *  shared border line, and the last segment spanning what its row leaves empty so the grid
 *  stays a rectangle. The active segment is positioned so its tone border draws on top. */
const cells = computed(() => {
  const count = props.options.length;
  const cols = columns.value;
  const rows = Math.ceil(count / cols);
  return props.options.map((_, index) => {
    const column = index % cols;
    const row = Math.floor(index / cols);
    const last = index === count - 1;
    return {
      class: [
        index === 0 && "rounded-tl-md",
        index === cols - 1 && "rounded-tr-md",
        index === (rows - 1) * cols && "rounded-bl-md",
        last && "rounded-br-md",
        column > 0 && "-ml-px",
        row > 0 && "-mt-px",
      ],
      style: last ? { gridColumn: `span ${rows * cols - index}` } : undefined,
    };
  });
});
</script>

<template>
  <div
    ref="root"
    role="group"
    :aria-labelledby="labelledBy"
    class="flex min-w-0 max-w-full"
    :data-stacked="stacked ? '' : undefined"
    :data-columns="stacked ? columns : undefined"
  >
    <div
      data-testid="segmented-group"
      class="max-w-full"
      :class="stacked ? 'grid w-full' : ['flex', fill && 'w-full']"
      :style="[groupStyle, gridStyle]"
    >
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        :data-testid="option.testid"
        :aria-pressed="model === option.value"
        class="border border-line px-2 py-0.5"
        :class="[
          model === option.value
            ? [toneClasses[option.tone ?? 'accent'], stacked && 'relative']
            : 'bg-surface text-muted',
          stacked
            ? cells[index]?.class
            : 'first:rounded-l-md last:rounded-r-md last:border-l-0',
          fill && !stacked && 'flex-1',
        ]"
        :style="stacked ? cells[index]?.style : undefined"
        @click="model = option.value"
      >
        <span ref="labels" class="inline-block whitespace-nowrap">{{
          option.label
        }}</span>
      </button>
    </div>
  </div>
</template>
