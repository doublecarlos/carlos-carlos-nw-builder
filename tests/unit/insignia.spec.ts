// The stable resolver. Fixtures are authored here rather than read off the shipped catalogue:
// these are rules about how the pieces fit, not facts about current data.
import { describe, it, expect } from "vitest";
import * as db from "../../src/data/db";
import * as insignia from "../../src/engine/insignia";
import * as catalog from "../../src/data/catalog";
import { resolveBuild as engineRun } from "../../src/engine/engine";
import { defaultBuild } from "../../src/storage/storage";
import { NW_SLOTS } from "../../src/data/data";
import type {
  Build,
  Item,
  Schema,
  Slot,
  SlotsData,
  StableSlotRef,
} from "../../src/types";

const schema: Schema = {
  stats: [{ key: "il", label: "Item Level", kind: "flat" }],
  statByKey: { il: { key: "il", label: "Item Level", kind: "flat" } },
  statKeys: ["il"],
  multiplicativeStats: [],
  ratingStats: [],
  abilityStats: [],
  ratingConversion: [],
  abilityContributions: [],
  forteSplit: {},
  roles: { dps: { label: "DPS", hpBonus: 1, damageBonus: 1 } },
  statScalers: [],
};

const picker = (id: string, filter: string, stable?: StableSlotRef): Slot => ({
  id,
  label: id,
  section: "insignia",
  type: "item_picker",
  filter,
  ...(stable ? { stable } : {}),
});

const GROUPS = [1, 2, 3, 4, 5];
const PER_GROUP = 4;

/** Slot ids deliberately unlike the shipped ones, which is what proves the resolver finds
 * these rows through `stable` rather than by name. */
const slots: SlotsData = {
  sections: [{ id: "insignia", label: "Insignia" }],
  slots: GROUPS.flatMap((g) => [
    picker(`g${g}.steed`, "mount", { group: g, role: "mount" }),
    ...Array.from({ length: PER_GROUP }, (_, i) =>
      picker(`g${g}.gem-${i + 1}`, "insignia", {
        group: g,
        role: "insignia",
        index: i + 1,
      }),
    ),
    picker(`g${g}.set-bonus`, "insignia_bonus", { group: g, role: "bonus" }),
  ]),
  filterDefaults: { insignia_bonus: { maxCopies: 2 } },
};

const fixed = (shape: string) => ({ shape });
const universal = (preferred?: string) =>
  preferred ? { universal: true, preferred } : { universal: true };

/** One insignia pair per shape, so a slot always has something legal to hold. */
const insigniaItems: Item[] = ["barbed", "crescent", "enlightened", "regal"]
  .flatMap((shape) => [
    {
      id: shape,
      name: shape,
      filter: "insignia",
      insigniaShape: shape,
      preferredVariant: `${shape}-pref`,
      il: 750,
    },
    {
      id: `${shape}-pref`,
      name: `${shape} (Pref)`,
      filter: "insignia",
      insigniaShape: shape,
      il: 900,
    },
  ])
  .map((item) => item as Item);

