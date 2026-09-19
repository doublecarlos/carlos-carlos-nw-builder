// ItemCard.vue's bonus-row derivation, Vue-free so it is unit-testable.
import {
  bonusTitle,
  label as statLabel,
  pct,
  signedStat,
  stat as formatStat,
} from "./format";
import { descriptionParagraphs } from "./description";
import { findParamSlot } from "./build-path";
import { isHiddenBonus } from "../engine/bonus";
import type { OccurrenceRow } from "../composables/useItemBonusOccurrences";
import type {
  BonusSource,
  EvaluatedBonus,
  Grant,
  GrantEvaluation,
  GrantScale,
  Item,
  Slot,
  StatValues,
} from "../types";

type ResolvedGrant = GrantEvaluation & { raw: Grant };

/** One run of a stat line's note. A part carrying a slot id is a scaler's name and renders as
 *  a link to that parameter's row; without one it is plain text. */
export interface NotePart {
  text: string;
  slotId?: string;
}

export interface StatLine {
  key: string;
  label: string;
  value: string;
  /** Muted line under the value saying why it differs from the catalog: the real value and
   *  every scaler behind a scaled one, e.g. "15.00% x 40.00% Encounter Damage". */
  note?: NotePart[];
}

/** What a note needs to know about one scaler acting on a value: `ResolvedScaler` and
 *  `GrantScale` both carry these fields. */
export type ScaleFactor = Pick<GrantScale, "label" | "multiplier" | "path">;

/**
 * The note under a scaled stat line, shared by an item's bolstered rows and a scaled grant's so
 * the two read identically: the catalog's real value, then "x <multiplier> <scaler>" once per
 * scaler. Scalers compose multiplicatively (scaling.ts's `scaleFactorFor`), so listing each
 * factor in turn keeps every label next to its own number and every link on its own name. The
 * scaler's name links to its parameter slot when `slots` has it; without a catalog (the layer
 * editor's preview card) it stays text.
 */
export function scaleNote(
  rawValue: number | undefined,
  statKey: string,
  scalers: ScaleFactor[],
  slots: Slot[],
): NotePart[] {
  const parts: NotePart[] = [];
  let text = formatStat(statKey, rawValue);
  for (const { label, multiplier, path } of scalers) {
    text += ` x ${pct(multiplier)} `;
    const slotId = findParamSlot(slots, path)?.id;
    parts.push({ text }, slotId ? { text: label, slotId } : { text: label });
    text = "";
  }
  return parts;
}

// `multiplier` scales a perSource-stacking grant's own pre-stacking stats for display.
export function statList(
  stats: StatValues | null | undefined,
  multiplier = 1,
): StatLine[] {
  return Object.entries(stats ?? {}).map(([key, value]) => ({
    key,
    label: statLabel(key),
    value: signedStat(
      key,
      multiplier === 1 ? value : (value ?? 0) * multiplier,
    ),
  }));
}

// Only surfaced for an inactive row whose reason is this item's own count sitting at 0.
function zeroOccurrenceNote(
  bonusId: string,
  active: boolean,
  occurrenceRowByBonusId: Map<string, OccurrenceRow>,
) {
  if (active) return null;
  const row = occurrenceRowByBonusId.get(bonusId);
  return row && row.value === 0 ? row : null;
}

// Other items crediting the same non-tiered, non-stacking bonus, so it doesn't read as
// each item granting it independently. One entry per name, pointing at that name's first
// slot: two rings of one item are one part, not two.
function sharedSources(
  entry: EvaluatedBonus,
  itemName: string,
): BonusSource[] | null {
  if (
    !entry.active ||
    tierGrant(entry) ||
    entry.bonus?.stacking === "perSource"
  ) {
    return null;
  }
  const others = new Map<string, BonusSource>();
  for (const source of entry.sources ?? []) {
    if (source.name !== itemName && !others.has(source.name)) {
      others.set(source.name, source);
    }
  }
  return others.size ? [...others.values()] : null;
}

// The excluder's title and instancing slot, so a row can link to it. An id the map does
// not know keeps its text with no slot to link to. Shared with BonusInspector.vue.
export function excluderFor(
  entry: EvaluatedBonus,
  bonusById: Map<string, EvaluatedBonus>,
): BonusSource | null {
  if (!entry.excludedBy) return null;
  const excluder = bonusById.get(entry.excludedBy);
  return excluder
    ? { name: bonusTitle(excluder), slotId: excluder.slotId }
    : { name: entry.excludedBy, slotId: "" };
}

