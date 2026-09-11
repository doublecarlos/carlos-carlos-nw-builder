// ItemCard.vue's bonus-row derivation, Vue-free so it is unit-testable.
import { label as statLabel, signedStat } from "./format";
import { descriptionParagraphs } from "./description";
import { isHiddenBonus } from "../engine/bonus";
import type { OccurrenceRow } from "../composables/useItemBonusOccurrences";
import type {
  EvaluatedBonus,
  Grant,
  GrantEvaluation,
  Item,
  StatValues,
} from "../types";

type ResolvedGrant = GrantEvaluation & { raw: Grant };

export interface StatLine {
  key: string;
  label: string;
  value: string;
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
// each item granting it independently.
function sharedSources(entry: EvaluatedBonus, itemName: string) {
  if (
    !entry.active ||
    tierGrant(entry) ||
    entry.bonus?.stacking === "perSource"
  ) {
    return null;
  }
  const others = [...new Set(entry.sources?.map((s) => s.name) ?? [])].filter(
    (name) => name !== itemName,
  );
  return others.length ? others : null;
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
        .join(" + ") || "always",
    stats: statList(variant.stats),
    active: index === activeIndex,
    unmet: branches[index]?.unmet ?? [],
  }));
}

function grantLabel(grant: ResolvedGrant, index: number) {
  if (grant.raw.name) return grant.raw.name;
  const fromConditions = (grant.gate?.leaves ?? [])
    .map((leaf) => leaf.label)
    .filter(Boolean)
    .join(" + ");
  return fromConditions || `Part ${index + 1}`;
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

// `stacks` scales an active grant's own (pre-stacking) stats: `appliedStats` is already
// multiplied at the bonus level, but a single grant's `stats` is not.
function grantRows(entry: EvaluatedBonus) {
  const stacks = entry.stacks ?? 1;
  const stacking = entry.bonus?.stacking === "perSource";
  return (entry.grants ?? []).map((grant, index) => {
    const preview = grant.active ? null : previewStatsFor(grant.raw);
    return {
      key: index,
      label: grantLabel(grant, index),
      active: grant.active,
      unmet: grant.gate?.unmet ?? [],
      problem: grant.problem,
      tiers: tierLadderFor(grant),
      variants: variantLadderFor(grant),
      eachStack: stacking && preview != null,
      stats:
        grant.active && grant.stats
          ? statList(grant.stats, stacks)
          : preview
            ? statList(preview)
            : null,
    };
  });
}

export type ItemCardRow = ReturnType<typeof buildItemCardRow>;

// The bonus-level gate is only populated while the bonus is inactive, and a lone grant's own
// `when` is never drawn as a labelled block. Folding both is what lets a one-grant bonus state
// its conditions either way; deduped, since the inactive case reports the same gate twice.
function conditionsFor(entry: EvaluatedBonus) {
  const grants = entry.grants ?? [];
  const leaves = [
    ...(entry.gate?.leaves ?? []),
    ...(grants.length === 1 ? (grants[0].gate?.leaves ?? []) : []),
  ];
  const labels = leaves.map((leaf) => leaf.label).filter(Boolean);
  return [...new Set(labels)].join(" + ");
}

function buildItemCardRow(
  entry: EvaluatedBonus,
  item: Item,
  occurrenceRowByBonusId: Map<string, OccurrenceRow>,
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
    conditions: conditionsFor(entry),
    zeroOccurrence: zeroOccurrenceNote(
      entry.id,
      entry.active,
      occurrenceRowByBonusId,
    ),
    excludedBy: entry.excludedBy,
    descriptions: (entry.grants ?? [])
      .filter((g) => g.active)
      .flatMap((g) =>
        descriptionParagraphs(g.raw.longDescription || g.raw.shortDescription),
      ),
    stacks: entry.stacks ?? 1,
    grants: grantRows(entry),
    sharedWith,
    // A shared bonus shows real numbers on exactly one card; the rest point to it.
    secondary: Boolean(sharedWith) && !isFirst,
    firstSource: entry.sources?.[0]?.name ?? null,
  };
}

const STATE_DOT: Record<string, string> = {
  active: "bg-ok",
  inactive: "bg-muted opacity-50",
  excluded: "bg-danger",
};

export function itemCardRows(
  item: Item,
  bonuses: EvaluatedBonus[],
  occurrenceRows: OccurrenceRow[],
): ItemCardRow[] {
  const occurrenceRowByBonusId = new Map(
    occurrenceRows.map((row) => [row.bonusId, row]),
  );
  return bonuses
    .filter((entry) => !isHiddenBonus(entry.bonus))
    .map((entry) => buildItemCardRow(entry, item, occurrenceRowByBonusId));
}
