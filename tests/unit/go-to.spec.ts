// The "go to" palette's ranking. Its whole promise is that the first row is the one you meant,
// so the tiers are what is worth pinning down -- the palette component around it is covered by
// tests/e2e/go-to-palette.spec.ts.
import { describe, it, expect } from "vitest";
import { rankEntries, type GoToEntry } from "../../src/lib/go-to";

function entry(
  kind: GoToEntry["kind"],
  label: string,
  detail?: string,
): GoToEntry {
  return { key: `${kind}:${label}`, kind, id: label, label, detail };
}

const CATALOGUE: GoToEntry[] = [
  entry("section", "Gear"),
  entry("section", "Boons"),
  entry("slot", "Head", "Gear"),
  entry("slot", "Boots", "Gear"),
  entry("slot", "Offhand Mod 1", "Gear"),
  entry("slot", "Offhand Mod 2", "Gear"),
  entry("build", "Gear test build"),
];

const labels = (query: string, limit?: number) =>
  rankEntries(CATALOGUE, query, limit).map((e) => e.label);

describe("rankEntries", () => {
  it("keeps everything, in order, for an empty query", () => {
    expect(labels("")).toEqual(CATALOGUE.map((e) => e.label));
    expect(labels("   ")).toEqual(CATALOGUE.map((e) => e.label));
  });

  it("puts an exact label match first, ahead of rows that merely mention it", () => {
    // The case the whole ranking exists for: "gear" must reach the Gear *section*, not the
    // eight gear slots whose detail line names it.
    expect(labels("gear")[0]).toBe("Gear");
  });

  it("ranks a label prefix above a mid-label hit", () => {
    // "Boons" and "Boots" both start with "bo"; "Boons" is a section, which breaks the tie.
    expect(labels("boo")).toEqual(["Boons", "Boots"]);
  });

  it("ranks a word prefix inside the label above a bare substring", () => {
    expect(labels("mod")).toEqual(["Offhand Mod 1", "Offhand Mod 2"]);
  });

  it("still reaches a row through its detail line, but only after label matches", () => {
    const ranked = labels("gear");
    expect(ranked[0]).toBe("Gear");
    expect(ranked).toContain("Head");
    expect(ranked.indexOf("Head")).toBeGreaterThan(ranked.indexOf("Gear"));
  });

  it("matches words out of order and non-adjacent, the way every other filter here does", () => {
    expect(labels("1 offhand")).toEqual(["Offhand Mod 1"]);
  });

  it("drops entries nothing in them matches", () => {
    expect(labels("zzz")).toEqual([]);
  });

  it("caps the list, keeping the best-ranked rows", () => {
    expect(labels("o", 2)).toHaveLength(2);
  });

  it("breaks a score tie by kind, so a section leads its own slots", () => {
    const tied = [entry("slot", "Boons row"), entry("section", "Boons")];
    // Both score as a label prefix of "boons"; the section is the likelier destination.
    expect(rankEntries(tied, "boons").map((e) => e.kind)).toEqual([
      "section",
      "slot",
    ]);
  });
});