function tierGrant(entry: EvaluatedBonus) {
  return entry.grants?.find((g) => g.raw.tiers) ?? null;
}

// Tiers have no `when` of their own (bonus.ts matches occurrence count directly), so the
// active tier is read off `chose` instead of the gate. Every rung shows what it would grant
// under the grant's scaler, with the real value in its note.
function tierLadderFor(grant: ResolvedGrant | null, slots: Slot[]) {
  const tiers = grant?.raw.tiers;
  if (!tiers?.length) return null;
  const activeAt =
    grant!.active && grant!.chose?.startsWith("tier:")
      ? Number(grant!.chose.slice("tier:".length))
      : null;
  return tiers
    .map((tier) => {
      const atLeast = tier.bonusOccurrences?.atLeast ?? 1;
      const active = atLeast === activeAt;
      return {
        atLeast,
        active,
        stats: rungLines(tier.stats, active, grant!, slots),
      };
    })
    .sort((a, b) => a.atLeast - b.atLeast);
}

// `variantBranches` explains every branch, not just the winner, so an unmatched one can
// show why it didn't apply.
function variantLadderFor(grant: ResolvedGrant | null, slots: Slot[]) {
  const variants = grant?.raw.variants;
  if (!variants?.length) return null;
  const activeIndex =
    grant!.active && grant!.chose?.startsWith("variant:")
      ? Number(grant!.chose.slice("variant:".length))
      : null;
  const branches = grant!.variantBranches ?? [];
  return variants.map((variant, index) => {
    const active = index === activeIndex;
    return {
      key: index,
      label:
        (branches[index]?.leaves ?? [])
          .map((leaf) => leaf.label)
          .filter(Boolean)
          .join(" + ") || "always on",
      stats: rungLines(variant.stats, active, grant!, slots),
      active,
      unmet: branches[index]?.unmet ?? [],
    };
  });
}

function grantLabel(grant: ResolvedGrant) {
  if (grant.raw.name) return grant.raw.name;
  const fromConditions = (grant.gate?.leaves ?? [])
    .map((leaf) => leaf.label)
    .filter(Boolean)
    .join(" + ");
  return fromConditions || "always on";
}

// An inactive grant's near-miss preview: raw stats plus each dynamicStats config's default,
// the same merge bonus.ts applies when the grant is live. Null for tiers/variants, which
// preview through their own ladder helpers above.
function previewStatsFor(raw: Grant): StatValues | null {
  if (raw.tiers || raw.variants) return null;
  if (!raw.stats && !raw.dynamicStats?.length) return null;
  const merged: StatValues = { ...(raw.stats ?? {}) };
  for (const config of raw.dynamicStats ?? []) {
    merged[config.stat] = (merged[config.stat] ?? 0) + config.default;
  }
  return merged;
}

// Every line scaled and annotated: the effective value on the row, the real one and the
// scaler in the note, so the number shown never silently disagrees with the catalog.
function scaledLines(
  unscaled: StatValues,
  scale: GrantScale,
  slots: Slot[],
): StatLine[] {
  return statList(unscaled, scale.multiplier).map((line) => ({
    ...line,
    note: scaleNote(unscaled[line.key], line.key, [scale], slots),
  }));
}

// A ladder rung's lines, scaled like the flat grant's when the grant names a scaler. The live
// rung reads the engine's own unscaled payload (which includes any typed dynamic stat) so its
// number is exactly what the build was granted.
function rungLines(
  stats: StatValues | undefined,
  active: boolean,
  grant: ResolvedGrant,
  slots: Slot[],
): StatLine[] {
  const scale = grant.scale;
  if (!scale) return statList(stats);
  const unscaled = (active ? scale.unscaled : null) ?? stats ?? {};
  return scaledLines(unscaled, scale, slots);
}

// The scaler on a grant, for the card to say the share is unset at a multiplier of 0 and point
// at the parameter that sets it. Null slot id when the catalog is not at hand (the layer
// editor's preview card), leaving the text without a link.
function scaleRowFor(scale: GrantScale | undefined, slots: Slot[]) {
  if (!scale) return null;
  return {
    label: scale.label,
    unset: scale.multiplier === 0,
    slotId: findParamSlot(slots, scale.path)?.id ?? null,
  };
}

