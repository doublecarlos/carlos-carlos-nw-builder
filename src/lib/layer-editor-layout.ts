// Which parts of the layer editor show at each viewport size, as a table rather than `v-if`s
// spread across LayerEditor.vue's template.
//
// - Desktop: entry list and form side by side; the list is a resizable, collapsible rail.
// - Tablet: list stacked above the form; the list can still collapse.
// - Phone: master-detail. The list fills the pane until an entry opens, then the form fills
//   it with a Back control; the toolbar's actions fold into one menu.
import type { ViewportKind } from "./shell-layout";

/** Which half a phone shows: the entry list or the open entry's form. */
export type LayerEditorView = "list" | "detail";

export interface LayerEditorLayout {
  list: boolean;
  form: boolean;
  /** A Back control above the form, returning to the list. */
  back: boolean;
  /** The list's collapse/resize gutter, and with it the stored collapse state. */
  entriesRail: boolean;
  /** Undo/redo, export, import and discard: in the toolbar, or in its overflow menu. */
  actions: "bar" | "menu";
}

const SIDE_BY_SIDE: LayerEditorLayout = {
  list: true,
  form: true,
  back: false,
  entriesRail: true,
  actions: "bar",
};

const LAYOUTS: Record<
  ViewportKind,
  (view: LayerEditorView) => LayerEditorLayout
> = {
  desktop: () => SIDE_BY_SIDE,
  tablet: () => SIDE_BY_SIDE,
  phone: (view) => ({
    list: view === "list",
    form: view === "detail",
    back: true,
    entriesRail: false,
    actions: "menu",
  }),
};

export function layerEditorLayout(
  kind: ViewportKind,
  view: LayerEditorView,
): LayerEditorLayout {
  return LAYOUTS[kind](view);
}
