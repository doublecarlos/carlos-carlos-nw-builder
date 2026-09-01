// Opt-in flag for the maintainer-only export tabs in LayerExportModal -- the composed
// db-items.json / db-bonuses.json / slots.json files. Those only mean anything with the
// source repo on hand, so they stay hidden until someone asks for them, either from the
// About dialog or by loading the app once with `?maintainer=1`.
//
// A stored preference rather than `import.meta.env.DEV`: the code behind those tabs is
// already a dynamic import, so a production build that ships it costs a reader who never
// turns this on nothing but the three tab buttons this flag hides.
import { useStorage } from "@vueuse/core";
import * as router from "../lib/router";

/** Defaults on in a dev build and off in a shipped one: working on the data files is the
 *  point of running this locally, so a fresh dev profile should not have to opt in first.
 *  Only the default differs -- once set either way, the stored value is what counts. */
export const enabled = useStorage("nw:maintainer", import.meta.env.DEV);

export function setEnabled(value: boolean) {
  enabled.value = value;
}

/**
 * Applies `?maintainer=` once at boot, then drops the key back out of the URL.
 *
 * The param only ever seeds the stored flag: leaving it in the query string would make
 * `router.apply`'s merge carry it onto every later navigation, and would re-enable the tabs
 * on every reload of a link someone had pasted around.
 */
export function initMaintainer() {
  const value = router.parse().maintainer;
  if (value === undefined) return;
  enabled.value = value !== "0" && value !== "false";
  router.apply({ maintainer: null }, { push: false });
}
