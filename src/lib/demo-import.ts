// The pure function that turns one demo loadout into a Build, plus the coverage report that
// tells the user exactly what did and didn't come across. Side-effect-free -- no Vue, no
// stores, no IndexedDB -- so the whole resolve step is testable without a browser; the wizard
// (its own ticket) only renders what this returns and decides whether to commit it.
import * as storage from "../storage/storage";
import {
  GAME_BAGS,
  classFromHclass,
  notInDemoSlotIds,
  placeBag,
} from "./demo-slots";
import type { DemoCharacter, DemoItem, DemoLoadout } from "./demo-snapshot";
import type { Build, Db } from "../types";

export type SlotOutcome =
  /** Game item recognised and placed. */
  | { kind: "imported"; slotId: string; gameId: string; itemId: string }
  /** Game item present but no catalogue entry claims its `Hitem`. */
  | { kind: "unrecognised"; bag: string; slot: number; gameId: string }
  /** Bag is `notModelled` in game-bags.json -- ignored on purpose. */
  | { kind: "ignored"; bag: string; gameId: string; reason: string }
  /** Recognised, but every candidate app slot for its bag was already full. */
  | { kind: "overflow"; bag: string; gameId: string; itemId: string }
  /** App slot the demo has no counterpart for -- the user must fill it by hand. */
  | { kind: "notInDemo"; slotId: string };

export interface ImportReport {
  character: string;
  loadout: string;
  outcomes: SlotOutcome[];
  counts: Record<SlotOutcome["kind"], number>;
}

/** `Loadoutname` may be blank or unquoted junk (the sample has one literally "aaaaaa") --
 *  callers still want *something* to build a default build name from. */
function loadoutLabel(loadout: DemoLoadout): string {
  return loadout.name.trim() ? loadout.name : `loadout ${loadout.index + 1}`;
}

/** Groups a loadout's items by bag, each group sorted by `Islotidx` -- the order the
 *  placement rule applies within one bag. Bags absent from game-bags.json still appear (under
 *  their own name), sorted alphabetically after every known bag, so an unexpected client
 *  update surfaces as `unrecognised` rather than being silently skipped. */
function groupByBag(items: DemoItem[]): Map<string, DemoItem[]> {
  const byBag = new Map<string, DemoItem[]>();
  for (const item of items) {
    const list = byBag.get(item.bag);
    if (list) list.push(item);
    else byBag.set(item.bag, [item]);
  }
  for (const list of byBag.values()) list.sort((a, b) => a.slot - b.slot);

  const known = GAME_BAGS.bags.map((entry) => entry.bag);
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
    options?.name ?? `${character.name} — ${label}`,
  );

  const gameClass = classFromHclass(character.gameClass);
  if (gameClass) build.context.class = gameClass;

  const outcomes: SlotOutcome[] = [];
  const occupied = new Set<string>();
  for (const [bag, items] of groupByBag(loadout.items)) {
    for (const result of placeBag(bag, items, db, occupied)) {
      if (result.kind === "imported")
        build.choices[result.slotId] = result.itemId;
      outcomes.push(result);
    }
  }

  const notInDemo = notInDemoSlotIds(db.slots);
  if (!gameClass) notInDemo.push("options.class");
  for (const slotId of notInDemo) outcomes.push({ kind: "notInDemo", slotId });

  const counts: Record<SlotOutcome["kind"], number> = {
    imported: 0,
    unrecognised: 0,
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
