// The quick-compare picker: which other build to size the active one up against, and the two
// display toggles. Saved with the build (`build.compare`) -- so reopening a build remembers
// what it was being compared against -- but deliberately not undo-tracked.
import { computed } from "vue";
import * as builds from "./builds";
import type { BuildOption } from "../types";

export const compareOptions = computed<BuildOption[]>(() => [
  { value: "", label: "- none -" },
  ...builds.otherBuilds.value,
]);

export const compareBuild = computed(() => {
  const b = builds.build.value;
  if (!b) return null;
  const id = b.compare.id;
  if (!id || id === b.id) return null;
  return builds.builds.value.find((other) => other.id === id) ?? null;
});

export function setCompareBuild(id: string) {
  const b = builds.build.value;
  if (b) b.compare.id = id;
}

export function setCompareFlag(
  key: "highlight" | "onlyDiff" | "statLines",
  value: boolean,
) {
  const b = builds.build.value;
  if (b) b.compare[key] = value;
}
