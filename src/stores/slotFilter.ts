// What the build editor's slot list is filtered by.
//
// A store rather than BuildEditor's own refs because the filter now has a second author: the
// Bonuses tab, in the other column, sets `bonusId` when a near miss is clicked. The text and
// stat filters live here too -- they are the same control to a user, cleared by the same
// button, and splitting them across a component and a store would only hide that.
//
// Not persisted: a filter is where you are right now, not a preference. It survives switching
// builds (the list it filters is the same shape either way) but not a reload.
import { computed, ref } from "vue";

/** Free text, matched against slot label, section label, current choice and stat summary. */
export const text = ref("");

/** A stat key: keep only slots whose current choice grants it. */
export const stat = ref("");

/** A bonus id: keep only slots that could supply it (see lib/bonus-slots.ts). */
export const bonusId = ref("");

/** The bonus's display name, for the active-filter chip -- the id alone reads as a slug. */
export const bonusLabel = ref("");

export const isActive = computed(
  () => !!text.value.trim() || !!stat.value || !!bonusId.value,
);

export function clear() {
  text.value = "";
  stat.value = "";
  clearBonus();
}

export function clearBonus() {
  bonusId.value = "";
  bonusLabel.value = "";
}

/**
 * Narrow the list to slots that could supply one bonus.
 *
 * Replaces any bonus already filtered on rather than adding to it: "show me where this comes
 * from" is a question about one bonus at a time, and the text/stat filters are left alone so a
 * user who had already narrowed to a section keeps that narrowing.
 */
export function showSuppliersOf(id: string, label: string) {
  bonusId.value = id;
  bonusLabel.value = label;
}
