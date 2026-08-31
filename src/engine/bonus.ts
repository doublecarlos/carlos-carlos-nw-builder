// Bonus resolution.
//
// Four passes, deliberately order-independent: collect -> evaluate -> exclude -> apply.
// The sheet counted bonus instances by scanning rows *above* the current one while checking
// overrides against *all* rows, so its results could depend on slot ordering. Nothing here does.

import * as conditions from "./conditions";
import { getPath } from "../lib/build-path";
import { bonusIdOf, occurrenceCountFor } from "../lib/bonus-attachment";
import { inlineRepetitionCount } from "../lib/inline-repetition";
import { expandSlots } from "../lib/item-picker-list";
import { readDynamicValue } from "../lib/dynamic-stats";
import type {
  PublishConflict,
  Db,
  Build,
  Bonus,
  Grant,
  Item,
  BonusCandidate,
  DynamicStatConfig,
  EvalContext,
  ConditionExplain,
  ConditionWhen,
  GrantEvaluation,
  BonusEvaluation,
  EvaluatedBonus,
  PointAssignmentSlot,
  ResolvedBonuses,
  ResolvedRow,
  StatValues,
} from "../types";

const bump = (
  map: Map<string, number>,
  key: string | null | undefined,
  amount = 1,
) => {
  if (key == null || amount <= 0) return;
  map.set(key, (map.get(key) ?? 0) + amount);
};

/** A `BonusCandidate` (one item's contribution of one bonus) plus where/when it was
 * instanced -- collect()'s per-slot bookkeeping, not part of the candidate itself. */
interface Candidate extends BonusCandidate {
  slotId: string;
  order: number;
}

// --- pass 1: collect ---

/**
 * Pushes one `Candidate` per occurrence of one item's bonus attachment -- shared between the
 * item_picker/build_parameter branch and `collectInlineRepetition`'s point_assignment items,
 * the only difference being what `repetitions` (a bare-id attachment's count) resolves to.
 *
 * `repetitions === 0` means the *item itself* has zero real occurrences right now -- a
 * point_assignment candidate with nothing spent on it, or an item_picker pick whose
 * own `inlineRepetition` sits at 0 -- still walked so its bonuses stay reachable for a
 * hover/inspector preview (see below), not actually "in" the build. Every attachment reads as 0
 * then, including a typed (`BonusOccurrenceConfig`) one's own stored value -- there's nothing
 * here to independently resolve one against. An item with no `inlineRepetition` at all never
 * reaches 0 (an unchosen slot is not walked, and a chosen one is worth exactly 1).
 *
 * Either way, a 0-count attachment has no real candidate to push -- but dropping it silently
 * leaves its bonus completely unreachable in `resolve()`'s evaluate pass whenever nothing else
 * contributes it either, so a hover card/inspector can't tell "typed to 0" (or "0 points spent")
 * apart from "doesn't carry this bonus at all". An anchor-only entry goes to
 * `zeroCandidates` instead, just to make the bonus reachable -- it is never counted as a source
 * (stacking, attribution), only used as a fallback slot/order to resolve against when a bonus
 * has no real source anywhere.
 */
function collectAttachments(
  item: Item,
  build: Build,
  bonusById: Map<string, Bonus>,
  slotId: string,
  order: number,
  bonusOccurrences: Map<string, number>,
  candidates: Candidate[],
  zeroCandidates: Candidate[],
  repetitions = 1,
) {
  const itemInputs = build.occurrenceInputs?.[item.id];
  for (const attachment of item.bonuses ?? []) {
    const bonusId = bonusIdOf(attachment);
    const bonus = bonusById.get(bonusId);
    if (!bonus) continue;
    const count =
      repetitions === 0
        ? 0
        : typeof attachment === "string"
          ? repetitions
          : occurrenceCountFor(attachment, itemInputs);
    bump(bonusOccurrences, bonusId, count);
    if (count === 0) {
      zeroCandidates.push({ bonus, bonusId, source: item.name, slotId, order });
      continue;
    }
    for (let i = 0; i < count; i++) {
      candidates.push({ bonus, bonusId, source: item.name, slotId, order });
    }
  }
}

