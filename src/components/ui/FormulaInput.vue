<script setup lang="ts">
// A one-line expression field that shows problems where they are: the text again under the
// field with each problem's range marked, then the messages, each with a one-click fix when
// the caller has one. It knows nothing about what the expression means; the caller parses it
// and hands the problems in.
import { computed, nextTick, useId, useTemplateRef } from "vue";
import BaseLink from "./BaseLink.vue";

export interface FormulaInputIssue {
  /** Character offsets into the text. An empty range marks a position, such as the end. */
  start: number;
  end: number;
  message: string;
  level?: "error" | "warn";
  /** A correction: `text` in place of `start` to `end`, offered as a link. */
  fix?: { start: number; end: number; text: string };
}

const props = withDefaults(
  defineProps<{
    issues?: FormulaInputIssue[];
    placeholder?: string;
    /** The field's `data-testid`; each message gets `<testid>-issue`. */
    testid?: string;
  }>(),
  { issues: () => [], placeholder: "", testid: undefined },
);

const model = defineModel<string>({ default: "" });
const field = useTemplateRef<HTMLInputElement>("field");
const messagesId = useId();

const hasError = computed(() =>
  props.issues.some((issue) => (issue.level ?? "error") === "error"),
);

/** The text cut at every issue boundary, each run knowing whether an issue covers it. An
 *  empty range becomes a caret run of its own. */
const runs = computed(() => {
  const text = model.value;
  const cuts = new Set([0, text.length]);
  for (const { start, end } of props.issues) {
    cuts.add(Math.min(start, text.length));
    cuts.add(Math.min(end, text.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; marked: boolean }[] = [];
  const caretAt = (at: number) =>
    props.issues.some(
      (issue) =>
        issue.start === issue.end && Math.min(issue.start, text.length) === at,
    );
  points.forEach((at, index) => {
    if (caretAt(at)) out.push({ text: "‸", marked: true });
    const next = points[index + 1];
    if (next === undefined) return;
    const marked = props.issues.some(
      (issue) => issue.start < next && issue.end > at,
    );
    out.push({ text: text.slice(at, next), marked });
  });
  return out;
});

/** Puts `text` at the cursor, replacing any selection, and leaves the cursor after it. */
function insert(text: string) {
  const el = field.value;
  const start = el?.selectionStart ?? model.value.length;
  replace(start, el?.selectionEnd ?? start, text);
}

/** Puts `text` in place of `start` to `end` and leaves the cursor after it. */
function replace(start: number, end: number, text: string) {
  const el = field.value;
  const value = model.value;
  model.value = value.slice(0, start) + text + value.slice(end);
  void nextTick(() => {
    const at = start + text.length;
    el?.focus();
    el?.setSelectionRange(at, at);
  });
}

defineExpose({ insert });
</script>

<template>
  <div class="flex min-w-0 flex-col gap-0.5">
    <input
      ref="field"
      v-model="model"
      type="text"
      spellcheck="false"
      autocomplete="off"
      class="w-full rounded-md border bg-surface px-1.5 py-0.5 font-mono focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      :class="hasError ? 'border-danger' : 'border-line'"
      :placeholder="placeholder"
      :aria-invalid="hasError || undefined"
      :aria-describedby="issues.length ? messagesId : undefined"
      :data-testid="testid"
    />
    <template v-if="issues.length">
      <div
        v-if="model"
        class="overflow-hidden text-ellipsis whitespace-pre px-1.5 font-mono text-muted"
        aria-hidden="true"
      >
        <span
          v-for="(run, index) in runs"
          :key="index"
          :class="
            run.marked &&
            (hasError
              ? 'text-danger underline decoration-wavy'
              : 'text-warn underline decoration-wavy')
          "
          >{{ run.text }}</span
        >
      </div>
      <ul :id="messagesId" class="list-none">
        <li
          v-for="(issue, index) in issues"
          :key="index"
          :class="
            (issue.level ?? 'error') === 'error' ? 'text-danger' : 'text-warn'
          "
          :data-testid="testid && `${testid}-issue`"
        >
          {{ issue.message }}
          <BaseLink
            v-if="issue.fix"
            class="ml-1"
            :data-testid="testid && `${testid}-fix`"
            @click="replace(issue.fix.start, issue.fix.end, issue.fix.text)"
            >use <code>{{ issue.fix.text }}</code></BaseLink
          >
        </li>
      </ul>
    </template>
  </div>
</template>
