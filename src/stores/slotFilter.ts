// What the build editor's slot list is filtered by.
//
// A store rather than BuildEditor's own refs because the filter has a second author: the
// Bonuses tab, in the other column, sets `need` when a near miss is clicked, and so does the
// hover card. The text and stat filters live here too: they are the same control to a user,
// cleared by the same button, and splitting them across a component and a store would only
// hide that.
//
// Not persisted: a filter is where you are right now, not a preference. It survives switching
// builds (the list it filters is the same shape either way) but not a reload.
import { computed, ref } from "vue";
import type { SupplyNeed } from "../types";

/** Free text, matched against slot label, section label, current choice and stat summary. */
export const text = ref("");

/** A stat key: keep only slots whose current choice grants it. */
export const stat = ref("");

/** Something the build lacks: keep only slots that could supply it (see lib/bonus-slots.ts). */
export const need = ref<SupplyNeed | null>(null);

/** How the need reads to the user, for the active-filter chip; an id alone reads as a slug. */
export const label = ref("");

export const isActive = computed(
  () => !!text.value.trim() || !!stat.value || !!need.value,
);

export function clear() {
  text.value = "";
  stat.value = "";
  clearNeed();
}

export function clearNeed() {
  need.value = null;
  label.value = "";
}

/**
 * Narrow the list to slots that could supply one need.
 *
 * Replaces any need already filtered on rather than adding to it: "show me where this comes
 * from" is a question about one thing at a time, and the text/stat filters are left alone so
 * a user who had already narrowed to a section keeps that narrowing.
 */
export function showSuppliersOf(wanted: SupplyNeed, wantedLabel: string) {
  need.value = wanted;
  label.value = wantedLabel;
}