/**
 * One point_assignment slot's contribution -- every point behaves exactly like one more
 * item_picker slot choosing that item, so this bumps `equipped`/tags by each item's own
 * `inlineRepetition` count (into the caller's running maps) and sums the row's own stats into a
 * bucket (engine.ts's `rowVectors` adds this alongside `bonusStatsBySlot`).
 *
 * A bonus attachment's own occurrence count follows the same split `collect()`'s item_picker
 * branch would if a single item could carry both shapes: a bare-id attachment scales with the
 * item's own repetition count (N repetitions read as N picks of that bonus, same as N picks of
 * the item itself), while a `BonusOccurrenceConfig` attachment carries its own typed, independent
 * count (`build.occurrenceInputs`, the same per-item storage an item_picker item's occurrence
 * stepper already uses).
 */
function collectInlineRepetition(
  slot: PointAssignmentSlot,
  build: Build,
  db: Db,
  order: number,
  equipped: Map<string, number>,
  tags: Map<string, number>,
  bonusOccurrences: Map<string, number>,
): {
  row: ResolvedRow;
  statBucket: Map<string, number>;
  candidates: Candidate[];
  zeroCandidates: Candidate[];
} {
  const counts = build.assignments?.[slot.id] ?? {};
  const statBucket = new Map<string, number>();
  const candidates: Candidate[] = [];
  const zeroCandidates: Candidate[] = [];

  for (const item of db.forSlot(slot.id)) {
    const count = counts[item.id] ?? item.inlineRepetition!.default;

    // At 0 points the item contributes no stats/tags of its own -- only its bonus attachments
    // still need walking, for reachability (see collectAttachments's own doc comment).
    if (count > 0) {
      bump(equipped, item.id, count);
      for (const tag of item.tags ?? []) bump(tags, tag, count);

      for (const key of db.schema.statKeys) {
        const raw = item[key];
        if (!raw) continue;
        statBucket.set(
          key,
          (statBucket.get(key) ?? 0) + (raw as number) * count,
        );
      }
    }

    collectAttachments(
      item,
      build,
      db.bonusById,
      slot.id,
      order,
      bonusOccurrences,
      candidates,
      zeroCandidates,
      count,
    );
  }

  return {
    row: {
      slotId: slot.id,
      slot,
      choice: undefined,
      item: null,
      repetitions: 0,
    },
    statBucket,
    candidates,
    zeroCandidates,
  };
}

/**
 * Walk the build's slots once and gather everything a condition can read.
 *
 * Counts are per *contributing slot*, not per distinct item: two rings of a bonus is two
 * occurrences, and the same insignia slotted twice is two occurrences. Tags are counted the same way.
 * (The legacy engine deduped qualifiers by item name, but since every tag condition is
 * `atLeast: 1` that difference can never be observable.)
 */
