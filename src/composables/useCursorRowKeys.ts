import { onKeyStroke } from "@vueuse/core";
import type { Ref } from "vue";

/** What a cursor row does with each key group. Headers only need `onArrow` -- their Enter and
 *  Space are native button clicks (the toggle), and clearing/seeding is a slot-row concept. */
export interface CursorRowKeyHandlers {
  /** Arrow keys: move focus to the neighbouring row. */
  onArrow: (dir: 1 | -1) => void;
  /** Enter: focus the row's control (opens it, same as a click). */
  onEnter?: () => void;
  /** Backspace/Delete: clear an item choice or reset a build_parameter to its default. */
  onClear?: () => void;
  /** Type-ahead: open the row's control pre-seeded with the typed character. */
  onSeed?: (char: string) => void;
}

/**
 * Binds one row's keyboard-cursor keys (a header button or a slot row's cursor anchor) via
 * `onKeyStroke` scoped to the `target` element. Scoping is what makes the passive gate
 * unnecessary: a slot's anchor is a *sibling* of its input, not an ancestor, so keydowns
 * typed inside the picker bubble past it and never reach these listeners -- if they fire,
 * the target has focus and the row owns the keyboard. `dedupe` makes a held key act once.
 *
 * Handlers may read props/refs at call time (e.g. `() => props.onArrow(dir)`), which keeps
 * them current even though the registered listener holds the first render's closures.
 */
export function useCursorRowKeys(
  target: Ref<HTMLElement | null>,
  handlers: CursorRowKeyHandlers,
) {
  const { onArrow, onEnter, onClear, onSeed } = handlers;

  onKeyStroke(
    ["ArrowDown", "ArrowUp"],
    (event) => {
      event.preventDefault();
      onArrow(event.key === "ArrowDown" ? 1 : -1);
    },
    { target, dedupe: true },
  );

  if (onEnter)
    onKeyStroke(
      "Enter",
      (event) => {
        event.preventDefault();
        onEnter();
      },
      { target, dedupe: true },
    );

  if (onClear)
    onKeyStroke(
      ["Backspace", "Delete"],
      (event) => {
        event.preventDefault();
        onClear();
      },
      { target, dedupe: true },
    );

  if (onSeed)
    onKeyStroke(
      (event) =>
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey,
      (event) => {
        event.preventDefault();
        onSeed(event.key);
      },
      { target, dedupe: true },
    );
}