const items: Item[] = [
  ...insigniaItems,
  // Two fixed slots, one plain universal, one universal preferring enlightened.
  {
    id: "fixed-mount",
    name: "Fixed Mount",
    filter: "mount",
    insigniaSlots: [
      fixed("crescent"),
      fixed("regal"),
      universal(),
      universal("enlightened"),
    ],
  },
  // Prefers a shape one of its own fixed slots already consumes.
  {
    id: "greedy-mount",
    name: "Greedy Mount",
    filter: "mount",
    insigniaSlots: [
      fixed("crescent"),
      fixed("regal"),
      universal(),
      universal("regal"),
    ],
  },
  {
    id: "four-bonus",
    name: "Four Bonus",
    filter: "insignia_bonus",
    insigniaRecipe: ["crescent", "regal", "barbed", "enlightened"],
  },
  {
    id: "three-bonus",
    name: "Three Bonus",
    filter: "insignia_bonus",
    insigniaRecipe: ["crescent", "regal", "barbed"],
  },
  {
    id: "other-bonus",
    name: "Other Bonus",
    filter: "insignia_bonus",
    insigniaRecipe: ["barbed", "barbed", "barbed", "barbed"],
  },
  // Two universal slots preferring the same shape, and a recipe holding two of it.
  {
    id: "twice-preferred-mount",
    name: "Twice Preferred Mount",
    filter: "mount",
    insigniaSlots: [
      fixed("crescent"),
      universal("regal"),
      universal("regal"),
      universal(),
    ],
  },
  {
    id: "two-regal-bonus",
    name: "Two Regal Bonus",
    filter: "insignia_bonus",
    insigniaRecipe: ["crescent", "regal", "regal", "enlightened"],
  },
  // Grubshank the Burdened: its fourth slot's preferred shape completes no four-shape recipe.
  {
    id: "spare-preferred-mount",
    name: "Spare Preferred Mount",
    filter: "mount",
    insigniaSlots: [
      fixed("crescent"),
      fixed("regal"),
      universal(),
      universal("regal"),
    ],
  },
  // The opposite: its fourth slot only takes the shape that would displace the bonus.
  {
    id: "blocked-spare-mount",
    name: "Blocked Spare Mount",
    filter: "mount",
    insigniaSlots: [
      fixed("crescent"),
      fixed("regal"),
      universal(),
      fixed("enlightened"),
    ],
  },
];

const made = db.build(items, [], schema, slots);

/** Slot ids by role, resolved through the db exactly as the app resolves them. */
const mountSlot = (group: number) => insignia.mountSlotId(made, group)!;
const bonusSlot = (group: number) => insignia.bonusSlotId(made, group)!;
const insigniaSlot = (group: number, index: number) =>
  insignia.insigniaSlotIds(made, group)[index - 1];

function testBuild(choices: Record<string, string>): Build {
  return {
    id: "b",
    name: "b",
    choices,
    values: {},
    assignments: {},
    occurrenceInputs: {},
    listRows: {},
    context: {
      class: "",
      role: "",
      damageType: "",
      duration: 0,
      enemies: 0,
      magnitude: 0,
      m32Forte: false,
      mountBolster: 1,
      companionBolster: 1,
      forte: {},
      toggles: {},
    },
    compare: { id: "", highlight: false, onlyDiff: false, statLines: false },
  };
}

/** One group's four insignia, by shape id, plus an optional mount. */
function group(
  n: number,
  shapes: (string | null)[],
  mount?: string,
): Record<string, string> {
  const choices: Record<string, string> = {};
  if (mount) choices[mountSlot(n)] = mount;
  shapes.forEach((shape, i) => {
    if (shape) choices[insigniaSlot(n, i + 1)] = shape;
  });
  return choices;
}

describe("matching a bonus", () => {
  it("matches four shapes regardless of the order they sit in", () => {
    const forwards = insignia.matchBonus(made, [
      "crescent",
      "regal",
      "barbed",
      "enlightened",
    ]);
    const shuffled = insignia.matchBonus(made, [
      "enlightened",
      "barbed",
      "crescent",
      "regal",
    ]);
    expect(forwards?.id).toBe("four-bonus");
    expect(shuffled?.id).toBe("four-bonus");
  });

  it("prefers a four-shape recipe over the three-shape one its first three would match", () => {
    // The first three are exactly `three-bonus`, but all four complete `four-bonus`.
    expect(
      insignia.matchBonus(made, ["crescent", "regal", "barbed", "enlightened"])
        ?.id,
    ).toBe("four-bonus");
  });

  it("falls back to the three-shape recipe when the fourth slot is empty", () => {
    expect(
      insignia.matchBonus(made, ["crescent", "regal", "barbed", undefined])?.id,
    ).toBe("three-bonus");
  });

  it("matches nothing when a hole sits in the first three", () => {
    expect(
      insignia.matchBonus(made, ["crescent", undefined, "barbed", "regal"]),
    ).toBeNull();
  });

  it("counts a repeated shape as separate occurrences", () => {
    expect(
      insignia.matchBonus(made, ["barbed", "barbed", "barbed", "barbed"])?.id,
    ).toBe("other-bonus");
    // Three barbed and a crescent is not the same multiset.
    expect(
      insignia.matchBonus(made, ["barbed", "barbed", "barbed", "crescent"]),
    ).toBeNull();
  });
});

