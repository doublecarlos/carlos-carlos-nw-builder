// Whether the landing screen stands in front of the builder.
//
// Two things raise it: a browser that arrived with nothing stored (bootstrap, at load) and
// deleting the last build (builds.ts). Selecting anything lowers it again -- every way into
// real content ends in a selection, so that is the one place the builder has to be revealed.
//
// It lives in its own store because the stores that raise it and the one that lowers it would
// otherwise have to import each other.
import { computed, ref } from "vue";

const _showing = ref(false);

export const showing = computed(() => _showing.value);

export function show() {
  _showing.value = true;
}

export function enterBuilder() {
  _showing.value = false;
}