export function collect(
  db: Db,
  build: Build,
): {
  ctx: EvalContext;
  rows: ResolvedRow[];
  candidates: Candidate[];
  zeroCandidates: Candidate[];
  assignmentStatsBySlot: Map<string, Map<string, number>>;
  publishConflicts: PublishConflict[];
} {
  const context = build.context ?? {};
  const equipped = new Map<string, number>();
  const tags = new Map<string, number>();
  const bonusOccurrences = new Map<string, number>();
  const rows: ResolvedRow[] = [];
  const candidates: Candidate[] = [];
  const zeroCandidates: Candidate[] = [];
  const assignmentStatsBySlot = new Map<string, Map<string, number>>();
  /** path -> every equipped item asserting a value for it (`Item.publishes`). Collected during
   *  the slot walk purely because that is where the equipped items are already in hand; nothing
   *  is decided from it until the walk is over, so slot order cannot affect the outcome. */
  const publishedBy = new Map<
    string,
    { itemId: string; slotId: string; value: string | number | boolean }[]
  >();

  // Expanded, not `db.slots`: a list's rows are ordinary picks the engine has to resolve, and
  // `order` is the expanded position, which is the order the editor renders in.
  expandSlots(db.slots, build).forEach((slot, order) => {
    // No choice, no item, nothing to attribute a bonus to -- a list container included, its
    // rows carry the picks.
    if (
      slot.type === "separator" ||
      slot.type === "text" ||
      slot.type === "item_picker_list"
    )
      return;

    if (slot.type === "point_assignment") {
      const collected = collectInlineRepetition(
        slot,
        build,
        db,
        order,
        equipped,
        tags,
        bonusOccurrences,
      );
      rows.push(collected.row);
      candidates.push(...collected.candidates);
      zeroCandidates.push(...collected.zeroCandidates);
      // No single `item` to attribute this row to -- its stats land in
      // `assignmentStatsBySlot` instead (engine.ts's `rowVectors` adds both alongside
      // `bonusStatsBySlot`).
      if (collected.statBucket.size)
        assignmentStatsBySlot.set(slot.id, collected.statBucket);
      return;
    }

    // A build_parameter never equips anything: it is the scalar itself. Anything that needs
    // to both carry stats and set a context value is an `item_picker` whose item publishes the
    // value, so there is one path into the bookkeeping below rather than two.
    const choice = build.choices?.[slot.id];
    const item = db.get(choice);
    // A pick declaring an `inlineRepetition` is in the build that many times over, read from
    // the same `build.assignments` store a point_assignment row uses. Anything else is in once.
    const repetitions = item ? inlineRepetitionCount(build, slot.id, item) : 0;
    rows.push({ slotId: slot.id, slot, choice, item, repetitions });
    if (!item) return;

    // At 0 the pick contributes nothing of its own, but its attachments are still walked below
    // -- same reachability reason `collectInlineRepetition` gives.
    if (repetitions > 0) {
      bump(equipped, item.id, repetitions);
      for (const tag of item.tags ?? []) bump(tags, tag, repetitions);
      for (const [path, value] of Object.entries(item.publishes ?? {})) {
        const contributors = publishedBy.get(path);
        if (contributors)
          contributors.push({ itemId: item.id, slotId: slot.id, value });
        else
          publishedBy.set(path, [{ itemId: item.id, slotId: slot.id, value }]);
      }
    }

    // Each attachment's occurrence count is its own, not a single count shared by the whole
    // item: an item can carry a plain bare-id bonus (`repetitions` -- 1 for an ordinary pick,
    // N for one repeating inline) alongside a BonusOccurrenceConfig for a different
    // bonus (a player-set count), so the two must be resolved and pushed independently. A
    // config's count duplicates its candidate that many times, same as collectInlineRepetition
    // does for its own BonusOccurrenceConfig attachments, so `stacking: "perSource"` sees N
    // sources from one item exactly as it would from N separate item_picker picks.
    collectAttachments(
      item,
      build,
      db.bonusById,
      slot.id,
      order,
      bonusOccurrences,
      candidates,
      zeroCandidates,
      repetitions,
    );
  });

  // Every build_parameter's current value, by its path -- what the `param` leaf reads. A slot
  // the build has no value for falls back to its declared `default`, so a condition reads
  // exactly what the UI shows.
  const params = new Map<string, string | number | boolean>();
  for (const slot of db.slots) {
    if (slot.type !== "build_parameter") continue;
    const value = getPath(context, slot.path);
    const resolved = (value === undefined ? slot.default : value) as
      string | number | boolean | undefined;
    if (resolved !== undefined) params.set(slot.path, resolved);
  }

  // Every equipped item's `publishes`, folded in over the slot-derived values above. A path
  // several items agree on is not a conflict -- that is what equipping two copies of one item
  // looks like -- so only *differing* values are reported, and a conflicted path is left out of
  // `params` entirely rather than resolved to an arbitrary winner.
  const publishConflicts: PublishConflict[] = [];
  const published = new Map<string, string | number | boolean>();
  for (const [path, contributors] of publishedBy) {
    const distinct = new Set(contributors.map((entry) => entry.value));
    if (distinct.size > 1) {
      publishConflicts.push({ path, contributors });
      params.delete(path);
      continue;
    }
    const value = contributors[0].value;
    params.set(path, value);
    published.set(path, value);
  }

  // Populate bonus names from the db so conditions can display friendly names
  // instead of internal IDs like "m32-impending-doom-celestial".
  const bonusNames = new Map<string, string>();
  for (const [id, bonus] of db.bonusById) {
    if (bonus.name) bonusNames.set(id, bonus.name);
  }

  // The three dedicated leaves read their own `EvalContext` field rather than `params`, so a
  // published value has to reach both -- `class` is the one that actually travels this way
  // today (its param slot is an `item_picker` now), but the fallback keeps the two in step for
  // any path that later moves the same way.
  const scalar = (path: string, stored: string | undefined) =>
    (published.get(path) as string | undefined) ?? stored;

  const ctx: EvalContext = {
    class: scalar("class", context.class),
    role: scalar("role", context.role),
    damageType: scalar("damageType", context.damageType),
    duration: context.duration ?? 0,
    enemies: context.enemies ?? 0,
    toggles: context.toggles ?? {},
    equipped,
    tags,
    bonusOccurrences,
    bonusNames,
    params,
  };

  return {
    ctx,
    rows,
    candidates,
    zeroCandidates,
    assignmentStatsBySlot,
    publishConflicts,
  };
}

