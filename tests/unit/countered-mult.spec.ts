// Bonuses with a counter stat (CA against Awareness, Severity against Critical Avoidance): the
// counter only cancels the bonus, so the multiplier never drops below 1. Debuffing the side that
// is already outmatched changes nothing.
import { describe, expect, it } from "vitest";
import * as engine from "../../src/engine/engine";
import type { Item } from "../../src/types";
import { picker, testBuild, testDb, testSchema } from "./engine-fixtures";

const schema = testSchema([
  "il",
  "acc_p",
  "awareness_p",
  "base_damage_flat",
  "base_damage_mult",
  "ca_p",
  "crit_avoid_p",
  "defense_p",
  "deflect_p",
  "deflect_sev_p",
  "enemy_accuracy",
  "enemy_awareness",
  "enemy_ca",
  "enemy_crit_avoid",
  "enemy_defense",
  "enemy_deflect",
  "enemy_deflect_sev",
  "enemy_incoming_damage",
  "enemy_outgoing_damage",
  "enemy_severity",
  "enemy_strike",
  "hit_points",
  "hit_points_mult",
  "hit_points_p",
  "incoming_damage",
  "magical_damage_boost",
  "outgoing_damage",
  "outgoing_damage_mult",
  "overall_damage",
  "overall_healing",
  "physical_damage_boost",
  "power_p",
  "sev_p",
  "strike_p",
]);

/** Derived outputs of a build wearing one item carrying `stats` on top of a fixed base. */
function derivedWith(stats: Record<string, number>) {
  const item = {
    id: "gear",
    name: "Gear",
    filter: "gear",
    il: 1000,
    base_damage_flat: 100,
    hit_points: 1000,
    ...stats,
  } as Item;
  const built = testDb(schema, [item], [], [picker("gear.main", "gear")]);
  const build = testBuild({ choices: { "gear.main": "gear" } });
  return engine.resolveBuild(built, build).derived;
}

describe("combat advantage multiplier", () => {
  it("adds the CA left over after the enemy's Awareness to damage", () => {
    const none = derivedWith({});
    const some = derivedWith({ ca_p: 0.5, enemy_awareness: 0.2 });
    expect(some.damage.average / none.damage.average).toBeCloseTo(1.3, 9);
  });

  it("keeps raising damage when enemy Awareness is debuffed below zero", () => {
    const none = derivedWith({ ca_p: 0.5 });
    const debuffed = derivedWith({ ca_p: 0.5, enemy_awareness: -0.2 });
    expect(debuffed.damage.average / none.damage.average).toBeCloseTo(
      1.7 / 1.5,
      9,
    );
  });

  it("never lets enemy Awareness above our CA cut damage", () => {
    const none = derivedWith({});
    const outmatched = derivedWith({ ca_p: 0.2, enemy_awareness: 0.9 });
    expect(outmatched.damage.average).toBeCloseTo(none.damage.average, 9);
  });

  it("never lets our Awareness above enemy CA raise EHP", () => {
    // Awareness already covers the enemy's CA, so debuffing that CA gives nothing more.
    const atCap = derivedWith({ awareness_p: 0.9, enemy_ca: 0.9 });
    const debuffed = derivedWith({ awareness_p: 0.9, enemy_ca: 0.5 });
    const noEnemyCa = derivedWith({ awareness_p: 0.9 });
    expect(debuffed.ehp.average).toBeCloseTo(atCap.ehp.average, 9);
    expect(noEnemyCa.ehp.average).toBeCloseTo(atCap.ehp.average, 9);
  });

  it("lowers EHP by the enemy CA our Awareness leaves uncovered", () => {
    const none = derivedWith({});
    const exposed = derivedWith({ awareness_p: 0.2, enemy_ca: 0.5 });
    expect(none.ehp.average / exposed.ehp.average).toBeCloseTo(1.3, 9);
  });
});

// Crit cases read `critNoDeflect`, a guaranteed crit, so crit chance does not dilute the check.
describe("critical severity multiplier", () => {
  it("adds the Severity left over after the enemy's Critical Avoidance to crits", () => {
    const none = derivedWith({});
    const some = derivedWith({ sev_p: 0.5, enemy_crit_avoid: 0.2 });
    expect(some.damage.critNoDeflect / none.damage.critNoDeflect).toBeCloseTo(
      1.3,
      9,
    );
  });

  it("never lets enemy Critical Avoidance above our Severity weaken a crit", () => {
    const none = derivedWith({});
    const outmatched = derivedWith({ sev_p: 0.2, enemy_crit_avoid: 0.9 });
    expect(outmatched.damage.critNoDeflect).toBeCloseTo(
      none.damage.critNoDeflect,
      9,
    );
  });

  it("never lets our Critical Avoidance above enemy Severity raise EHP", () => {
    const covered = derivedWith({ crit_avoid_p: 0.9, enemy_severity: 0.9 });
    const debuffed = derivedWith({ crit_avoid_p: 0.9, enemy_severity: 0.5 });
    expect(debuffed.ehp.critNoDeflect).toBeCloseTo(
      covered.ehp.critNoDeflect,
      9,
    );
  });

  it("lowers EHP by the enemy Severity our Critical Avoidance leaves uncovered", () => {
    const none = derivedWith({});
    const exposed = derivedWith({ crit_avoid_p: 0.2, enemy_severity: 0.5 });
    expect(none.ehp.critNoDeflect / exposed.ehp.critNoDeflect).toBeCloseTo(
      1.3,
      9,
    );
  });
});
