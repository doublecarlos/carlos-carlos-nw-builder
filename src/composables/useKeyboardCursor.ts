import {
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  type ComponentPublicInstance,
  type Ref,
} from "vue";
import { isFormControl } from "./focus";

export type CursorKind = "header" | "slot";
export interface CursorPos {
  type: CursorKind;
  id: string;
  kind?: "item_picker" | "build_parameter";
}
interface Row {
  type: string;
  id: string;
  kind?: "item_picker" | "build_parameter";
}

/** The subset of ItemPicker's public surface the cursor needs -- a structural type instead of
 *  importing the component so this composable doesn't need to know which component fills a
 *  slot row. */
interface ParamHandle {
  focus: () => void;
  /** Open a list-type control and seed its query with char. */
  focusAndSeed: (char: string) => void;
}

interface PickerHandle {
  focusAndSeed: (char: string) => void;
  $el?: Element | null;
}

export interface KeyboardCursorHandlers {
  /** Enter on a header row: the same thing a click on it does (expand/collapse). */
  onToggleHeader: (sectionId: string) => void;
  /** Backspace/Delete on a slot row: clear its choice. */
  onClearSlot: (slotId: string) => void;
  /** Reset a build_parameter slot to its default value. */
  onResetParam: (slotId: string) => void;
}

/**
 * A Google-Sheets-style passive cursor over a flat list of header/slot rows -- independent of
 * real DOM focus, but kept in sync with it both ways: `setCursor` pushes onto real focus (so
 * Tab from a highlighted row continues from there), and a `focusin` the caller forwards to
 * `onFocusIn` pulls the cursor back to match focus that moved for a reason that never went
 * through `setCursor` (native Tab order, or a click landing directly on a row's picker input).
 */
