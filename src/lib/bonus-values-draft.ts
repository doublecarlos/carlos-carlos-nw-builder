// `bonusValues` as a form edits them: per bonus, its dynamic stats (possibly blank or
// mid-typing) and its inputs. Shared by the preset form, which applies them to a build, and the
// item form, which seeds them when a retired item migrates.
import { numberOrUnset } from "./draft-fields";
import { bonusStatConfigs } from "../engine/inputs";
import type {
  BonusValues,
  Db,
  DynamicStatConfig,
  InputDef,
  InputValue,
} from "../types";

/** One bonus's settings as the form edits them. An input left out reads as its default. */
export interface BonusValuesDraft {
  stat: Record<string, number | string | null>;
  input: Record<string, InputValue>;
}

/** One bonus's dynamic stats and inputs the form offers settings for. */
export interface BonusSettingGroup {
  bonusId: string;
  name: string;
  configs: DynamicStatConfig[];
  inputs: { name: string; def: InputDef }[];
}

/** The bonuses among `bonusIds` that declare dynamic stats or inputs. */
export function settingGroups(
  bonusIds: Iterable<string>,
  db: Pick<Db, "bonusById">,
): BonusSettingGroup[] {
  return [...new Set(bonusIds)].flatMap((bonusId) => {
    const bonus = db.bonusById.get(bonusId);
    if (!bonus) return [];
    const configs = bonusStatConfigs(bonus);
    const inputs = Object.entries(bonus.inputs ?? {}).map(([name, def]) => ({
      name,
      def,
    }));
    return configs.length || inputs.length
      ? [{ bonusId, name: bonus.name ?? bonusId, configs, inputs }]
      : [];
  });
}

export function bonusValuesDrafts(
  source: Record<string, BonusValues> | undefined,
): Record<string, BonusValuesDraft> {
  return Object.fromEntries(
    Object.entries(source ?? {}).map(([bonusId, values]) => [
      bonusId,
      { stat: { ...values.stat }, input: { ...values.input } },
    ]),
  );
}

/** A draft's settings for one bonus, blanks dropped, or undefined once empty. */
export function bonusValuesOf(
  draft: BonusValuesDraft | undefined,
): BonusValues | undefined {
  if (!draft) return undefined;
  const out: BonusValues = {};
  const stat: Record<string, number> = {};
  for (const [key, raw] of Object.entries(draft.stat)) {
    const number = numberOrUnset(raw);
    if (number !== undefined) stat[key] = number;
  }
  if (Object.keys(stat).length) out.stat = stat;
  if (Object.keys(draft.input).length) out.input = { ...draft.input };
  return Object.keys(out).length ? out : undefined;
}

/** `drafts`' settings for the bonuses in `bonusIds`, empty ones dropped. */
export function bonusValuesFor(
  drafts: Record<string, BonusValuesDraft>,
  bonusIds: Iterable<string>,
): Record<string, BonusValues> {
  const out: Record<string, BonusValues> = {};
  for (const bonusId of bonusIds) {
    const values = bonusValuesOf(drafts[bonusId]);
    if (values) out[bonusId] = values;
  }
  return out;
}
