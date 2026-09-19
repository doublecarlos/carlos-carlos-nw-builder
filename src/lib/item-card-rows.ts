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

export interface StatLine {
  key: string;
  label: string;
  value: string;
  /** Muted line under the value saying why it differs from the catalog, e.g. the real value
   *  and the scaler behind a scaled one. */
  note?: string;
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
// active tier is read off `chose` instead of the gate.
function tierLadderFor(grant: ResolvedGrant | null) {
  const tiers = grant?.raw.tiers;
  if (!tiers?.length) return null;
  const activeAt =
    grant!.active && grant!.chose?.startsWith("tier:")
      ? Number(grant!.chose.slice("tier:".length))
      : null;
  return tiers
    .map((tier) => ({
      atLeast: tier.bonusOccurrences?.atLeast ?? 1,
      stats: statList(tier.stats),
    }))
    .sort((a, b) => a.atLeast - b.atLeast)
    .map((tier) => ({ ...tier, active: tier.atLeast === activeAt }));
}

// `variantBranches` explains every branch, not just the winner, so an unmatched one can
// show why it didn't apply.
function variantLadderFor(grant: ResolvedGrant | null) {
  const variants = grant?.raw.variants;
  if (!variants?.length) return null;
  const activeIndex =
    grant!.active && grant!.chose?.startsWith("variant:")
      ? Number(grant!.chose.slice("variant:".length))
      : null;
  const branches = grant!.variantBranches ?? [];
  return variants.map((variant, index) => ({
    key: index,
    label:
      (branches[index]?.leaves ?? [])
        .map((leaf) => leaf.label)
        .filter(Boolean)
        .join(" + ") || "always on",
    stats: statList(variant.stats),
    active: index === activeIndex,
    unmet: branches[index]?.unmet ?? [],
  }));
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

// "x 40.00% Encounter Damage": the factor as every scaled line spells it, so the stat notes
// and the ladder caption read as one statement.
function scaleFactorText(scale: GrantScale) {
  return `x ${pct(scale.multiplier)} ${scale.label}`;
}

// Puts the real (unscaled) value and the factor under each scaled line, in the voice the
// item's own "Mount bolster 125.00% applied" note uses: the number shown never silently
// disagrees with the catalog.
function withScaleNotes(
  lines: StatLine[],
  unscaled: StatValues,
  scale: GrantScale,
): StatLine[] {
  const factor = scaleFactorText(scale);
  return lines.map((line) => ({
    ...line,
    note: `${formatStat(line.key, unscaled[line.key])} ${factor}`,
  }));
}

// The scaler on a grant, for the card to caption its ladder and, at a multiplier of 0, to
// say the share is unset and point at the parameter that sets it. Null slot id when the
// catalog is not at hand (the layer editor's preview card), leaving the text without a link.
function scaleRowFor(scale: GrantScale | undefined, slots: Slot[]) {
  if (!scale) return null;
  return {
    label: scale.label,
    factor: scaleFactorText(scale),
    unset: scale.multiplier === 0,
    slotId: findParamSlot(slots, scale.path)?.id ?? null,
  };
}

// A flat grant's lines: the live payload times `stacks` while active (`appliedStats` is
// already multiplied at the bonus level, but a single grant's `stats` is not), else the
// preview. A scaled grant shows the effective number either way, with the real one beside it,
// so an inactive preview never promises more than the live line would give.
function grantStatLines(
  grant: ResolvedGrant,
  preview: StatValues | null,
  stacks: number,
): StatLine[] | null {
  const scale = grant.scale;
  if (grant.active && grant.stats) {
    const lines = statList(grant.stats, stacks);
    return scale?.unscaled
      ? withScaleNotes(lines, scale.unscaled, scale)
      : lines;
  }
  if (!preview) return null;
  return scale
    ? withScaleNotes(statList(preview, scale.multiplier), preview, scale)
    : statList(preview);
}

/** One row per grant of `entry`, with each stat line already formatted. `slots` resolves a
 *  scaler's parameter slot for the "share is unset" link. Shared with BonusInspector.vue,
 *  which shows the scaled grants' lines under the bonus payload. */
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
      tiers: tierLadderFor(grant),
      variants: variantLadderFor(grant),
      eachStack: stacking && preview != null,
      descriptions: grant.active
        ? descriptionParagraphs(
            grant.raw.longDescription || grant.raw.shortDescription,
          )
        : [],
      stats: grantStatLines(grant, preview, stacks),
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
