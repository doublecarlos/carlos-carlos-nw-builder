// ItemCard.vue's bonus-row derivation, moved to lib/item-card-rows.ts so it is testable
// independent of the component (see F16/F17 in the UI review).
import { describe, it, expect } from "vitest";
import {
  dynamicNoteText,
  itemCardRows,
  statList,
  withDynamicNotes,
} from "../../src/lib/item-card-rows";
import { int, label as statLabel, signedStat } from "../../src/lib/format";
import type {
  DynamicStatConfig,
  EvaluatedBonus,
  Grant,
  GrantEvaluation,
  Item,
} from "../../src/types";
import type { OccurrenceRow } from "../../src/composables/useItemBonusOccurrences";

const item = (over: Partial<Item> = {}): Item =>
  ({ id: "i1", name: "Test Item", ...over }) as Item;

const bonus = (over: Partial<EvaluatedBonus> = {}): EvaluatedBonus =>
  ({
    id: "b1",
    bonus: { id: "b1", name: "Test Bonus" },
    bonusId: "b1",
    sources: [{ name: "Test Item", slotId: "slot1" }],
    slotId: "slot1",
    active: true,
    gate: { ok: true, leaves: [], unmet: [] },
    chose: null,
    stats: null,
    previewStats: null,
    grants: [],
    problems: [],
    stacks: 1,
    excluded: false,
    excludedBy: null,
    ...over,
  }) as EvaluatedBonus;

const grantEval = (
  raw: Grant,
  over: Partial<GrantEvaluation> = {},
): GrantEvaluation & { raw: Grant } =>
  ({
    active: true,
    gate: { ok: true, leaves: [], unmet: [] },
    stats: raw.stats ?? null,
    chose: null,
    problem: null,
    ...over,
    raw,
  }) as GrantEvaluation & { raw: Grant };

const line = (key: string, value: number) => ({
  key,
  label: statLabel(key),
  value: signedStat(key, value),
});

const typedLine = (key: string, value: number, config: DynamicStatConfig) => ({
  ...line(key, value),
  note: [{ text: dynamicNoteText(config) }],
});

describe("dynamicNoteText", () => {
  it("states the typed range in the stat's own format", () => {
    expect(
      dynamicNoteText({ stat: "power", min: 0, max: 1000, default: 500 }),
    ).toBe(`from 0 to ${int(1000)}`);
    expect(
      dynamicNoteText({
        stat: "outgoing_damage",
        min: 0,
        max: 0.5,
        default: 0.1,
      }),
    ).toBe("from 0.00% to 50.00%");
  });

  it("leads with the config's own label when it has one", () => {
    expect(
      dynamicNoteText({
        stat: "power",
        min: 0,
        max: 1000,
        default: 500,
        label: "Enchant rank",
      }),
    ).toBe(`Enchant rank, from 0 to ${int(1000)}`);
  });
});

describe("withDynamicNotes", () => {
  const config: DynamicStatConfig = {
    stat: "power",
    min: 0,
    max: 1000,
    default: 500,
  };

  it("returns the lines untouched without configs", () => {
    const lines = [line("power", 10)];
    expect(withDynamicNotes(lines, undefined)).toBe(lines);
    expect(withDynamicNotes(lines, [])).toBe(lines);
  });

  it("notes only the line whose stat a config declares", () => {
    expect(
      withDynamicNotes([line("power", 500), line("defense", 10)], [config]),
    ).toEqual([typedLine("power", 500, config), line("defense", 10)]);
  });

  it("appends the range after a scaler's own parts", () => {
    const scaled = {
      ...line("power", 200),
      note: [{ text: "500 x 40.00% " }, { text: "Encounter Damage" }],
    };
    expect(withDynamicNotes([scaled], [config])[0].note).toEqual([
      { text: "500 x 40.00% " },
      { text: "Encounter Damage" },
      { text: `, from 0 to ${int(1000)}` },
    ]);
  });
});

describe("statList", () => {
  it("returns nothing for empty or missing stats", () => {
    expect(statList(undefined)).toEqual([]);
    expect(statList(null)).toEqual([]);
    expect(statList({})).toEqual([]);
  });

  it("formats each stat with its label and signed value", () => {
    expect(statList({ power: 50 })).toEqual([line("power", 50)]);
  });

  it("scales by multiplier for a stacking source's preview", () => {
    expect(statList({ power: 50 }, 3)).toEqual([line("power", 150)]);
  });
});

