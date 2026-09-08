// "Show all fields" for the item form: whether ItemForm.vue offers every field group or only
// the ones the item's filter is authored with. Stored in storage.ts's `UiState`, whose write
// merges so this and stores/rails.ts don't clobber each other.
import { ref, watch } from "vue";
import * as storage from "../storage/storage";

const state = ref(storage.loadUiState().showAllItemFields ?? false);

watch(state, (value) => {
  storage.saveUiState({ showAllItemFields: value });
});

export const showAllFields = state;
