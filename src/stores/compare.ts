// The quick-compare picker: which other build to size the active one up against, and the two
// display toggles. Saved with the build (`build.compare`, storage.ts) rather than session
// state -- so reopening a build remembers what it was being compared against -- but
// deliberately not undo-tracked, so flipping a toggle never costs an undo step.
import { computed } from 'vue';
import * as library from './library';

export const compareOptions = computed(() => [
  { value: '', label: '— none —' },
  ...library.builds.value.filter((b) => b.id !== library.activeId.value).map((b) => ({ value: b.id, label: b.name })),
]);

export const compareBuild = computed(() => {
  const id = library.build.value.compare.id;
  if (!id || id === library.activeId.value) return null;
  return library.builds.value.find((b) => b.id === id) ?? null;
});

export function setCompareBuild(id: string) {
  library.activeBuildForEdit().compare.id = id;
}

export function setCompareFlag(key: 'highlight' | 'onlyDiff', value: boolean) {
  library.activeBuildForEdit().compare[key] = value;
}
