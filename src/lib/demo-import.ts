// Turns one demo loadout into a Build plus its coverage report. Side-effect-free, so the whole
// resolve step is testable without a browser; the wizard only renders what this returns.
import * as storage from "../storage/storage";
import { itemPublishing } from "../data/db";
import { normalizeGroup, stableGroups } from "../engine/insignia";
import {
  GAME_IMPORT_DATA,
  classFromHclass,
  notInDemoSlotIds,
  placeBag,
  raceFromSpecies,
} from "./demo-slots";
import type { DemoCharacter, DemoItem, DemoLoadout } from "./demo-snapshot";
import type { Build, Db } from "../types";

export type SlotOutcome =
  | { kind: "imported"; slotId: string; gameId: string; itemId: string }
  | { kind: "unrecognized"; bag: string; slot: number; gameId: string }
  | { kind: "ignored"; bag: string; gameId: string; reason: string }
  | { kind: "overflow"; bag: string; gameId: string; itemId: string }
  /** App slot the demo has no counterpart for; the user fills it by hand. */
  | { kind: "notInDemo"; slotId: string };

export interface ImportReport {
  character: string;
  loadout: string;
  outcomes: SlotOutcome[];
  counts: Record<SlotOutcome["kind"], number>;
}

/** `Loadoutname` may be blank or junk, and callers still need a default build name. */
function loadoutLabel(loadout: DemoLoadout): string {
  return loadout.name.trim() ? loadout.name : `loadout ${loadout.index + 1}`;
}

/** Groups a loadout's items by bag, each sorted by `Islotidx`. Bags absent from
 *  game-import.json still appear, so a client update surfaces rather than being skipped. */
function groupByBag(items: DemoItem[]): Map<string, DemoItem[]> {
  const byBag = new Map<string, DemoItem[]>();
  for (const item of items) {
    const list = byBag.get(item.bag);
    if (list) list.push(item);
    else byBag.set(item.bag, [item]);
  }
  for (const list of byBag.values()) list.sort((a, b) => a.slot - b.slot);

  const known = GAME_IMPORT_DATA.bags.map((entry) => entry.bag);
  const extra = [...byBag.keys()].filter((bag) => !known.includes(bag)).sort();
  const ordered = new Map<string, DemoItem[]>();
  for (const bag of [...known, ...extra]) {
    const list = byBag.get(bag);
    if (list?.length) ordered.set(bag, list);
  }
  return ordered;
}

export function buildFromLoadout(
  character: DemoCharacter,
  loadout: DemoLoadout,
  db: Db,
  options?: { name?: string },
): { build: Build; report: ImportReport } {
  const label = loadoutLabel(loadout);
  const build = storage.defaultBuild(
    options?.name ?? `${character.name} - ${label}`,
  );

  // `hclassToClass` yields a bare class value; the class is a pick, so resolve it through
  // whichever item publishes that value.
  const gameClass = classFromHclass(character.gameClass);
  const classItem = gameClass
    ? itemPublishing(db, "class", gameClass)
    : undefined;
  if (classItem) build.choices["options.class"] = classItem;

  const race = raceFromSpecies(character.species);
  if (race) build.choices["raceLeveling.race"] = race;

  const outcomes: SlotOutcome[] = [];
  const occupied = new Set<string>();
  for (const [bag, items] of groupByBag(loadout.items)) {
    for (const result of placeBag(bag, items, db, occupied)) {
      if (result.kind === "imported")
        build.choices[result.slotId] = result.itemId;
      outcomes.push(result);
    }
  }

  // Writing choices directly skips the editor's actions, so the preferred swap `setChoice`
  // would have applied runs here instead, once the whole stable is placed.
  const swaps: Record<string, string> = {};
  for (const { group } of stableGroups(db)) {
    Object.assign(swaps, normalizeGroup(db, build, group));
  }
  for (const [slotId, itemId] of Object.entries(swaps)) {
    build.choices[slotId] = itemId;
    for (const outcome of outcomes) {
      if (outcome.kind === "imported" && outcome.slotId === slotId)
        outcome.itemId = itemId;
    }
  }

  // Last, so anything a bag actually placed keeps its slot.
  for (const [slotId, itemId] of Object.entries(
    GAME_IMPORT_DATA.defaultChoices,
  )) {
    if (!build.choices[slotId]) build.choices[slotId] = itemId;
  }

  const notInDemo = notInDemoSlotIds(db.slots);
  if (!classItem) notInDemo.push("options.class");
  if (!race) notInDemo.push("raceLeveling.race");
  for (const slotId of notInDemo) outcomes.push({ kind: "notInDemo", slotId });

  const counts: Record<SlotOutcome["kind"], number> = {
    imported: 0,
    unrecognized: 0,
    ignored: 0,
    overflow: 0,
    notInDemo: 0,
  };
  for (const outcome of outcomes) counts[outcome.kind] += 1;

  return {
    build,
    report: { character: character.name, loadout: label, outcomes, counts },
  };
}
