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

const vocabulary: {
  filters: Record<string, { label?: string }>;
  tags: Record<string, { label?: string }>;
} = JSON.parse(readFileSync(path.join(dataDir, "vocabulary.json"), "utf-8"));

const sections: {
  slots: { id: string; label?: string; filter?: string }[];
}[] = JSON.parse(
  readFileSync(path.join(dataDir, "slots.json"), "utf-8"),
).sections;

/** What a shipped slot's row is called, from data/slots.json, for the same reason
 *  `shippedItemName` exists. A slot without a label reads its category's, as the app does. */
export function shippedSlotLabel(slotId: string): string {
  const slot = sections
    .flatMap((section) => section.slots)
    .find((s) => s.id === slotId);
  if (!slot) throw new Error(`No shipped slot with id "${slotId}"`);
  const category = slot.filter ? vocabulary.filters[slot.filter] : undefined;
  return slot.label || category?.label || slot.id;
}

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

/** Any shipped tag that declares a label, so a spec about label display names none. */
export function shippedLabeledTag(): { id: string; label: string } {
  for (const [id, { label }] of Object.entries(vocabulary.tags)) {
    if (label) return { id, label };
  }
  throw new Error("No shipped tag declares a label");
}

/** The `filters` section of data/vocabulary.json, as written in the file. */
export function shippedFilters(): Record<string, unknown> {
  return vocabulary.filters;
}
