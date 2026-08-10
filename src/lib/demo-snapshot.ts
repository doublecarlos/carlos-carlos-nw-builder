// Turns the generic node tree from demo-format.ts into a game-domain, app-agnostic snapshot:
// characters, their saved loadouts, and the items equipped in each. Knows about Neverwinter
// (bags, loadouts, classes) but nothing about this app's slots, catalogue or `Build` shape --
// that's demo-import.ts's job.
import { child, childrenOf, scalar, type DemoNode } from "./demo-format";

export interface DemoItem {
  /** `Ebagid` verbatim, e.g. "Head", "OffenseGem", "MountEquippedActiveSlots". */
  bag: string;
  /** `Islotidx`, defaulting to 0 when absent. */
  slot: number;
  /** `Hitem` -- the stable game identifier. Null for an empty slot. */
  gameId: string | null;
  /** `Iitemid` as a string (64-bit, must not become a JS number). Per-character
   *  inventory id; only useful for the active-loadout join below. */
  inventoryId: string | null;
  /** `Hslotteditem` of each nested `Pploadoutgems`, in file order. Insignia on a mount. */
  gems: string[];
}

export interface DemoLoadout {
  /** `Loadoutname`. May be unquoted junk ("aaaaaa") -- do not assume it is meaningful. */
  name: string;
  /** Position in the file, 0-based. The file order is not the in-game display order. */
  index: number;
  items: DemoItem[];
  /** True for the loadout whose items match the character's currently-equipped set. */
  active: boolean;
  /** `Ilastsavetime` / `Ilastloadtime`, or null. Game clock, not a Unix epoch. */
  savedAt: number | null;
  loadedAt: number | null;
}

export interface DemoCharacter {
  /** `Savedname`. */
  name: string;
  /** `Hclass`, e.g. "Player_Bard". */
  gameClass: string | null;
  /** `Costumev5/Peffectivecostume/Species`, e.g. "Aasimar_Male" -- gender suffix and all. */
  species: string | null;
  loadouts: DemoLoadout[];
}

export interface DemoSnapshot {
  characters: DemoCharacter[];
}

function toNumberOrNull(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readItem(node: DemoNode): DemoItem {
  return {
    bag: scalar(node, "Ebagid") ?? "",
    slot: toNumberOrNull(scalar(node, "Islotidx")) ?? 0,
    gameId: scalar(node, "Hitem"),
    inventoryId: scalar(node, "Iitemid"),
    gems: childrenOf(node, "Pploadoutgems")
      .map((gem) => scalar(gem, "Hslotteditem"))
      .filter((id): id is string => id != null),
  };
}

function readLoadout(node: DemoNode, index: number): DemoLoadout {
  return {
    name: scalar(node, "Loadoutname") ?? "",
    index,
    items: childrenOf(node, "Pploadoutitems").map(readItem),
    active: false, // resolved by readCharacter once every loadout in the file is known
    savedAt: toNumberOrNull(scalar(node, "Ilastsavetime")),
    loadedAt: toNumberOrNull(scalar(node, "Ilastloadtime")),
  };
}

/** `Ppbuilds` is not directly importable -- its `Ppitems` carry only `Ulitemid` (inventory
 *  ids), never `Hitem`. Its only value is this join: the loadout whose items' `Iitemid`s
 *  overlap it the most is the active one. Best-overlap rather than exact-set-equality so one
 *  stale/missing slot doesn't silently mark every loadout inactive; a tied best score (or no
 *  overlap at all) resolves to "no active loadout" rather than guessing. */
function findActiveLoadoutIndex(
  ppbuilds: DemoNode | null,
  loadouts: DemoLoadout[],
): number {
  if (!ppbuilds) return -1;
  const equipped = new Set(
    childrenOf(ppbuilds, "Ppitems")
      .map((item) => scalar(item, "Ulitemid"))
      .filter((id): id is string => id != null),
  );
  if (equipped.size === 0) return -1;

  let bestIndex = -1;
  let bestScore = 0;
  let tied = false;
  loadouts.forEach((loadout, index) => {
    const score = loadout.items.filter(
      (item) => item.inventoryId != null && equipped.has(item.inventoryId),
    ).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
      tied = false;
    } else if (score > 0 && score === bestScore) {
      tied = true;
    }
  });
  return tied ? -1 : bestIndex;
}

/** `Peffectivecostume`'s own scalar value is unreliable (a quoted display name in one
 *  recording, an unquoted preset token in another) -- always read the nested `Species` key.
 *  Guarded by `Costumetype === "Player"` so a structural surprise (e.g. this ever matching a
 *  summoned companion's own `Costumev5`) can't leak a companion's race onto the player. */
function readSpecies(entity: DemoNode): string | null {
  const costumev5 = child(entity, "Costumev5");
  const peffectivecostume = costumev5
    ? child(costumev5, "Peffectivecostume")
    : null;
  if (!peffectivecostume) return null;
  if (scalar(peffectivecostume, "Costumetype") !== "Player") return null;
  return scalar(peffectivecostume, "Species");
}

function readCharacter(
  entity: DemoNode,
  entityAttach: DemoNode,
): DemoCharacter {
  const ppbuilds = child(entityAttach, "Ppbuilds");
  const pentityloadouts = child(entityAttach, "Pentityloadouts");
  const loadouts = pentityloadouts
    ? childrenOf(pentityloadouts, "Ppentityloadouts").map(readLoadout)
    : [];

  const activeIndex = findActiveLoadoutIndex(ppbuilds, loadouts);
  if (activeIndex >= 0) loadouts[activeIndex].active = true;

  return {
    name: scalar(entityAttach, "Savedname") ?? "",
    gameClass: ppbuilds ? scalar(ppbuilds, "Hclass") : null,
    species: readSpecies(entity),
    loadouts,
  };
}

export function readSnapshot(root: DemoNode): DemoSnapshot {
  const activePlayerRef = scalar(root, "Activeplayerref");
  const packets = child(root, "Packets");
  const createdents = packets ? childrenOf(packets, "Createdents") : [];

  const entries: { character: DemoCharacter; isActivePlayer: boolean }[] = [];
  for (const entity of createdents) {
    const entityAttach = child(entity, "EntityAttach");
    // Not every entity in the zone is a player with saved loadouts -- only those qualify.
    if (!entityAttach || !child(entityAttach, "Pentityloadouts")) continue;
    entries.push({
      character: readCharacter(entity, entityAttach),
      isActivePlayer:
        activePlayerRef != null &&
        scalar(entity, "EntityRef") === activePlayerRef,
    });
  }

  // Array#sort is stable, so this only ever promotes the active player to the front and
  // otherwise leaves file order untouched.
  entries.sort((a, b) => Number(b.isActivePlayer) - Number(a.isActivePlayer));

  return { characters: entries.map((e) => e.character) };
}
