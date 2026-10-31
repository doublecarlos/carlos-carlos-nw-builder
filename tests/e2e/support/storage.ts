// Reads back what the app wrote to IndexedDB, so a spec can wait for a write to land before a
// reload instead of sleeping past the save debounce.
import type { Page } from "@playwright/test";
import type { AppMeta, Build } from "../../../src/types";

type StoreName = "builds" | "layers" | "meta";

/** Every record in one of the app's stores, unwrapped from its envelope. Call only after the
 *  app has booted: the read never creates the database itself. */
export function storedRecords<T>(page: Page, store: StoreName): Promise<T[]> {
  return page.evaluate(
    (store) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open("nw");
        // A database the app has not created yet stays uncreated.
        open.onupgradeneeded = () => open.transaction?.abort();
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => {
            db.close();
            resolve(
              (request.result as Record<string, unknown>[]).map((r) =>
                "v" in r && "data" in r ? (r.data as T) : (r as T),
              ),
            );
          };
          request.onerror = () => {
            db.close();
            reject(request.error ?? new Error("IndexedDB read failed"));
          };
        };
      }),
    store,
  );
}

/** The stored sidebar order and folders, or undefined before the first write. */
export async function storedMeta(page: Page): Promise<AppMeta | undefined> {
  const [meta] = await storedRecords<AppMeta>(page, "meta");
  return meta;
}

export function storedBuilds(page: Page): Promise<Build[]> {
  return storedRecords<Build>(page, "builds");
}

/** Top-level sidebar rows as stored, by build or folder name. */
export async function storedBuildOrder(page: Page): Promise<string[]> {
  const [meta, builds] = await Promise.all([
    storedMeta(page),
    storedBuilds(page),
  ]);
  const names = new Map<string, string>([
    ...builds.map((b) => [b.id, b.name] as const),
    ...(meta?.folders ?? []).map((f) => [f.id, f.name] as const),
  ]);
  return (meta?.buildOrder ?? []).map((id) => names.get(id) ?? id);
}
