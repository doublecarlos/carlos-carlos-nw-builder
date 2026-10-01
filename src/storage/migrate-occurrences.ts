// Moves per-item occurrence counts (`occurrenceInputs[itemId][bonusId]`) onto the bonus inputs
// that replaced them (`bonusValues[bonusId].input[key]`). Each retired occurrence config became
// exactly one input with the same bounds and default, so only the bonus id matters.
import type { BonusValues } from "../types";

type Target = [input: string, type: "boolean" | "number"];

/** The input each retired occurrence config became. Frozen: it records the catalog as it was
 * when the configs were retired, not whatever the bonuses declare now. */
const TARGETS: Record<string, Target> = {
  "accursed-resolve": ["active", "boolean"],
  "burning-radiant-shift-stacks": ["stacks", "number"],
  "cavalry-s-alarm": ["active", "boolean"],
  "celestial-fluid-aurora-s-power": ["stacks", "number"],
  "death-s-bulwark-stats": ["active", "boolean"],
  "deathly-rage-stats": ["active", "boolean"],
  "doomsayer-2": ["active", "boolean"],
  "fighter-s-unshakable-shieldarm": ["active", "boolean"],
  "frigid-winds-2": ["chill", "number"],
  "m31-bloodletting-ascendant": ["active", "boolean"],
  "m33-bloodletting": ["active", "boolean"],
  "m33-bloodletting-celestial": ["active", "boolean"],
  "m33-dashing-ranger-s-strike": ["active", "boolean"],
  "m33-dashing-ranger-s-strike-celestial": ["active", "boolean"],
  "magistrate-patience": ["active", "boolean"],
  "master-cruelty": ["active", "boolean"],
  "master-s-precision": ["active", "boolean"],
  "masterwork-sets": ["stacks", "number"],
  "momentum-s-movement-speed": ["active", "boolean"],
  "pack-tactics": ["stacks", "number"],
  "predator-s-instinct": ["active", "boolean"],
  "raptor-s-instincts-tamed-velociraptor-power-offense": ["raptors", "number"],
  "relative-haste-2": ["chilled", "number"],
  "rimefire-weaving-2": ["active", "boolean"],
  "risky-investment": ["investiture", "number"],
  "shattered-resolve-stacks": ["stacks", "number"],
  "shepherd-s-devotion": ["active", "boolean"],
  "soul-sparks": ["sparks", "number"],
  "swath-of-destruction-2": ["active", "boolean"],
  "trainer-s-restoration": ["active", "boolean"],
};

const isPlain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** `bonusValues` with every recognized count in `rawOccurrences` merged in as its input. A
 * value already in `bonusValues` wins, so a build migrated earlier passes through unchanged. */
export function migrateOccurrenceInputs(
  rawOccurrences: unknown,
  bonusValues: Record<string, BonusValues>,
): Record<string, BonusValues> {
  if (!isPlain(rawOccurrences)) return bonusValues;
  const out = { ...bonusValues };
  for (const byBonus of Object.values(rawOccurrences)) {
    if (!isPlain(byBonus)) continue;
    for (const [bonusId, raw] of Object.entries(byBonus)) {
      const target = TARGETS[bonusId];
      const count = typeof raw === "number" ? raw : Number.NaN;
      if (!target || !Number.isFinite(count)) continue;
      const [key, type] = target;
      const input = { ...out[bonusId]?.input };
      input[key] ??= type === "boolean" ? count > 0 : count;
      out[bonusId] = { ...out[bonusId], input };
    }
  }
  return out;
}
