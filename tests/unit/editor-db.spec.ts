// The layer editor reuses the engine's catalog when the layer under edit already folds last,
// and composes its own otherwise, so a disabled or lower layer still sees its own entries.
import { describe, it, expect, vi } from "vitest";
import * as catalog from "../../src/data/catalog";
import { editorDb } from "../../src/lib/editor-db";
import type { CatalogOverlay, Db, Item } from "../../src/types";

const item = (id: string, name: string): Item => ({
  id,
  name,
  filter: "gear_ring",
});

const overlayWith = (...items: Item[]): CatalogOverlay => ({
  ...catalog.emptyOverlay(),
  items: Object.fromEntries(items.map((entry) => [entry.id, entry])),
});

describe("editorDb", () => {
  const lower = overlayWith(item("zzz_shared", "Lower Ring"));
  const top = overlayWith(
    item("zzz_shared", "Top Ring"),
    item("zzz_top_only", "Top Only Ring"),
  );

  it("returns the engine catalog when the edited layer is enabled and on top", () => {
    const engineOverlays = [lower, top];
    const engineDb = catalog.makeDb(engineOverlays);
    const getEngineDb = vi.fn(() => engineDb);

    const db = editorDb(engineOverlays, getEngineDb, top);

    expect(db).toBe(engineDb);
    expect(getEngineDb).toHaveBeenCalledOnce();
    expect(db.get("zzz_top_only")?.name).toBe("Top Only Ring");
  });

  it("folds a lower-priority layer last without reading the engine catalog", () => {
    const getEngineDb = vi.fn((): Db => catalog.makeDb([lower, top]));

    const db = editorDb([lower, top], getEngineDb, lower);

    expect(getEngineDb).not.toHaveBeenCalled();
    expect(db.get("zzz_shared")?.name).toBe("Lower Ring");
    expect(db.get("zzz_top_only")?.name).toBe("Top Only Ring");
  });

  it("folds a disabled layer last even though the engine leaves it out", () => {
    const getEngineDb = vi.fn((): Db => catalog.makeDb([lower]));

    const db = editorDb([lower], getEngineDb, top);

    expect(getEngineDb).not.toHaveBeenCalled();
    expect(db.get("zzz_shared")?.name).toBe("Top Ring");
  });

  it("composes the edited layer alone when no layer is enabled", () => {
    const db = editorDb([], () => catalog.makeDb([]), top);

    expect(db.get("zzz_top_only")?.name).toBe("Top Only Ring");
  });
});
