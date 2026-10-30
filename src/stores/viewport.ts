// Which layout the viewport calls for, as reactive flags every component reads instead of
// writing its own media query.
//
// The widths are Tailwind's default `md`/`lg` breakpoints, so a flag here and an `md:`/`lg:`
// utility in a template always switch at the same width. The queries use the same range syntax
// as Tailwind's own `lg:`/`max-md:` variants, so neither side is off by a fractional pixel.
//
// - Desktop (>= lg): the three-column layout with resizable rails.
// - Tablet (md..lg): nav as an overlay drawer, editor and stats side by side.
// - Phone (< md): a single pane at a time.
//
// Coarse pointer is independent of width: a touch laptop is desktop *and* coarse.
import { computed } from "vue";
import { useMediaQuery } from "@vueuse/core";

/** Breakpoint widths, matching Tailwind's `md` and `lg`. */
export const BREAKPOINTS = {
  md: "48rem",
  lg: "64rem",
} as const;

export const QUERIES = {
  desktop: `(width >= ${BREAKPOINTS.lg})`,
  phone: `(width < ${BREAKPOINTS.md})`,
  coarsePointer: "(pointer: coarse)",
} as const;

/** Wide enough for the three-column layout. */
export const isDesktop = useMediaQuery(QUERIES.desktop);

/** Narrower than `md`: one pane at a time. */
export const isPhone = useMediaQuery(QUERIES.phone);

/** The primary pointer is a finger, at whatever width. */
export const coarsePointer = useMediaQuery(QUERIES.coarsePointer);

/** Where the browser's Back closes an open overlay before it leaves the page: the narrow
 *  layouts, and any touch screen, whose users reach for Back to dismiss things. A desktop with
 *  a mouse keeps Back as plain navigation. */
export const backClosesOverlays = computed(
  () => !isDesktop.value || coarsePointer.value,
);