// --- pass 2: evaluate ---

/** Merges resolved dynamic-stat values into a base stat payload -- `dynamicValues` is keyed by
 *  stat (see `resolveDynamicValues` below), already defaulted, so this is a plain sum. Returns
 *  `stats` unchanged (same reference) when `configs` is empty, so a grant with no dynamic
 *  stats never allocates a new object here. */
function withDynamicStats(
  stats: StatValues,
  configs: DynamicStatConfig[] | undefined,
  dynamicValues: Record<string, number>,
): StatValues {
  if (!configs?.length) return stats;
  const out: StatValues = { ...stats };
  for (const config of configs) {
    out[config.stat] =
      (out[config.stat] ?? 0) + (dynamicValues[config.stat] ?? config.default);
  }
  return out;
}

/** Resolve one grant against the context into a stat payload (or none). `dynamicValues` is
 *  this grant's owning bonus's resolved dynamic-stat values (bonus.ts's `resolve`), already
 *  keyed by stat and defaulted -- see `resolveDynamicValues`. */
function evaluateGrant(
  grant: Grant,
  ctx: EvalContext,
  explain = true,
  dynamicValues: Record<string, number> = {},
): GrantEvaluation {
  const gate: ConditionExplain = explain
    ? conditions.explain(grant.when, ctx)
    : {
        ok: conditions.evaluate(grant.when, ctx),
        leaves: [],
        unmet: [],
      };

  if (!gate.ok)
    return { active: false, gate, stats: null, chose: null, problem: null };

  // `problem`: reports a build error/warning instead of granting stats.
  if (grant.problem) {
    return {
      active: true,
      gate,
      stats: null,
      chose: "problem",
      problem: grant.problem,
    };
  }

  // `variants`: first match wins (role-dependent payloads). When explaining, every branch is
  // evaluated (not just up to the first match) so the hover card can show why the *other*
  // branches didn't apply too, not only the one that won.
  if (grant.variants) {
    const variantBranches = explain
      ? grant.variants.map((v) => conditions.explain(v.when, ctx))
      : undefined;
    const index = variantBranches
      ? variantBranches.findIndex((b) => b.ok)
      : grant.variants.findIndex((v) => conditions.evaluate(v.when, ctx));
    return index === -1
      ? {
          active: false,
          gate,
          stats: null,
          chose: null,
          problem: null,
          variantBranches,
        }
      : {
          active: true,
          gate,
          stats: withDynamicStats(
            grant.variants[index].stats,
            grant.variants[index].dynamicStats,
            dynamicValues,
          ),
          chose: `variant:${index}`,
          problem: null,
          variantBranches,
        };
  }

  // `tiers`: highest matching occurrence threshold wins. Payloads are absolute, not cumulative
  // -- the legacy exact-match on occurrence count made them mutually exclusive.
  if (grant.tiers) {
    let best: (typeof grant.tiers)[number] | null = null;
    let bestAt = -1;
    for (const tier of grant.tiers) {
      const need = tier.bonusOccurrences?.atLeast ?? 1;
      // `tier.bonusOccurrences.bonus` is optional on the type (GrantTier) but not on
      // `ConditionWhen.bonusOccurrences` -- see types.ts: an *actually* bonusless tier still
      // reaches `conditions.evaluate` and fails closed there (`bonusOccurrences.bonus`
      // undefined -> 0 occurrences counted), so this cast changes nothing at runtime.
      if (
        need > bestAt &&
        conditions.evaluate(
          {
            bonusOccurrences:
              tier.bonusOccurrences as ConditionWhen["bonusOccurrences"],
          },
          ctx,
        )
      ) {
        best = tier;
        bestAt = need;
      }
    }
    return best
      ? {
          active: true,
          gate,
          stats: best.stats,
          chose: `tier:${bestAt}`,
          problem: null,
        }
      : { active: false, gate, stats: null, chose: null, problem: null };
  }

  return {
    active: true,
    gate,
    stats: withDynamicStats(
      grant.stats ?? {},
      grant.dynamicStats,
      dynamicValues,
    ),
    chose: "stats",
    problem: null,
  };
}

