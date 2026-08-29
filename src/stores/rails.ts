// Which side rails are collapsed, and how wide the open ones are.
//
// A view preference, not a build edit: shared across every build, never on the undo stack, and
// persisted alongside the BuildEditor's section-expanded state under the same key (see
// storage.ts's `UiState`, whose write merges so the two owners don't clobber each other).
import { computed, reactive, ref, watch } from "vue";
import { useEventListener } from "@vueuse/core";
import * as storage from "../storage/storage";

/** The rails that can collapse. Ids are persisted, so they are part of the stored format. */
export const RAILS = {
  /** The left sidebar: builds, layers, trash. */
  nav: "nav",
  /** The right stats/bonuses panel. */
  details: "details",
  /** The layer editor's own list of entries. */
  layerEntries: "layerEntries",
} as const;

export type RailId = (typeof RAILS)[keyof typeof RAILS];

/**
 * Column width a rail opens at, in px, and the width a double-click on its handle restores.
 *
 * These are whole-column widths: each includes the gutter the handle lives in, so the content
 * beside it keeps the width it had before the gutter existed.
 */
export const RAIL_DEFAULTS: Record<RailId, number> = {
  nav: 268,
  details: 532,
  layerEntries: 396,
};

/** The strip a collapsed rail leaves behind -- RailGutter's `w-7`. */
export const RAIL_COLLAPSED_PX = 28;

/** Narrow enough to be worth dragging to, wide enough that the rail still shows something. */
export const MIN_RAIL_PX = 180;

/** What has to survive beside a rail: the editor's floor plus both collapsed strips. */
const RESERVED_PX = 380;

// Viewport width for the render-time clamp. Both reads are guarded because the unit suite runs
// these stores against a bare `window` shim with neither property -- which leaves the cap at
// infinity, exactly right for a headless store.
const viewport = ref(Number.POSITIVE_INFINITY);
const syncViewport = () => {
  if (Number.isFinite(window.innerWidth)) viewport.value = window.innerWidth;
};
syncViewport();
if (typeof window.addEventListener === "function")
  useEventListener(window, "resize", syncViewport);

/**
 * The widest this rail may be drawn: enough page has to be left for the editor's floor even
 * with the other rail closed. Never below the rail's own default, so opening a small window
 * doesn't retroactively shrink a layout the user never touched.
 */
const capFor = (rail: RailId) =>
  Math.max(RAIL_DEFAULTS[rail], viewport.value - RESERVED_PX);

const clamp = (rail: RailId, px: number) =>
  Math.round(Math.min(Math.max(px, MIN_RAIL_PX), capFor(rail)));

const stored = storage.loadUiState();
const storedCollapsed = stored.collapsed ?? {};
const storedWidths = stored.railWidths ?? {};

/** Everything starts open: a rail the user has never touched should show its content. */
const state = reactive<Record<RailId, boolean>>({
  nav: storedCollapsed.nav ?? false,
  details: storedCollapsed.details ?? false,
  layerEntries: storedCollapsed.layerEntries ?? false,
});

// Widths are held as the user dragged them and clamped only on the way out, so a window that
// shrinks and grows again hands back the width it had rather than having overwritten it.
const widths = reactive<Record<RailId, number>>({
  nav: storedWidths.nav ?? RAIL_DEFAULTS.nav,
  details: storedWidths.details ?? RAIL_DEFAULTS.details,
  layerEntries: storedWidths.layerEntries ?? RAIL_DEFAULTS.layerEntries,
});

watch([state, widths], () => {
  storage.saveUiState({
    collapsed: { ...state },
    railWidths: { ...widths },
  });
});

export const collapsed = (rail: RailId) => computed(() => state[rail]);

export const isCollapsed = (rail: RailId) => state[rail];

export function toggle(rail: RailId) {
  state[rail] = !state[rail];
}

/** The rail's open column width, clamped to what the current viewport can carry. */
export const width = (rail: RailId) =>
  computed(() => clamp(rail, widths[rail]));

/** The same value outside a reactive context -- the drag's starting point. */
export const widthOf = (rail: RailId) => clamp(rail, widths[rail]);

/** The cap a resize handle reports as its `aria-valuemax`. */
export const maxWidth = (rail: RailId) => computed(() => capFor(rail));

export function setWidth(rail: RailId, px: number) {
  widths[rail] = clamp(rail, px);
}

export function resetWidth(rail: RailId) {
  widths[rail] = RAIL_DEFAULTS[rail];
}

/** Test seam: drops every collapse back to open and every width back to its default. */
export function _reset() {
  for (const rail of Object.keys(state) as RailId[]) {
    state[rail] = false;
    widths[rail] = RAIL_DEFAULTS[rail];
  }
}
