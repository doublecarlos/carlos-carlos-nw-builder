// One-shot hydrate: loads everything from IDB, fills the stores, applies the URL route,
// then drops the loading flag. Called once by main.ts before the app mounts.
import * as storage from "../storage/storage";
import * as router from "../lib/router";
import * as builds from "./builds";
import * as history from "./history";
import * as landing from "./landing";
import * as layers from "./layers";
import * as selection from "./selection";
import * as trash from "./trash";

export async function hydrate() {
  const data = await storage.loadAll();

  // Asked here, of the raw load, rather than of the builds store: that store keeps one build
  // alive at all times, so by the first render there is always a "Build 1" and an emptiness
  // question asked any later always answers no.
  if (data.builds.length === 0 && data.layers.length === 0) landing.show();

  const buildsMap = new Map(data.builds.map((b) => [b.id, b]));
  builds._init(buildsMap, data.meta.buildOrder);

  const layersMap = new Map(data.layers.map((l) => [l.id, l]));
  layers._init(layersMap, data.meta.layerOrder);

  trash._init(data.trash);

  history._init(data.history);

  // Determine initial selection: URL overrides meta, meta overrides first-build fallback.
  const route = router.parse();
  if (route.build && buildsMap.has(route.build)) {
    selection._restoreFromRoute(route.build, undefined);
  } else if (route.layer && layersMap.has(route.layer)) {
    selection._restoreFromRoute(undefined, route.layer);
  } else if (data.meta.lastSelection) {
    selection._restoreFromMeta(data.meta.lastSelection);
  } else if (data.meta.buildOrder.length > 0) {
    selection._restoreFromMeta({
      kind: "build",
      id: data.meta.buildOrder[0],
    });
  }

  builds._setLoading(false);
  layers._setLoading(false);
  history._setLoading(false);
}