describe("itemCardRows", () => {
  it("filters out a bonus whose every grant is problem-only", () => {
    const hidden = bonus({
      bonus: {
        id: "b1",
        name: "Hidden",
        grants: [{ problem: { severity: "warning", message: "x" } }],
      },
    });
    expect(itemCardRows(item(), [hidden], [])).toEqual([]);
  });

  it("marks state, dot color and muted from active/excluded", () => {
    const rows = itemCardRows(
      item(),
      [
        bonus({ id: "active", active: true, excluded: false }),
        bonus({ id: "inactive", active: false, excluded: false }),
        bonus({ id: "excluded", active: true, excluded: true }),
      ],
      [],
    );
    expect(rows.map((r) => [r.state, r.dotClass, r.muted])).toEqual([
      ["active", "bg-ok", false],
      ["inactive", "bg-muted opacity-50", true],
      ["excluded", "bg-danger", true],
    ]);
  });

  // A grant's conditions are its label: the card has no separate conditions line, so a met
  // gate is stated through the grant header and a failing one through its "needs" lines.
  it("labels a grant by its own non-empty condition labels", () => {
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          active: true,
          grants: [
            grantEval(
              { stats: { power: 10 } },
              {
                gate: {
                  ok: true,
                  leaves: [
                    { ok: true, label: "Fighter" },
                    { ok: true, label: "" },
                    { ok: true, label: "Tier 2" },
                  ],
                  unmet: [],
                },
              },
            ),
          ],
        }),
      ],
      [],
    );
    expect(row.grants[0].label).toBe("Fighter + Tier 2");
  });

  it("labels an unconditional grant as always on", () => {
    const [row] = itemCardRows(
      item(),
      [bonus({ active: true, grants: [grantEval({ stats: { power: 10 } })] })],
      [],
    );
    expect(row.grants[0].label).toBe("always on");
  });

  it("carries a failing grant's unmet leaves for its needs lines", () => {
    const gate = {
      ok: false,
      leaves: [{ ok: false, label: "party enabled" }],
      unmet: [{ ok: false, label: "party enabled" }],
    };
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          active: false,
          gate,
          grants: [
            grantEval({ stats: { power: 10 } }, { active: false, gate }),
          ],
        }),
      ],
      [],
    );
    expect(row.grants[0].unmet.map((leaf) => leaf.label)).toEqual([
      "party enabled",
    ]);
  });

  it("labels each of several grants by its own conditions", () => {
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          active: true,
          grants: [
            grantEval(
              { stats: { power: 10 } },
              {
                gate: {
                  ok: true,
                  leaves: [{ ok: true, label: "2 occurrences" }],
                  unmet: [],
                },
              },
            ),
            grantEval(
              { stats: { sev: 5 } },
              {
                gate: {
                  ok: true,
                  leaves: [{ ok: true, label: "combat enabled" }],
                  unmet: [],
                },
              },
            ),
          ],
        }),
      ],
      [],
    );
    expect(row.grants.map((g) => g.label)).toEqual([
      "2 occurrences",
      "combat enabled",
    ]);
  });

  it("names the item's own zero-count occurrence row only while inactive", () => {
    const occRow: OccurrenceRow = {
      bonusId: "b1",
      label: "Procs",
      value: 0,
      min: 0,
      max: 1,
      defaultValue: 0,
      kind: "checkbox",
    };
    const [inactiveRow] = itemCardRows(
      item(),
      [bonus({ id: "b1", active: false })],
      [occRow],
    );
    expect(inactiveRow.zeroOccurrence).toEqual(occRow);

    const [activeRow] = itemCardRows(
      item(),
      [bonus({ id: "b1", active: true })],
      [occRow],
    );
    expect(activeRow.zeroOccurrence).toBeNull();
  });

  it("keeps each active grant's description on its own grant row, long falling back to short", () => {
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          grants: [
            grantEval(
              { longDescription: "Long one.\n\nLong two." },
              { active: true },
            ),
            grantEval({ shortDescription: "Short text." }, { active: true }),
            grantEval(
              { longDescription: "Hidden while inactive." },
              { active: false },
            ),
          ],
        }),
      ],
      [],
    );
    expect(row.grants.map((g) => g.descriptions)).toEqual([
      ["Long one.", "Long two."],
      ["Short text."],
      [],
    ]);
  });

  it("builds a tier ladder in ascending order, marking the active tier", () => {
    const raw: Grant = {
      tiers: [
        { bonusOccurrences: { atLeast: 2 }, stats: { power: 20 } },
        { bonusOccurrences: { atLeast: 1 }, stats: { power: 10 } },
      ],
    };
    const [row] = itemCardRows(
      item(),
      [bonus({ grants: [grantEval(raw, { active: true, chose: "tier:2" })] })],
      [],
    );
    expect(row.grants[0].tiers).toEqual([
      { atLeast: 1, stats: [line("power", 10)], active: false },
      { atLeast: 2, stats: [line("power", 20)], active: true },
    ]);
  });

  it("builds a variant ladder from variantBranches, active flag off `chose`", () => {
    const raw: Grant = {
      variants: [{ stats: { power: 5 } }, { stats: { power: 15 } }],
    };
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          grants: [
            grantEval(raw, {
              active: true,
              chose: "variant:1",
              variantBranches: [
                {
                  ok: false,
                  leaves: [{ ok: false, label: "Tank role" }],
                  unmet: [{ ok: false, label: "Tank role" }],
                },
                {
                  ok: true,
                  leaves: [{ ok: true, label: "DPS role" }],
                  unmet: [],
                },
              ],
            }),
          ],
        }),
      ],
      [],
    );
    expect(row.grants[0].variants).toEqual([
      {
        key: 0,
        label: "Tank role",
        stats: [line("power", 5)],
        active: false,
        unmet: [{ ok: false, label: "Tank role" }],
      },
      {
        key: 1,
        label: "DPS role",
        stats: [line("power", 15)],
        active: true,
        unmet: [],
      },
    ]);
  });

  it("scales an active grant's own stats by the bonus's stack count", () => {
    const raw: Grant = { stats: { power: 10 } };
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          stacks: 3,
          grants: [grantEval(raw, { active: true, stats: { power: 10 } })],
        }),
      ],
      [],
    );
    expect(row.grants[0].stats).toEqual([line("power", 30)]);
  });

  it("previews an inactive grant's raw stats plus each dynamicStats config's default, noting the range", () => {
    const config: DynamicStatConfig = {
      stat: "combined_rating",
      min: 0,
      max: 100,
      default: 25,
    };
    const raw: Grant = { stats: { power: 5 }, dynamicStats: [config] };
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          bonus: { id: "b1", name: "X", stacking: "perSource" },
          grants: [grantEval(raw, { active: false, stats: null })],
        }),
      ],
      [],
    );
    expect(row.grants[0].stats).toEqual([
      line("power", 5),
      typedLine("combined_rating", 25, config),
    ]);
    expect(row.grants[0].eachStack).toBe(true);
  });

  it("notes the range on an active grant's typed stat, merged with its fixed share", () => {
    const config: DynamicStatConfig = {
      stat: "power",
      min: 0,
      max: 1000,
      default: 500,
      label: "Enchant rank",
    };
    const raw: Grant = { stats: { power: 10 }, dynamicStats: [config] };
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          grants: [grantEval(raw, { active: true, stats: { power: 760 } })],
        }),
      ],
      [],
    );
    expect(row.grants[0].stats).toEqual([typedLine("power", 760, config)]);
  });

  it("notes a variant's own typed stat on its rung, live and previewed alike", () => {
    const config: DynamicStatConfig = {
      stat: "power",
      min: 0,
      max: 100,
      default: 20,
    };
    const raw: Grant = {
      variants: [
        { stats: { defense: 5 }, dynamicStats: [config] },
        { stats: { defense: 15 } },
      ],
    };
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          grants: [
            grantEval(raw, {
              active: true,
              chose: "variant:0",
              stats: { defense: 5, power: 70 },
            }),
          ],
        }),
      ],
      [],
    );
    expect(row.grants[0].variants?.map((v) => v.stats)).toEqual([
      [line("defense", 5), typedLine("power", 70, config)],
      [line("defense", 15)],
    ]);

    const [inactive] = itemCardRows(
      item(),
      [
        bonus({
          active: false,
          grants: [grantEval(raw, { active: false, stats: null })],
        }),
      ],
      [],
    );
    expect(inactive.grants[0].variants?.[0].stats).toEqual([
      line("defense", 5),
      typedLine("power", 20, config),
    ]);
  });

  it("labels each variant by its own conditions while the grant's gate is unmet", () => {
    const raw: Grant = {
      when: { toggle: "combat" },
      variants: [{ stats: { power: 5 } }, { stats: { power: 15 } }],
    };
    const [row] = itemCardRows(
      item(),
      [
        bonus({
          active: false,
          grants: [
            grantEval(raw, {
              active: false,
              stats: null,
              gate: {
                ok: false,
                leaves: [{ ok: false, label: "combat is on" }],
                unmet: [{ ok: false, label: "combat is on" }],
              },
              variantBranches: [
                {
                  ok: false,
                  leaves: [{ ok: false, label: "Tank role" }],
                  unmet: [{ ok: false, label: "Tank role" }],
                },
                {
                  ok: true,
                  leaves: [{ ok: true, label: "DPS role" }],
                  unmet: [],
                },
              ],
            }),
          ],
        }),
      ],
      [],
    );
    expect(row.grants[0].variants?.map((v) => [v.label, v.active])).toEqual([
      ["Tank role", false],
      ["DPS role", false],
    ]);
  });

  it("credits a shared, non-tiered, non-stacking bonus to its first source only", () => {
    const shared = bonus({
      bonus: { id: "shared-b", name: "Shared" },
      sources: [
        { name: "Item A", slotId: "slot1" },
        { name: "Item B", slotId: "slot2" },
      ],
      active: true,
    });

    const [rowForA] = itemCardRows(item({ name: "Item A" }), [shared], []);
    expect(rowForA.sharedWith).toEqual([{ name: "Item B", slotId: "slot2" }]);
    expect(rowForA.secondary).toBe(false);

    const [rowForB] = itemCardRows(item({ name: "Item B" }), [shared], []);
    expect(rowForB.sharedWith).toEqual([{ name: "Item A", slotId: "slot1" }]);
    expect(rowForB.secondary).toBe(true);
    expect(rowForB.firstSource).toEqual({ name: "Item A", slotId: "slot1" });
  });

  it("lists each other part once, at the first slot carrying that name", () => {
    const shared = bonus({
      sources: [
        { name: "Item A", slotId: "slot1" },
        { name: "Ring", slotId: "ring1" },
        { name: "Ring", slotId: "ring2" },
        { name: "Item A", slotId: "slot3" },
      ],
    });
    const [row] = itemCardRows(item({ name: "Item A" }), [shared], []);
    expect(row.sharedWith).toEqual([{ name: "Ring", slotId: "ring1" }]);
  });

  it("resolves the excluder's title and slot through the build's bonus map", () => {
    const excluder = bonus({
      id: "winner",
      bonus: { id: "winner", name: "Winner" },
      sources: [{ name: "Other Item", slotId: "slot9" }],
      slotId: "slot9",
    });
    const [row] = itemCardRows(
      item(),
      [bonus({ excluded: true, excludedBy: "winner" })],
      [],
      new Map([[excluder.id, excluder]]),
    );
    expect(row.excludedBy).toEqual({ name: "Winner", slotId: "slot9" });
  });

  it("keeps an unresolved excluder's id as text with nowhere to link", () => {
    const [row] = itemCardRows(
      item(),
      [bonus({ excluded: true, excludedBy: "gone" })],
      [],
    );
    expect(row.excludedBy).toEqual({ name: "gone", slotId: "" });

    const [plain] = itemCardRows(item(), [bonus()], []);
    expect(plain.excludedBy).toBeNull();
  });

  it("does not credit sharing to a tiered or perSource-stacking bonus", () => {
    const tiered = bonus({
      sources: [
        { name: "Item A", slotId: "slot1" },
        { name: "Item B", slotId: "slot2" },
      ],
      grants: [grantEval({ tiers: [{ stats: {} }] }, { active: true })],
    });
    expect(
      itemCardRows(item({ name: "Item A" }), [tiered], [])[0].sharedWith,
    ).toBeNull();

    const stacking = bonus({
      bonus: { id: "b1", name: "S", stacking: "perSource" },
      sources: [
        { name: "Item A", slotId: "slot1" },
        { name: "Item B", slotId: "slot2" },
      ],
    });
    expect(
      itemCardRows(item({ name: "Item A" }), [stacking], [])[0].sharedWith,
    ).toBeNull();
  });
});
