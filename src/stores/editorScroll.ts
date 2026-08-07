// The Build editor's own scroll position. Selecting a layer swaps it out for the Layer
// editor, unmounting the scrollable element entirely; selecting a build again recreates it
// from scratch at scrollTop 0 unless something outside that element remembers where it was.
import { ref } from "vue";

export const buildScrollTop = ref(0);