describe("preferred slots", () => {
  it("only a universal slot whose preference is met counts", () => {
    const build = testBuild(
      group(1, ["crescent", "regal", "barbed", "enlightened"], "fixed-mount"),
    );
    expect(insignia.readGroup(made, build, 1).preferred).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("a fixed slot never counts, however well the shape matches", () => {
    // Slot 2 is fixed to regal and holds regal: a requirement met, not a preference.
    const build = testBuild(
      group(1, ["crescent", "regal", "barbed", "barbed"], "fixed-mount"),
    );
    expect(insignia.readGroup(made, build, 1).preferred).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("no slot is preferred while the group has no mount", () => {
    const build = testBuild(
      group(1, ["crescent", "regal", "barbed", "enlightened"]),
    );
    const state = insignia.readGroup(made, build, 1);
    expect(state.mount).toBeNull();
    expect(state.preferred).toEqual([false, false, false, false]);
    // The bonus is still worked out: only the preference needs a mount to exist.
    expect(state.bonus?.id).toBe("four-bonus");
  });

  it("cannot reach preferred when a fixed slot already consumed the preferred shape", () => {
    // Slot 4 prefers regal, but `four-bonus` holds one regal and slot 2 requires it. The
    // Brain Stealer Dragon case.
    const greedy = made.get("greedy-mount")!;
    const four = made.get("four-bonus")!;
    expect(insignia.bestArrangement(made, greedy, four)?.preferred).toBe(0);
    const fixedMount = made.get("fixed-mount")!;
    expect(insignia.bestArrangement(made, fixedMount, four)?.preferred).toBe(1);
  });
});

describe("the ordinary and (Pref) pairing", () => {
  it("upgrades the insignia sitting in a preferred slot and leaves the others alone", () => {
    const build = testBuild(
      group(1, ["crescent", "regal", "barbed", "enlightened"], "fixed-mount"),
    );
    expect(insignia.normaliseGroup(made, build, 1)).toEqual({
      [insigniaSlot(1, 4)]: "enlightened-pref",
    });
  });

  it("downgrades a (Pref) insignia whose slot does not prefer it", () => {
    const build = testBuild(
      group(
        1,
        ["crescent", "regal", "barbed-pref", "enlightened"],
        "fixed-mount",
      ),
    );
    const changes = insignia.normaliseGroup(made, build, 1);
    expect(changes[insigniaSlot(1, 3)]).toBe("barbed");
  });

  it("leaves every slot alone once each already holds the right half", () => {
    const build = testBuild(
      group(
        1,
        ["crescent", "regal", "barbed", "enlightened-pref"],
        "fixed-mount",
      ),
    );
    expect(insignia.normaliseGroup(made, build, 1)).toEqual({});
  });
});

describe("describing a slot", () => {
  it("says what each kind of slot takes", () => {
    const specs = made.get("fixed-mount")!.insigniaSlots!;
    // The game's vocabulary: a fixed slot is named by its shape.
    expect(specs.map(insignia.describeSlotSpec)).toEqual([
      "crescent",
      "regal",
      "universal",
      "universal, prefers enlightened",
    ]);
  });
});

describe("counting preferred slots", () => {
  it("counts every preference a combination meets, not just that one was", () => {
    // Crimson Crystal Horse taking Predator's Instinct: two preferences met, not one.
    const mount = made.get("twice-preferred-mount")!;
    const bonus = made.get("two-regal-bonus")!;
    expect(insignia.bestArrangement(made, mount, bonus)?.preferred).toBe(2);
    expect(
      insignia.mountsFor(made, bonus).find((r) => r.mount.id === mount.id)
        ?.preferred,
    ).toBe(2);
  });
});

describe("what the picker offers", () => {
  /** Ids the picker would actually list for one slot, withheld ones dropped. */
  const offered = (build: Build, slot: number) =>
    db
      .slotCandidates(made, insigniaSlot(1, slot), build)
      .filter((c) => !c.hidden)
      .map((c) => c.item.id)
      .sort();

  it("offers every shape and both halves while the group has no mount", () => {
    const build = testBuild(group(1, []));
    expect(offered(build, 1)).toEqual([
      "barbed",
      "barbed-pref",
      "crescent",
      "crescent-pref",
      "enlightened",
      "enlightened-pref",
      "regal",
      "regal-pref",
    ]);
  });

  it("narrows a fixed slot to the one shape it takes, ordinary half only", () => {
    const build = testBuild(group(1, [], "fixed-mount"));
    expect(offered(build, 1)).toEqual(["crescent"]);
  });

  it("offers only the upgraded half in a slot that prefers that shape", () => {
    const build = testBuild(group(1, [], "fixed-mount"));
    // Slot 4 prefers enlightened, so enlightened comes upgraded and every other shape does not.
    expect(offered(build, 4)).toEqual([
      "barbed",
      "crescent",
      "enlightened-pref",
      "regal",
    ]);
  });

  it("offers only ordinary halves in a universal slot with no preference", () => {
    const build = testBuild(group(1, [], "fixed-mount"));
    expect(offered(build, 3)).toEqual([
      "barbed",
      "crescent",
      "enlightened",
      "regal",
    ]);
  });

  it("still offers what the slot already holds, however wrong it now is", () => {
    // A mount swapped under an existing pick must not strand it.
    const build = testBuild(group(1, ["barbed"], "fixed-mount"));
    expect(offered(build, 1)).toEqual(["barbed", "crescent"]);
  });
});

describe("what a slot accepts", () => {
  it("a fixed slot takes its own shape only, a universal one takes anything", () => {
    const build = testBuild(group(1, [], "fixed-mount"));
    const first = insignia.specForSlot(made, build, insigniaSlot(1, 1));
    expect(insignia.slotAccepts(first, "crescent")).toBe(true);
    expect(insignia.slotAccepts(first, "barbed")).toBe(false);
    const third = insignia.specForSlot(made, build, insigniaSlot(1, 3));
    expect(insignia.slotAccepts(third, "barbed")).toBe(true);
  });

  it("accepts everything while the group has no mount", () => {
    const build = testBuild(group(1, []));
    const spec = insignia.specForSlot(made, build, insigniaSlot(1, 1));
    expect(spec).toBeUndefined();
    expect(insignia.slotAccepts(spec, "barbed")).toBe(true);
  });
});

describe("deriving the bonus onto the build", () => {
  const fourShapes = ["crescent", "regal", "barbed", "enlightened"];

  it("fills an unpinned bonus slot and leaves a pinned one alone", () => {
    const build = testBuild({
      ...group(1, fourShapes, "fixed-mount"),
      ...group(2, fourShapes, "fixed-mount"),
      [bonusSlot(2)]: "other-bonus",
    });
    const derived = insignia.withDerivedBonuses(made, build);
    expect(derived.choices[bonusSlot(1)]).toBe("four-bonus");
    expect(derived.choices[bonusSlot(2)]).toBe("other-bonus");
  });

  it("never writes to the build it was given", () => {
    const build = testBuild(group(1, fourShapes, "fixed-mount"));
    insignia.withDerivedBonuses(made, build);
    expect(build.choices[bonusSlot(1)]).toBeUndefined();
  });

  it("stops at the bonus's own cap and reports the surplus as uncounted", () => {
    // Three groups all reach `four-bonus`, which this fixture caps at 2.
    const build = testBuild({
      ...group(1, fourShapes, "fixed-mount"),
      ...group(2, fourShapes, "fixed-mount"),
      ...group(3, fourShapes, "fixed-mount"),
    });
    expect(
      insignia.derivedBonuses(made, build).map((d) => [d.group, d.counted]),
    ).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    const derived = insignia.withDerivedBonuses(made, build);
    expect(derived.choices[bonusSlot(3)]).toBeUndefined();
  });

  it("a pinned bonus still uses up a copy for the groups after it", () => {
    const build = testBuild({
      [bonusSlot(1)]: "four-bonus",
      ...group(2, fourShapes, "fixed-mount"),
      ...group(3, fourShapes, "fixed-mount"),
    });
    expect(
      insignia.derivedBonuses(made, build).map((d) => [d.group, d.counted]),
    ).toEqual([
      [2, true],
      [3, false],
    ]);
  });
});

describe("the reference the browser renders", () => {
  it("ranks a mount that also satisfies a preferred slot above one that cannot", () => {
    const four = made.get("four-bonus")!;
    const reaches = insignia.mountsFor(made, four);
    const at = (id: string) => reaches.findIndex((r) => r.mount.id === id);
    const preferredOf = (id: string) =>
      reaches.find((r) => r.mount.id === id)?.preferred;

    expect(preferredOf("fixed-mount")).toBe(1);
    expect(preferredOf("greedy-mount")).toBe(0);
    expect(at("fixed-mount")).toBeLessThan(at("greedy-mount"));
    // The list as a whole is ordered by how many preferences each mount meets. Asserted as a
    // property rather than as a fixed list, so adding a fixture mount does not rewrite the test.
    const counts = reaches.map((r) => r.preferred);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("reads the same pairing from the other end", () => {
    const mount = made.get("fixed-mount")!;
    const reaches = insignia.reachableBonuses(made, mount);
    expect(reaches.map((r) => r.bonus.id).sort()).toEqual([
      "four-bonus",
      "three-bonus",
      "two-regal-bonus",
    ]);
  });

  it("plans insignia that actually produce the bonus it was asked for", () => {
    const mount = made.get("fixed-mount")!;
    const plan = insignia.planFor(made, mount, made.get("four-bonus")!)!;
    expect(plan).toHaveLength(4);
    const build = testBuild({
      [mountSlot(1)]: mount.id,
      ...Object.fromEntries(plan.map((id, i) => [insigniaSlot(1, i + 1), id])),
    });
    const state = insignia.readGroup(made, build, 1);
    expect(state.bonus?.id).toBe("four-bonus");
    // The planner fills ordinary insignia and lets normalisation do the upgrading, so the
    // preferred slot is still waiting for its swap at this point.
    expect(state.preferred).toEqual([false, false, false, true]);
    expect(insignia.normaliseGroup(made, build, 1)).toEqual({
      [insigniaSlot(1, 4)]: "enlightened-pref",
    });
  });

  it("fills the spare slot of a three-shape bonus rather than wasting it", () => {
    const mount = made.get("fixed-mount")!;
    const plan = insignia.planFor(made, mount, made.get("three-bonus")!)!;
    expect(plan[3]).toBeTruthy();
    // Slot 4 prefers enlightened, but enlightened there would complete `four-bonus` and displace
    // the bonus being aimed at, so the preference cannot be met and something else goes in.
    expect(made.get(plan[3])!.insigniaShape).not.toBe("enlightened");
    const build = testBuild({
      [mountSlot(1)]: mount.id,
      ...Object.fromEntries(plan.map((id, i) => [insigniaSlot(1, i + 1), id])),
    });
    expect(insignia.readGroup(made, build, 1).bonus?.id).toBe("three-bonus");
  });

  it("meets a spare slot's preference when that shape completes no four-shape recipe", () => {
    // The Grubshank case: the fourth slot's preferred shape leaves the three-shape bonus intact,
    // so the pairing is preferred even though the recipe only names three shapes.
    const mount = made.get("spare-preferred-mount")!;
    const bonus = made.get("three-bonus")!;
    expect(insignia.bestArrangement(made, mount, bonus)?.preferred).toBe(1);

    const plan = insignia.planFor(made, mount, bonus)!;
    const build = testBuild({
      [mountSlot(1)]: mount.id,
      ...Object.fromEntries(plan.map((id, i) => [insigniaSlot(1, i + 1), id])),
    });
    const state = insignia.readGroup(made, build, 1);
    // The three-shape bonus survives the filled fourth slot, and that slot is the preferred one.
    expect(state.bonus?.id).toBe("three-bonus");
    expect(state.preferred).toEqual([false, false, false, true]);
  });

  it("leaves the spare slot empty when the only shape it takes would displace the bonus", () => {
    // The fourth slot is fixed to enlightened, and enlightened on top of `three-bonus` completes
    // `four-bonus`. Filling it would swap the bonus out from under the player, so it stays empty.
    const mount = made.get("blocked-spare-mount")!;
    const plan = insignia.planFor(made, mount, made.get("three-bonus")!)!;
    expect(plan[3]).toBe("");
    const build = testBuild({
      [mountSlot(1)]: mount.id,
      ...Object.fromEntries(plan.map((id, i) => [insigniaSlot(1, i + 1), id])),
    });
    expect(insignia.readGroup(made, build, 1).bonus?.id).toBe("three-bonus");
  });
});

describe("the lint over the stable's slot declarations", () => {
  /** One well-formed group, as the shipped data declares one. */
  const group = (n: number): Slot[] => [
    picker(`g${n}.steed`, "mount", { group: n, role: "mount" }),
    ...Array.from({ length: 4 }, (_, i) =>
      picker(`g${n}.gem-${i + 1}`, "insignia", {
        group: n,
        role: "insignia",
        index: i + 1,
      }),
    ),
    picker(`g${n}.set-bonus`, "insignia_bonus", { group: n, role: "bonus" }),
  ];

  it("passes on a well-formed group, whatever the slots are named", () => {
    expect(catalog.validateStableSlots(group(1))).toEqual([]);
  });

  it("passes on the shipped slots", () => {
    expect(catalog.validateStableSlots(NW_SLOTS.slots)).toEqual([]);
  });

  it("catches a group with no mount row", () => {
    const without = group(1).filter((slot) => slot.id !== "g1.steed");
    const findings = catalog.validateStableSlots(without);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("0 mount rows");
  });

  it("catches a stable row pointed at the wrong filter", () => {
    const repointed = group(1).map((slot) =>
      slot.id === "g1.gem-1" ? { ...slot, filter: "gear_ring" } : slot,
    );
    const findings = catalog.validateStableSlots(repointed);
    expect(findings).toHaveLength(1);
    expect(findings[0].name).toBe("g1.gem-1");
  });

  it("catches two insignia rows claiming one position", () => {
    // A repeat leaves one slot spec unread and another read twice.
    const clashing = group(1).map((slot) =>
      slot.id === "g1.gem-2"
        ? { ...slot, stable: { group: 1, role: "insignia" as const, index: 1 } }
        : slot,
    );
    const findings = catalog.validateStableSlots(clashing);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("already taken");
  });

  it("catches an insignia row with no position at all", () => {
    const unindexed = group(1).map((slot) =>
      slot.id === "g1.gem-3"
        ? { ...slot, stable: { group: 1, role: "insignia" as const } }
        : slot,
    );
    expect(catalog.validateStableSlots(unindexed)).toHaveLength(1);
  });

  it("catches a group with too few insignia rows", () => {
    const short = group(1).filter(
      (slot) => slot.id !== "g1.gem-3" && slot.id !== "g1.gem-4",
    );
    const findings = catalog.validateStableSlots(short);
    expect(findings.some((f) => f.message.includes("needs 3 or 4"))).toBe(true);
  });
});

describe("the shipped insignia bonuses", () => {
  const shipped = catalog.makeDb([]);
  const modelled = shipped.items.filter(
    (i) => i.filter === "insignia_bonus" && i.bonuses?.length,
  );

  /** One bonus resolved on its own, with every occurrence input at `count`. */
  function resolveAlone(item: Item, count: (max: number) => number) {
    const build = defaultBuild();
    build.choices[insignia.bonusSlotId(shipped, 1)!] = item.id;
    const attachment = item.bonuses![0];
    if (typeof attachment !== "string") {
      build.occurrenceInputs[item.id] = {
        [attachment.bonus]: count(attachment.max),
      };
    }
    return engineRun(shipped, build).bonuses.find((b) => b.id === item.id);
  }

  it("every modelled bonus resolves and grants something", () => {
    // Reported per bonus so a failure names the one that broke.
    const inert = modelled
      .filter((item) => {
        const bonus = resolveAlone(item, (max) => max);
        return (
          !bonus?.active ||
          !Object.values(bonus.appliedStats ?? {}).some((v) => v)
        );
      })
      .map((item) => item.id);
    expect(inert).toEqual([]);
  });

  it("a Proc bonus grants nothing until its toggle is on", () => {
    const procs = modelled.filter((item) => {
      const a = item.bonuses![0];
      return typeof a !== "string" && a.label === "Proc" && a.default === 0;
    });
    expect(procs.length).toBeGreaterThan(0);
    const leaking = procs
      .filter((item) => resolveAlone(item, () => 0)?.active)
      .map((item) => item.id);
    expect(leaking).toEqual([]);
  });
});
