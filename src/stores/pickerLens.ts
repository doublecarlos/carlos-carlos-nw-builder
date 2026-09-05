// The build editor's "show unavailable" lens: whether item pickers re-show the candidates they
// normally withhold (retired, wrong class, at their copy cap, or conflicting), each labelled
// with the reason it was withheld.
//
// A store rather than a BuildEditor ref because every picker in the tree reads it, and
// transient like the slot filter: it is a way of looking at the build, not a property of it,
// so it is neither saved with the build nor persisted across a reload.
import { ref } from "vue";

export const showHidden = ref(false);

export function toggle() {
  showHidden.value = !showHidden.value;
}
