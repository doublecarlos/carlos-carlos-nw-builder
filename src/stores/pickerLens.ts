// The build editor's picker options: how much an item picker searches, how much each row
// shows, and whether the candidates normally withheld (retired, wrong class, at their copy cap,
// or conflicting) are re-shown with the reason they were withheld.
//
// A store rather than BuildEditor refs because every picker in the tree reads these, and
// transient like the slot filter: they are a way of looking at the build, not a property of it,
// so none is saved with the build or persisted across a reload.
import { ref } from "vue";

/** Match a query against an item's stats: schema labels, short forms and raw keys. */
export const searchByStat = ref(true);
/** Match a query against the names, part names and descriptions of an item's bonuses. */
export const searchByBonus = ref(true);
/** Match a query against the catalogue id, for a maintainer working from exported data. */
export const searchById = ref(false);
/** Re-show the candidates the slot's own filters withhold, each labelled with why. */
export const showHidden = ref(false);
/** Draw each row's stat and bonus preview lines, not just its name and item level. */
export const showPreview = ref(true);
/** Draw the muted "Potentially" line: bonuses the item contributes to but would not activate. */
export const showPotential = ref(true);

/** The menu's rows, in order: one entry per option, so adding another is a line here and a ref
 *  above rather than a second list the menu has to be kept in sync with. */
export const OPTIONS = [
  { key: "searchByStat", label: "Search items by stat", value: searchByStat },
  {
    key: "searchByBonus",
    label: "Search items by bonus",
    value: searchByBonus,
  },
  { key: "searchById", label: "Search items by id", value: searchById },
  { key: "showHidden", label: "Show unavailable items", value: showHidden },
  { key: "showPreview", label: "Show stat preview", value: showPreview },
  {
    key: "showPotential",
    label: "Show potential bonus stats",
    value: showPotential,
  },
] as const;

export function toggle(key: string) {
  const option = OPTIONS.find((o) => o.key === key);
  if (option) option.value.value = !option.value.value;
}
