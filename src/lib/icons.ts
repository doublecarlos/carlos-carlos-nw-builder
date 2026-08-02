// Shared lucide glyph registry. Each glyph is a real lucide SVG file under assets/icons,
// imported with `?raw` so Vite inlines the markup as a string (no runtime fetch, no separate
// asset request) and Rollup only bundles the files actually imported below -- an asset dropped
// into assets/icons but never listed here (e.g. save.svg, save-all.svg) never reaches the
// output. BaseIcon.vue is the only component that renders these; IconButton wraps BaseIcon.vue rather
// than each call site drawing its own <svg>.
import arrowUp from "../assets/icons/arrow-up.svg?raw";
import arrowDown from "../assets/icons/arrow-down.svg?raw";
import copy from "../assets/icons/copy.svg?raw";
import plus from "../assets/icons/plus.svg?raw";
import circlePlus from "../assets/icons/circle-plus.svg?raw";
import ampersand from "../assets/icons/ampersand.svg?raw";
import split from "../assets/icons/split.svg?raw";
import circleAlert from "../assets/icons/circle-alert.svg?raw";
import trash from "../assets/icons/trash.svg?raw";
import wandSparkles from "../assets/icons/wand-sparkles.svg?raw";
import undo2 from "../assets/icons/undo-2.svg?raw";
import redo2 from "../assets/icons/redo-2.svg?raw";

// lucide files ship as a full <svg ...>...</svg> document; BaseIcon.vue supplies its own <svg>
// wrapper (so it can size/style it and add a <title>), so only the inner markup is kept here.
const inner = (svg: string) =>
  svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

export const icons: Record<string, string> = {
  "arrow-up": inner(arrowUp),
  "arrow-down": inner(arrowDown),
  copy: inner(copy),
  plus: inner(plus),
  "circle-plus": inner(circlePlus),
  ampersand: inner(ampersand),
  split: inner(split),
  "circle-alert": inner(circleAlert),
  trash: inner(trash),
  "wand-sparkles": inner(wandSparkles),
  "undo-2": inner(undo2),
  "redo-2": inner(redo2),
};
