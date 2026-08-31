// Whether the landing screen stands in front of the builder.
//
// It stands for "this app holds nothing at all" -- no build anyone wrote, no layers, nothing
// in the trash. Two things raise it: a browser that arrived with nothing stored (bootstrap,
// at load) and purging the last thing left (builds.ts). A deletion never does, on its own:
// what it deletes is still in the trash, which this screen would cover along with the rest
// of the nav. Selecting anything lowers it again -- every way into real content ends in a
// selection, so that is the one place the builder has to be revealed.
//
// It lives in its own store because the store that raises it and the ones that lower or read
// it would otherwise have to import each other.
import { computed, ref } from "vue";

const _showing = ref(false);

export const showing = computed(() => _showing.value);

export function show() {
  _showing.value = true;
}

export function enterBuilder() {
  _showing.value = false;
}
