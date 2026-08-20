// The parser's job is to fill an item's *base* stats and to be visibly silent about anything
// else. These tests own their tooltip text outright -- they never read a screenshot corpus, so
// they stay meaningful independently of what fixtures happen to be committed.
import { describe, it, expect } from "vitest";
import { parseTooltip } from "../../src/lib/tooltip-parser";

describe("parseTooltip", () => {
  it("reads flat stat lines with thousands separators", () => {
    const { draft } = parseTooltip(
      [
        "Frostsilver Band of Faith",
        "+10,800 Critical Strike",
        "+6,300 Power",
      ].join("\n"),
    );
    expect(draft.strike).toBe(10800);
    expect(draft.power).toBe(6300);
  });

  it("reads Item Level, which is `key: value` rather than `+value key`", () => {
    const { draft } = parseTooltip("Omen of Doom\nItem Level: 5,250");
    expect(draft.il).toBe(5250);
  });

  it("stores percent lines as ratios and distinguishes them from the rating form", () => {
    const percent = parseTooltip("Ring\n+1.5% Recharge Speed");
    expect(percent.draft.recharge).toBe(0.015);

    const rating = parseTooltip("Ring\n+6,300 Power");
    expect(rating.draft.power).toBe(6300);
    expect(rating.draft.power_p).toBeUndefined();
  });

  it("resolves stat abbreviations", () => {
    const { draft } = parseTooltip("Scintillant Sash +1\n+3 INT\n+3 CHA");
    expect(draft.int).toBe(3);
    expect(draft.cha).toBe(3);
  });

  it("resolves tooltip labels that differ from the schema's own label", () => {
    // schema calls this "AP Gain"; the game prints "Action Point Gain".
    const { draft } = parseTooltip("Ring\n+1.5% Action Point Gain");
    expect(draft.ap_gain).toBe(0.015);
  });

  it("strips the slot prefix an enchantment tooltip puts in front of each stat", () => {
    const { draft } = parseTooltip(
      [
        "Celestial Amethyst (R)",
        "Offense: +2,700 Combat Advantage",
        "Defense: +2,700 Awareness",
        "Utility: +2,700 Control Bonus",
        "+1,620 Combined Rating",
      ].join("\n"),
    );
    expect(draft.ca).toBe(2700);
    expect(draft.awareness).toBe(2700);
    expect(draft.control_bonus).toBe(2700);
    expect(draft.combined_rating).toBe(1620);
  });

  it("emits every stat the tooltip shows, leaving variant splitting to the author", () => {
    // One physical enchantment maps to three catalog entries; the parser does not guess which.
    const { stats } = parseTooltip(
      [
        "Celestial Amethyst (R)",
        "Offense: +2,700 Combat Advantage",
        "Defense: +2,700 Awareness",
      ].join("\n"),
    );
    expect(stats.map((s) => s.key)).toEqual(["ca", "awareness"]);
  });

  it("does not let an enchantment's grant overwrite the item's own base stat", () => {
    // The regression that matters most: a later "Equip:" line silently replacing a base value.
    const { draft, bonusLines } = parseTooltip(
      [
        "Scintillant Amulet",
        "+849 Combat Advantage",
        "Reinforced: Major Combat Advantage Jewel +1",
        "Equip: +880 Combat Advantage",
      ].join("\n"),
    );
    expect(draft.ca).toBe(849);
    expect(bonusLines).toContain("Equip: +880 Combat Advantage");
  });

  it("keeps the first value when a stat is repeated", () => {
    const { draft } = parseTooltip("Ring\n+100 Power\n+250 Power");
    expect(draft.power).toBe(100);
  });

  it("reports numeric lines it could not place instead of dropping them", () => {
    const { draft, unmatched } = parseTooltip(
      [
        "Omen of Doom",
        "+3,412 Accuracy",
        "2 of Set: Accumulate 10 Charges to consume them and become Unleashed.",
        "1 charge per Daily power (10s CD)",
      ].join("\n"),
    );
    expect(draft.acc).toBe(3412);
    expect(unmatched).toHaveLength(2);
    expect(unmatched[0]).toContain("Accumulate 10 Charges");
  });

  it("does not invent stats for prose that merely mentions one", () => {
    const { draft, stats } = parseTooltip(
      [
        "Ring",
        "You gain 6% Combat Advantage when in combat with 2 or more enemies.",
      ].join("\n"),
    );
    expect(stats).toHaveLength(0);
    expect(draft.ca_p).toBeUndefined();
    expect(draft.ca).toBeUndefined();
  });

  it("takes the item name from the first line that is neither chrome nor a stat", () => {
    const { draft } = parseTooltip(
      [
        "EQUIPPED",
        "Wintermarked Hunter Hood",
        "Item Level: 5,700",
        "+5,130 Critical Strike",
      ].join("\n"),
    );
    expect(draft.name).toBe("Wintermarked Hunter Hood");
  });

  it("skips the icon noise OCR puts above the name", () => {
    // Verbatim from reading a real screenshot: a stray glyph on its own line, then the
    // "EQUIPPED" banner with another glyph stuck to its front.
    const { draft } = parseTooltip(
      ["LN", "Ax EQUIPPED", "Omen of Doom", "Item Level: 5,250"].join("\n"),
    );
    expect(draft.name).toBe("Omen of Doom");
  });

  it("returns an empty draft for text carrying no stats at all", () => {
    const { stats, draft } = parseTooltip("Seen last before the strike.");
    expect(stats).toEqual([]);
    expect(draft.il).toBeUndefined();
  });

  it("records where each value came from", () => {
    const { stats } = parseTooltip("Ring\nOffense: +2,700 Combat Advantage");
    expect(stats[0]).toMatchObject({
      key: "ca",
      value: 2700,
      line: "Offense: +2,700 Combat Advantage",
    });
  });
});
