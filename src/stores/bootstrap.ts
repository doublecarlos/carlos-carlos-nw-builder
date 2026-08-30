// One-shot hydrate: loads everything from IDB, fills the stores, applies the URL route,
// then drops the loading flag. Called once by main.ts before the app mounts.
import * as storage from "../storage/storage";
import * as router from "../lib/router";
import * as builds from "./builds";
import * as folders from "./folders";
import * as history from "./history";
import * as landing from "./landing";
import * as layers from "./layers";
import { flagStorageFailed } from "./notice";
import * as selection from "./selection";
import * as trash from "./trash";

type LoadedState = Awaited<ReturnType<typeof storage.loadAll>>;

/** What a browser with nothing stored loads as. The failure path below reuses it so there is
 *  one way for the app to start empty, not two. */
const emptyState = (): LoadedState => ({
  builds: [],
  layers: [],
  meta: { buildOrder: [], folders: [], layerOrder: [], lastSelection: null },
  trash: [],
  history: new Map(),
});

/** Must not reject: this runs before the app is mounted, so anything thrown here leaves the
 *  page on index.html's boot screen with no way forward. A browser that refuses IndexedDB
 *  gets an empty, in-memory builder instead. */
async function load(): Promise<LoadedState> {
  try {
    return await storage.loadAll();
  } catch (error: unknown) {
    console.warn("This browser's storage is unavailable:", error);
    flagStorageFailed(
      "Could not open this browser's storage - nothing will be saved. Use Export to keep a copy.",
    );
    return emptyState();
  }
}

export async function hydrate() {
  const data = await load();

  // Asked here, of the raw load, rather than of the builds store: that store keeps one build
  // alive at all times, so by the first render there is always a "Build 1" and an emptiness
  // question asked any later always answers no.
  if (data.builds.length === 0 && data.layers.length === 0) landing.show();

  const buildsMap = new Map(data.builds.map((b) => [b.id, b]));
  folders._init(data.meta.folders);
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
