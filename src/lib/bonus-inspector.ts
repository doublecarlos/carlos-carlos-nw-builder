// BonusInspector.vue's list derivation, Vue-free so it is unit-testable.
import { bonusContext, isHiddenBonus } from "../engine/bonus";
import {
  explainFormula,
  formatNumber,
  formulaLabel,
  parseFormula,
} from "../engine/formula";
import { findParamSlot } from "./build-path";
import { grantLabel, tierHeading, type NotePart } from "./item-card-rows";
import type {
  BonusSource,
  EvalContext,
  EvaluatedBonus,
  FormulaRef,
  Slot,
} from "../types";

/**
 * The bonuses the inspector lists: what the build carries. Also what the Bonuses tab badge
 * counts (stores/resolved.ts's `bonusCounts`), so the two never disagree on a total.
 *
 * A problem-only bonus (one that exists purely to report a build error/warning) is already
 * surfaced inline on its slot and in the errors summary; listed here too, especially while
 * inactive, it reads as a bonus that never grants anything. A bonus with no source (bonus.ts's
 * `resolve()` seeds one for a carrier at 0 points) exists so the hover card can preview it,
 * but nothing on the build carries it yet.
 */
export function inspectorBonuses(bonuses: EvaluatedBonus[]): EvaluatedBonus[] {
  return bonuses.filter(
    (entry) => !isHiddenBonus(entry.bonus) && isCarried(entry),
  );
}

/** Whether an item carrying this bonus is on the build. */
export const isCarried = (entry: EvaluatedBonus): boolean =>
  entry.sources.length > 0;

export interface SourceLink {
  key: string;
  label: string;
}

/**
 * One link per distinct source. A perSource-stacking bonus with a player-set count lists the
 * same `{ name, slotId }` once per stack, which as a "from" list would repeat one name five
 * times; the count goes on the label instead. Two different items on one slot (a
 * point_assignment row holds several) stay apart, since their names differ.
 */
export function collapseSources(sources: BonusSource[]): SourceLink[] {
  const counts = new Map<string, { source: BonusSource; count: number }>();
  for (const source of sources) {
    const id = `${source.slotId}|${source.name}`;
    const seen = counts.get(id);
    if (seen) seen.count += 1;
    else counts.set(id, { source, count: 1 });
  }
  return [...counts.values()].map(({ source, count }) => ({
    key: source.slotId,
    label: count > 1 ? `${source.name} ×${count}` : source.name,
  }));
}

/**
 * One step from active: a single failing condition. Shared by the inspector's badge and the
 * tab's count, so "1 away" means one thing.
 */
export function isNearMiss(entry: EvaluatedBonus): boolean {
  if (entry.active || entry.excluded) return false;
  return (entry.gate?.unmet?.length ?? 0) === 1;
}

/** A bonus's `chose` badge: the tier or variant that won. */
export function choseLabel(entry: EvaluatedBonus): string {
  const chose = entry.chose;
  if (!chose || chose === "stats") return "";
  const [kind, value] = chose.split(":");
  if (kind === "tier") {
    const grant = entry.grants.find((g) => g.active && g.chose === chose);
    return grant ? tierHeading(grant, Number(value)) : `${value} equipped`;
  }
  if (kind === "variant") return `variant ${Number(value) + 1}`;
  return chose;
}

/** One formula as the inspector explains it: what it is called, its text with every lookup
 *  that has a row to jump to linked, the text with each lookup's value in place, and the
 *  result. */
export interface FormulaLine {
  title: string;
  parts: NotePart[];
  /** Null when it would repeat `parts` or `result`: a formula reading nothing, or one that
   *  is a single read. */
  substituted: string | null;
  result: string;
  failed: boolean;
}

export interface GrantFormulas {
  key: number;
  label: string;
  lines: FormulaLine[];
}

/** `ref` explained against `ctx`. A param or scaler links to its parameter's row, an input to
 *  `inputSlotId`, where the bonus's inputs are set. */
function formulaLine(
  title: string,
  ref: FormulaRef,
  ctx: EvalContext,
  slots: Slot[],
  inputSlotId: string,
): FormulaLine {
  const { parts, substituted, result } = explainFormula(ref.formula, ctx);
  const label = formulaLabel(ref, ctx);
  const value = result.ok ? formatNumber(result.value) : result.error;
  return {
    title: label && label !== title ? `${title} (${label})` : title,
    parts: parts.map(({ text, read }) => {
      const slotId =
        read?.kind === "param" || read?.kind === "scaler"
          ? findParamSlot(slots, read.arg ?? "")?.id
          : read?.kind === "input"
            ? inputSlotId
            : undefined;
      return slotId ? { text, slotId } : { text };
    }),
    substituted:
      substituted === ref.formula || substituted === value ? null : substituted,
    result: value,
    failed: !result.ok,
  };
}

/** Every grant of `entry` with a `scale` or `tierBy`, each with its formulas explained against
 *  the build, followed by the named formulas they use. `ctx` is the build's context. */
export function grantFormulas(
  entry: EvaluatedBonus,
  ctx: EvalContext,
  slots: Slot[],
): GrantFormulas[] {
  const own = bonusContext(entry.bonus, ctx, entry.inputValues);
  const named = entry.bonus.formulas ?? {};
  const out: GrantFormulas[] = [];
  entry.grants.forEach((grant, index) => {
    const sites: [string, FormulaRef][] = [];
    if (grant.raw.scale) sites.push(["Scale", grant.raw.scale]);
    if (grant.raw.tierBy && grant.raw.tiers)
      sites.push(["Tier measure", grant.raw.tierBy]);
    if (!sites.length) return;

    // Named formulas in the order they are first used, each once.
    const seen = new Set<string>();
    const visit = (formula: string) => {
      if (typeof formula !== "string") return;
      for (const { name } of parseFormula(formula).reads.named) {
        if (seen.has(name) || !Object.hasOwn(named, name)) continue;
        seen.add(name);
        sites.push([`$${name}`, named[name]]);
        visit(named[name]?.formula);
      }
    };
    for (const [, ref] of [...sites]) visit(ref.formula);

    out.push({
      key: index,
      label: grantLabel(grant),
      lines: sites
        .filter(([, ref]) => typeof ref?.formula === "string")
        .map(([title, ref]) =>
          formulaLine(title, ref, own, slots, entry.slotId),
        ),
    });
  });
  return out;
}