export function useKeyboardCursor(
  root: Ref<HTMLElement | null>,
  visibleRows: Ref<Row[]>,
  handlers: KeyboardCursorHandlers,
) {
  const cursor = ref<CursorPos | null>(null);
  /** Imperative ref bag for per-row ItemPickers -- plain object, not `ref`/`reactive`, so it
   *  stays outside Vue's reactivity (see `setPickerRef`). */
  const pickerRefs: Record<string, PickerHandle> = {};
  const paramRefs: Record<string, ParamHandle> = {};

  function isCursor(type: string, id: string) {
    return cursor.value?.type === type && cursor.value?.id === id;
  }

  function setCursor(
    type: CursorKind,
    id: string,
    kind?: "item_picker" | "build_parameter",
  ) {
    cursor.value = { type, id, kind };
    syncCursorFocus();
  }

  function setPickerRef(
    slotId: string,
    el: Element | ComponentPublicInstance | null,
  ) {
    if (el) pickerRefs[slotId] = el as unknown as PickerHandle;
    else delete pickerRefs[slotId];
  }

  /** Focusing the input reuses ItemPicker's own `onFocus` (opens, clears the query). Only
   *  the type-ahead case needs a seeded query, via ItemPicker's `focusAndSeed`. */
  function focusPicker(slotId: string, seedChar?: string) {
    const param = paramRefs[slotId];
    if (param) {
      if (seedChar) param.focusAndSeed(seedChar);
      else param.focus();
      return;
    }
    const picker = pickerRefs[slotId];
    if (!picker) return;
    if (seedChar) picker.focusAndSeed(seedChar);
    else picker.$el?.querySelector("input")?.focus();
  }

  /**
   * Scrolls the cursor row into view, and -- unless real focus is already somewhere inside
   * it (a click straight into the picker, say) -- moves native DOM focus to it too. Without
   * this, arrowing the visual cursor around leaves real focus stranded wherever it happened
   * to be last, and Tab from there jumps somewhere unrelated to what's highlighted; with it,
   * Tab naturally continues from the row the cursor is actually on (and, for a slot row,
   * lands on that row's own picker next, since it's tabindex="-1" and the picker input is
   * the next focusable thing after it in document order).
   */
  function syncCursorFocus() {
    nextTick(() => {
      if (!cursor.value) return;
      const key = `${cursor.value.type}:${cursor.value.id}`;
      const el = root.value?.querySelector(
        `[data-cursor-key="${CSS.escape(key)}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ block: "nearest" });
      if (!el.contains(document.activeElement))
        el.focus({ preventScroll: true });
    });
  }

  /**
   * The passive gate: arrow/type-to-edit only fires when nothing has already claimed the
   * keyboard for its own editing. This is deliberately not scoped to the list container --
   * Escape on an open picker blurs its input, which sends focus to <body>, and the cursor
   * (never cleared) should be immediately live again with no extra click.
   */
  function isPassiveTarget() {
    return !isFormControl(document.activeElement);
  }

  function onNavKeydown(event: KeyboardEvent) {
    if (!isPassiveTarget()) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const rows = visibleRows.value;
      if (!rows.length) return;
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      const idx = cursor.value
        ? rows.findIndex(
            (r) => r.type === cursor.value!.type && r.id === cursor.value!.id,
          )
        : -1;
      const next =
        idx === -1
          ? dir === 1
            ? 0
            : rows.length - 1
          : Math.min(Math.max(idx + dir, 0), rows.length - 1);
      setCursor(rows[next].type as CursorKind, rows[next].id, rows[next].kind);
      return;
    }

    if (!cursor.value) return;

    if (event.key === "Enter") {
      event.preventDefault();
      if (cursor.value.type === "header")
        handlers.onToggleHeader(cursor.value.id);
      else focusPicker(cursor.value.id);
      return;
    }

    if (
      cursor.value.type === "slot" &&
      (event.key === "Backspace" || event.key === "Delete")
    ) {
      event.preventDefault();
      if (cursor.value.kind === "build_parameter") {
        handlers.onResetParam(cursor.value.id);
      } else {
        handlers.onClearSlot(cursor.value.id);
      }
      return;
    }

    if (
      cursor.value.type === "slot" &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      focusPicker(cursor.value.id, event.key);
    }
  }

  /**
   * `setCursor`/`syncCursorFocus` push the keyboard cursor's position onto real DOM focus,
   * but focus can also move for reasons that never go through `setCursor` -- native Tab
   * order, or a click landing directly on a descendant like the picker input rather than
   * bubbling a `setCursor` call from the row div itself. Left alone, the cursor would go
   * stale and point somewhere real focus already isn't, so arrow keys from there would
   * jump from the wrong place. Syncing the other direction here -- real focus moving
   * updates the cursor to match -- keeps the two from ever disagreeing. The caller forwards
   * its container's own `focusin` here rather than this composable registering its own
   * listener, since a plain `addEventListener('focusin', ...)` can't tell "the container
   * gained focus" from "a descendant did" without the same `closest()` walk anyway.
   */
  function onFocusIn(event: FocusEvent) {
    const key = (event.target as HTMLElement)
      ?.closest?.("[data-cursor-key]")
      ?.getAttribute("data-cursor-key");
    if (!key) return;
    const sep = key.indexOf(":");
    const type = key.slice(0, sep) as CursorKind;
    const id = key.slice(sep + 1);
    if (cursor.value?.type === type && cursor.value?.id === id) return;
    // Read slot kind from the DOM (set by BuildSlot.vue's :data-slot-kind)
    const kind = (event.target as HTMLElement)
      ?.closest?.("[data-slot-kind]")
      ?.getAttribute("data-slot-kind") as
      "item_picker" | "build_parameter" | null;
    cursor.value = { type, id, kind: kind ?? undefined };
  }

  /** Register a build_parameter control ref. */
  function setParamRef(
    slotId: string,
    el: Element | ComponentPublicInstance | null,
  ) {
    if (el) paramRefs[slotId] = el as unknown as ParamHandle;
    else delete paramRefs[slotId];
  }

  onMounted(() => window.addEventListener("keydown", onNavKeydown));
  onUnmounted(() => window.removeEventListener("keydown", onNavKeydown));

  return { cursor, isCursor, setCursor, setPickerRef, setParamRef, onFocusIn };
}
