import { nextTick, type Ref } from "vue";

/**
 * Real-focus keyboard navigation for a list of same-role controls inside a container: the
 * menu-button pattern, where arrow keys move focus itself. Contrast `useMenuNavigation`, whose
 * combobox keeps focus in a text field and moves a highlight index instead.
 */
export function useRovingFocus(options: {
  container: Ref<HTMLElement | null>;
  /** Selector for the focusable items inside `container`. */
  itemSelector: string;
  /** Arrow/Home/End move focus among items. Off for a panel whose own control already owns
   *  Up/Down, e.g. SectionCopyMenu's combobox. Tab and Escape still dismiss either way. */
  roving?: boolean;
  /** Called on Tab, Escape, or when focus should leave the container. */
  onDismiss: () => void;
}) {
  const roving = options.roving ?? true;

  function items(): HTMLElement[] {
    const root = options.container.value;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>(options.itemSelector)].filter(
      (el) => !(el as HTMLButtonElement | HTMLInputElement).disabled,
    );
  }

  function focusFirst() {
    nextTick(() => items()[0]?.focus());
  }

  function focusLast() {
    nextTick(() => {
      const list = items();
      list[list.length - 1]?.focus();
    });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Tab") {
      // Prevented so focus does not leak past the panel into the teleport tail of <body>.
      event.preventDefault();
      options.onDismiss();
      return;
    }
    if (event.key === "Escape") {
      options.onDismiss();
      return;
    }
    if (!roving) return;

    const list = items();
    if (!list.length) return;
    const at = list.indexOf(event.target as HTMLElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        list[at === -1 ? 0 : (at + 1) % list.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        list[
          at === -1 ? list.length - 1 : (at - 1 + list.length) % list.length
        ]?.focus();
        break;
      case "Home":
        event.preventDefault();
        list[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
    }
  }

  return { focusFirst, focusLast, onKeydown };
}