// A flat grant's lines: the live payload times `stacks` while active (`appliedStats` is
// already multiplied at the bonus level, but a single grant's `stats` is not), else the
// preview. A scaled grant shows the effective number either way, with the real one under it,
// so an inactive preview never promises more than the live line would give.
function grantStatLines(
  grant: ResolvedGrant,
  preview: StatValues | null,
  stacks: number,
  slots: Slot[],
): StatLine[] | null {
  const scale = grant.scale;
  if (grant.active && grant.stats) {
    const lines = statList(grant.stats, stacks);
    const unscaled = scale?.unscaled;
    if (!unscaled) return lines;
    return lines.map((line) => ({
      ...line,
      note: scaleNote(unscaled[line.key], line.key, [scale], slots),
    }));
  }
  if (!preview) return null;
  return scale ? scaledLines(preview, scale, slots) : statList(preview);
}

/** One row per grant of `entry`, with each stat line already formatted. `slots` resolves a
 *  scaler's parameter slot for the note and "share is unset" links. Shared with
 *  BonusInspector.vue, which shows the scaled grants' lines under the bonus payload. */
export function grantRows(entry: EvaluatedBonus, slots: Slot[] = []) {
  const stacks = entry.stacks ?? 1;
  const stacking = entry.bonus?.stacking === "perSource";
  return (entry.grants ?? []).map((grant, index) => {
    const preview = grant.active ? null : previewStatsFor(grant.raw);
    return {
      key: index,
      label: grantLabel(grant),
      active: grant.active,
      unmet: grant.gate?.unmet ?? [],
      problem: grant.problem,
      tiers: tierLadderFor(grant, slots),
      variants: variantLadderFor(grant, slots),
      eachStack: stacking && preview != null,
      descriptions: grant.active
        ? descriptionParagraphs(
            grant.raw.longDescription || grant.raw.shortDescription,
          )
        : [],
      stats: grantStatLines(grant, preview, stacks, slots),
      scale: scaleRowFor(grant.scale, slots),
    };
  });
}

export type GrantRow = ReturnType<typeof grantRows>[number];

export type ItemCardRow = ReturnType<typeof buildItemCardRow>;

function buildItemCardRow(
  entry: EvaluatedBonus,
  item: Item,
  occurrenceRowByBonusId: Map<string, OccurrenceRow>,
  bonusById: Map<string, EvaluatedBonus>,
  slots: Slot[],
) {
  const sharedWith = sharedSources(entry, item.name);
  const isFirst =
    !entry.sources?.length || entry.sources[0]?.name === item.name;
  const state = entry.excluded
    ? "excluded"
    : entry.active
      ? "active"
      : "inactive";
  return {
    id: entry.id,
    state,
    dotClass: STATE_DOT[state],
    muted: state !== "active",
    name: entry.bonus?.name ?? null,
    zeroOccurrence: zeroOccurrenceNote(
      entry.id,
      entry.active,
      occurrenceRowByBonusId,
    ),
    excludedBy: excluderFor(entry, bonusById),
    stacks: entry.stacks ?? 1,
    grants: grantRows(entry, slots),
    sharedWith,
    // A shared bonus shows real numbers on exactly one card; the rest point to it.
    secondary: Boolean(sharedWith) && !isFirst,
    firstSource: entry.sources?.[0] ?? null,
  };
}

const STATE_DOT: Record<string, string> = {
  active: "bg-ok",
  inactive: "bg-muted opacity-50",
  excluded: "bg-danger",
};

// `bonusById` covers the whole build, not just `bonuses`: an excluder usually sits on
// another item. `slots` is the catalog's slot list, for linking a scaled grant to its
// scaler's parameter.
export function itemCardRows(
  item: Item,
  bonuses: EvaluatedBonus[],
  occurrenceRows: OccurrenceRow[],
  bonusById: Map<string, EvaluatedBonus> = new Map(),
  slots: Slot[] = [],
): ItemCardRow[] {
  const occurrenceRowByBonusId = new Map(
    occurrenceRows.map((row) => [row.bonusId, row]),
  );
  return bonuses
    .filter((entry) => !isHiddenBonus(entry.bonus))
    .map((entry) =>
      buildItemCardRow(entry, item, occurrenceRowByBonusId, bonusById, slots),
    );
}
