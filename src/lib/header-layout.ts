// Which header actions sit in the bar and which move into its overflow menu, per viewport.
// A table rather than per-button `v-if`s, so each viewport's header reads in one place.
//
// - Desktop: every action in the bar, nothing in a menu.
// - Tablet: the file actions stay in the bar; the rest go to the menu.
// - Phone: one row holds only the nav toggle, the mark, search, save state and the menu.
//
// The keyboard-shortcuts sheet is left out entirely on a coarse pointer, at any width: there is
// no keyboard to use it with.
import type { ViewportKind } from "./shell-layout";

export type HeaderAction =
  | "export"
  | "import"
  | "importFromGame"
  | "stable"
  | "shortcuts"
  | "about"
  | "theme";

type Placement = "bar" | "menu";

/** Menu order follows this key order. */
const PLACEMENTS: Record<ViewportKind, Record<HeaderAction, Placement>> = {
  desktop: {
    export: "bar",
    import: "bar",
    importFromGame: "bar",
    stable: "bar",
    shortcuts: "bar",
    about: "bar",
    theme: "bar",
  },
  tablet: {
    export: "bar",
    import: "bar",
    importFromGame: "menu",
    stable: "menu",
    shortcuts: "bar",
    about: "menu",
    theme: "menu",
  },
  phone: {
    export: "menu",
    import: "menu",
    importFromGame: "menu",
    stable: "menu",
    shortcuts: "menu",
    about: "menu",
    theme: "menu",
  },
};

export interface HeaderLayout {
  bar: ReadonlySet<HeaderAction>;
  /** In menu order; empty when the menu is not shown at all. */
  menu: readonly HeaderAction[];
}

export function headerLayout(
  kind: ViewportKind,
  coarsePointer: boolean,
): HeaderLayout {
  const bar = new Set<HeaderAction>();
  const menu: HeaderAction[] = [];
  for (const [action, placement] of Object.entries(PLACEMENTS[kind]) as [
    HeaderAction,
    Placement,
  ][]) {
    if (action === "shortcuts" && coarsePointer) continue;
    if (placement === "bar") bar.add(action);
    else menu.push(action);
  }
  return { bar, menu };
}