/**
 * True when a bonus has no business appearing in a "bonuses" listing (ItemCard.vue,
 * BonusInspector.vue), active or not -- currently just the problem-only case: every grant it
 * carries has a `problem` payload, so the bonus exists purely to report a build error/warning,
 * never stats. That's already surfaced inline on its slot and in the errors summary
 * (engine.ts's `bonusProblems`), so showing it again as a would-be bonus that never grants
 * anything is just noise. A single predicate rather than one flag per reason, so a future
 * "hide this from listings" case (an internal bookkeeping bonus, say) has one place to join in.
 */
export function isHiddenBonus(bonus: Bonus): boolean {
  const grants = bonus.grants ?? [];
  return grants.length > 0 && grants.every((g) => g.problem != null);
}

/**
 * Resolve a whole bonus: every grant it carries, summed. A bonus is one unit -- its final
 * stats are the sum of every currently-active grant, not one independently-tracked row
 * per grant.
 */
export function evaluateBonus(
  bonus: Bonus,
  ctx: EvalContext,
  explain = true,
  dynamicValues: Record<string, number> = {},
  { hasSources = true }: { hasSources?: boolean } = {},
): BonusEvaluation {
  const evaluated = (bonus.grants ?? []).map((grant) => ({
    raw: grant,
    ...evaluateGrant(grant, ctx, explain, dynamicValues),
  }));
  // `hasSources: false` (resolve()'s zero-sources group) forces every grant inactive regardless
  // of what its own `when` resolves to -- there is nothing occurring to grant it for. Not just
  // the bonus-level `active` below: an unconditional grant (no `when` at all, e.g. Shattered
  // Resolve's flat per-stack payload) would otherwise stay `active: true` on its own, and some
  // consumers (ItemCard.vue, useDynamicStats.ts) read each grant's own `.active` directly rather
  // than the bonus-level one. `gate`/`raw` stay real either way, for the near-miss branch.
  const results = hasSources
    ? evaluated
    : evaluated.map((r) => ({ ...r, active: false, stats: null, chose: null }));
  const activeResults = results.filter((r) => r.active);
  const active = activeResults.length > 0;

  const stats: Record<string, number> = {};
  for (const r of activeResults) {
    for (const [key, value] of Object.entries(r.stats ?? {})) {
      stats[key] = (stats[key] ?? 0) + (value as number);
    }
  }

  const problems = activeResults
    .map((r) => r.problem)
    .filter((p): p is NonNullable<typeof p> => p != null);

  // Only meaningful -- and only shown as a badge -- when exactly one grant is active and it
  // resolved via a tier/variant pick; two simultaneously-active grants have no single "chose"
  // to report, and a plain flat grant's "stats" chose was never shown either.
  const chose =
    activeResults.length === 1 && activeResults[0].chose !== "stats"
      ? activeResults[0].chose
      : null;

  // Fully inactive: pick the grant with the fewest unmet conditions as the near-miss
  // representative (ties broken by array order) -- "what you are closest to unlocking",
  // same philosophy bonus-inspector.js already documents, just resolved per-grant now.
  let gate: ConditionExplain = { ok: true, leaves: [], unmet: [] };
  let previewStats: StatValues | null = null;
  if (!active) {
    const best = results.reduce(
      (a, b) =>
        (b.gate.unmet?.length ?? 0) < (a?.gate.unmet?.length ?? Infinity)
          ? b
          : a,
      results[0],
    );
    gate = best?.gate ?? gate;
    previewStats = best?.raw.stats ?? null; // only a flat grant has a raw `.stats` to preview
  }

  return {
    active,
    gate,
    stats: active ? stats : null,
    chose,
    previewStats,
    grants: results,
    problems,
  };
}

