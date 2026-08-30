// Playwright specs run under Node's own ESM loader, not Vite -- unlike the unit suite, they
// can't `import` data/*.json straight through src/data/data.ts (its raw JSON imports need an
// import attribute Node enforces outside a bundler). Read the shipped item table directly
// instead, so a spec can assert against an item's *current* name without hardcoding a literal
// that shipped data edits would silently outdate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data",
);

const items: {
  id: string;
  name: string;
  tags?: string[];
  hideFromPicker?: boolean;
}[] = JSON.parse(readFileSync(path.join(dataDir, "db-items.json"), "utf-8"));

/** The shipped item's own `name`, straight from data/db-items.json. */
export function shippedItemName(itemId: string): string {
  const item = items.find((i) => i.id === itemId);
  if (!item) throw new Error(`No shipped item with id "${itemId}"`);
  return item.name;
}

/**
 * The names a `tags` option selector would derive, in the order the app lists them --
 * `optionsFromItems`' rule: pickable items carrying the tag, sorted by name.
 */
export function shippedItemNamesByTag(tag: string): string[] {
  return items
    .filter((i) => !i.hideFromPicker && (i.tags ?? []).includes(tag))
    .map((i) => i.name)
    .sort((a, b) => a.localeCompare(b));
}
