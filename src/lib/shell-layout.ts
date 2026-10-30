// Which panes the app shell shows at each viewport size, kept apart from App.vue so the rules
// read (and test) as a table rather than as `v-if`s spread across the template.
//
// - Desktop: nav and stats are resizable, collapsible rails beside the editor.
// - Tablet: nav moves into an overlay drawer; stats stays beside the editor at a fixed width.
// - Phone: nav is a drawer and the editor and stats take turns filling the screen.

export type ViewportKind = "desktop" | "tablet" | "phone";

/** The pane a phone shows while a build is open. */
export type PhonePane = "editor" | "stats";

/** What the main area holds: a build (editor and stats), a layer, or the no-builds landing. */
export type ShellContent = "build" | "layer" | "none";

/** How the stat panel is laid out: a resizable rail, a fixed column, the whole pane, or not at all. */
export type StatsMode = "rail" | "fixed" | "pane" | "hidden";

export interface ShellLayout {
  /** Nav as a rail in the page, or behind a drawer opened from the header. */
  nav: "rail" | "drawer";
  /** Whether the editor column (build or layer editor, or the landing) is on screen. */
  editor: boolean;
  stats: StatsMode;
  /** Whether the bottom Editor | Stats switch is shown. */
  paneSwitch: boolean;
}

export function viewportKind(desktop: boolean, phone: boolean): ViewportKind {
  if (desktop) return "desktop";
  return phone ? "phone" : "tablet";
}

type LayoutFor = (pane: PhonePane) => ShellLayout;

/** The layout of a build at each viewport size. Anything other than a build has no stat panel
 *  and fills the main area alone. */
const BUILD_LAYOUTS: Record<ViewportKind, LayoutFor> = {
  desktop: () => ({
    nav: "rail",
    editor: true,
    stats: "rail",
    paneSwitch: false,
  }),
  tablet: () => ({
    nav: "drawer",
    editor: true,
    stats: "fixed",
    paneSwitch: false,
  }),
  phone: (pane) => ({
    nav: "drawer",
    editor: pane === "editor",
    stats: pane === "stats" ? "pane" : "hidden",
    paneSwitch: true,
  }),
};

export function shellLayout(
  kind: ViewportKind,
  content: ShellContent,
  pane: PhonePane,
): ShellLayout {
  if (content === "build") return BUILD_LAYOUTS[kind](pane);
  return {
    nav: kind === "desktop" ? "rail" : "drawer",
    editor: true,
    stats: "hidden",
    paneSwitch: false,
  };
}