// --- passes 3 and 4: exclude, then apply ---

interface Group {
  id: string;
  bonus: Bonus;
  sources: Candidate[];
  /** Only set for a zero-sources group (resolve(), from `zeroCandidates`) -- the candidate
   *  that made this bonus reachable despite contributing no real occurrence, used as a
   *  slotId/order/bonusId fallback wherever `sources[0]` would otherwise be read. Absent for
   *  any group with at least one real source. */
  anchor?: Candidate;
}

/** Every dynamic-stat value this bonus's grants/variants declare, resolved against `slotId`
 *  (the bonus's first contributing source by build order -- see the "instancing slot" comment
 *  below) and defaulted, keyed by stat. Two configs across different grants/variants of the
 *  same bonus targeting the same stat share one stored value -- there is only one slot this
 *  bonus resolves its dynamic values against, regardless of which of its grants asks. */
function resolveDynamicValues(
  bonus: Bonus,
  build: Build,
  slotId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const grant of bonus.grants ?? []) {
    for (const config of grant.dynamicStats ?? []) {
      out[config.stat] = readDynamicValue(build, slotId, config, bonus.id);
    }
    for (const variant of grant.variants ?? []) {
      for (const config of variant.dynamicStats ?? []) {
        out[config.stat] = readDynamicValue(build, slotId, config, bonus.id);
      }
    }
  }
  return out;
}

export function resolve(
  db: Db,
  build: Build,
  { explain = true }: { explain?: boolean } = {},
): ResolvedBonuses {
  const {
    ctx,
    rows,
    candidates,
    zeroCandidates,
    assignmentStatsBySlot,
    publishConflicts,
  } = collect(db, build);

  // Group by bonus id so stacking is decided once per bonus, not once per contributing slot.
  const groups = new Map<string, Group>();
  for (const candidate of candidates) {
    const id = candidate.bonus.id;
    const group = groups.get(id);
    if (group) group.sources.push(candidate);
    else groups.set(id, { id, bonus: candidate.bonus, sources: [candidate] });
  }
  // Seed a sources-less group for each zero-only attachment collectAttachments() flagged --
  // see its doc comment for why -- but only where nothing real already reached this bonus; a
  // group with at least one real source is untouched.
  for (const anchor of zeroCandidates) {
    if (!groups.has(anchor.bonus.id)) {
      groups.set(anchor.bonus.id, {
        id: anchor.bonus.id,
        bonus: anchor.bonus,
        sources: [],
        anchor,
      });
    }
  }

  // Evaluate everything before applying any exclusion, so exclusion never cascades and the
  // outcome cannot depend on evaluation order.
  const evaluated: EvaluatedBonus[] = [...groups.values()].map((group) => {
    // Sorted before evaluating (not after, as a plain stat-attribution readout could afford
    // to) -- resolving this bonus's dynamic values needs its first slot up front, since that
    // resolution feeds straight into `evaluateBonus`'s stats, not just `EvaluatedBonus.slotId`.
    // A zero-sources group has no real candidate to sort/read here, so it falls back to the
    // anchor that made it reachable in the first place (always set in that case).
    const sources = [...group.sources].sort((a, b) => a.order - b.order);
    const anchor = sources[0] ?? group.anchor!;
    const dynamicValues = resolveDynamicValues(
      group.bonus,
      build,
      anchor.slotId,
    );
    const result = evaluateBonus(group.bonus, ctx, explain, dynamicValues, {
      hasSources: sources.length > 0,
    });

    let stacks = 1;
    if (group.bonus.stacking === "perSource") {
      stacks = group.bonus.maxStacks
        ? Math.min(sources.length, group.bonus.maxStacks)
        : sources.length;
    }

    return {
      id: group.id,
      bonus: group.bonus,
      bonusId: anchor.bonusId,
      sources: sources.map((s) => s.source),
      slotId: anchor.slotId, // instancing slot, used for stat attribution
      active: result.active,
      gate: result.gate,
      chose: result.chose,
      stats: result.stats,
      previewStats: result.previewStats,
      grants: result.grants,
      problems: result.problems,
      stacks,
      excluded: false,
      excludedBy: null as string | null,
    };
  });

  // Exclusions come from equipped items (legacy `bonus_overrides`) and from active bonuses.
  const excluded = new Map<string, string>();
  for (const row of rows) {
    for (const id of row.item?.excludes ?? []) excluded.set(id, row.item!.name);
  }
  for (const entry of evaluated) {
    if (!entry.active) continue;
    for (const id of entry.bonus.excludes ?? []) excluded.set(id, entry.id);
  }
  for (const entry of evaluated) {
    const by = excluded.get(entry.id);
    if (by != null && by !== entry.id) {
      entry.excluded = true;
      entry.excludedBy = by;
      entry.active = false;
    }
  }

  // Attribute each active bonus's stats back to the slot that instanced it. Multiplicative
  // stats combine per row in the pipeline, so an item and its own bonus must land on the
  // same row -- exactly as the sheet did.
  //
  // `stats` stays the per-stack payload (what the inspector should show next to "×2");
  // `appliedStats` is what actually reaches the pipeline. Keeping both explicit avoids the
  // easy mistake of reading `stats` and wondering why stacking "doesn't work".
  const bonusStatsBySlot = new Map<string, Map<string, number>>();
  for (const entry of evaluated) {
    if (!entry.active || !entry.stats) {
      entry.appliedStats = null;
      continue;
    }
    entry.appliedStats =
      entry.stacks === 1
        ? { ...entry.stats }
        : Object.fromEntries(
            Object.entries(entry.stats).map(([key, value]) => [
              key,
              (value as number) * entry.stacks,
            ]),
          );

    const bucket = bonusStatsBySlot.get(entry.slotId) ?? new Map();
    for (const [key, value] of Object.entries(entry.appliedStats)) {
      bucket.set(key, (bucket.get(key) ?? 0) + (value as number));
    }
    bonusStatsBySlot.set(entry.slotId, bucket);
  }

  return {
    ctx,
    rows,
    bonuses: evaluated,
    bonusStatsBySlot,
    assignmentStatsBySlot,
    publishConflicts,
  };
}
