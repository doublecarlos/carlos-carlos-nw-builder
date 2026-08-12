// Bonus resolution.
//
// Four passes, deliberately order-independent: collect -> evaluate -> exclude -> apply.
// The sheet counted bonus instances by scanning rows *above* the current one while checking
// overrides against *all* rows, so its results could depend on slot ordering. Nothing here does.

import * as conditions from "./conditions";
import { getPath, resolveLinkedItem } from "../lib/build-path";
import { bonusIdOf, occurrenceCountFor } from "../lib/bonus-attachment";
import type {
  Db,
  Build,
  Bonus,
  Grant,
  BonusCandidate,
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
 * stepper already uses) -- see #232.
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
} {
  const counts = build.assignments?.[slot.id] ?? {};
  const statBucket = new Map<string, number>();
  const candidates: Candidate[] = [];

  for (const item of db.forSlot(slot.id)) {
    const count = counts[item.id] ?? item.inlineRepetition!.default;
    if (count <= 0) continue;

    bump(equipped, item.id, count);
    for (const tag of item.tags ?? []) bump(tags, tag, count);

    for (const key of db.schema.statKeys) {
      const raw = item[key];
      if (!raw) continue;
      statBucket.set(key, (statBucket.get(key) ?? 0) + (raw as number) * count);
    }

    const itemInputs = build.occurrenceInputs?.[item.id];
    for (const attachment of item.bonuses ?? []) {
      const bonusId = bonusIdOf(attachment);
      const bonus = db.bonusById.get(bonusId);
      if (!bonus) continue;
      const attachmentCount =
        typeof attachment === "string"
          ? count
          : occurrenceCountFor(attachment, itemInputs);
      bump(bonusOccurrences, bonusId, attachmentCount);
      for (let i = 0; i < attachmentCount; i++) {
        candidates.push({
          bonus,
          bonusId,
          source: item.name,
          slotId: slot.id,
          order,
        });
      }
    }
  }

  return {
    row: { slotId: slot.id, slot, choice: undefined, item: null },
    statBucket,
    candidates,
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
  assignmentStatsBySlot: Map<string, Map<string, number>>;
} {
  const context = build.context ?? {};
  const equipped = new Map<string, number>();
  const tags = new Map<string, number>();
  const bonusOccurrences = new Map<string, number>();
  const rows: ResolvedRow[] = [];
  const candidates: Candidate[] = [];
  const assignmentStatsBySlot = new Map<string, Map<string, number>>();

  db.slots.forEach((slot, order) => {
    // A visual-only row: no choice, no item, nothing to attribute a bonus to.
    if (slot.type === "separator" || slot.type === "text") return;

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
      // No single `item` to attribute this row to -- its stats land in
      // `assignmentStatsBySlot` instead (engine.ts's `rowVectors` adds both alongside
      // `bonusStatsBySlot`).
      if (collected.statBucket.size)
        assignmentStatsBySlot.set(slot.id, collected.statBucket);
      return;
    }

    // A build_parameter row has no entry in `build.choices` -- its "choice" is derived from
    // its current context value instead (`resolveLinkedItem`), so a list/boolean param with a
    // `linkedItem` resolves through the exact same equip/tag/bonus-occurrence/candidate
    // bookkeeping below as an item_picker pick, with no separate branch needed.
    const choice =
      slot.type === "build_parameter"
        ? resolveLinkedItem(slot, context)
        : build.choices?.[slot.id];
    const item = db.get(choice);
    rows.push({ slotId: slot.id, slot, choice, item });
    if (!item) return;

    bump(equipped, item.id);
    for (const tag of item.tags ?? []) bump(tags, tag);

    // Each attachment's occurrence count is its own, not a single count shared by the whole
    // item: an item can carry a plain bare-id bonus (always 1 here -- no repetition concept
    // applies to a single item_picker pick) alongside a BonusOccurrenceConfig for a different
    // bonus (a player-set count), so the two must be resolved and pushed independently. A
    // config's count duplicates its candidate that many times, same as collectInlineRepetition
    // does for its own BonusOccurrenceConfig attachments, so `stacking: "perSource"` sees N
    // sources from one item exactly as it would from N separate item_picker picks.
    const itemInputs = build.occurrenceInputs?.[item.id];
    for (const attachment of item.bonuses ?? []) {
      const bonusId = bonusIdOf(attachment);
      const bonus = db.bonusById.get(bonusId);
      if (!bonus) continue;
      const count = occurrenceCountFor(attachment, itemInputs);
      bump(bonusOccurrences, bonusId, count);
      for (let i = 0; i < count; i++) {
        candidates.push({
          bonus,
          bonusId,
          source: item.name,
          slotId: slot.id,
          order,
        });
      }
    }
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

  // Populate bonus names from the db so conditions can display friendly names
  // instead of internal IDs like "m32-impending-doom-celestial".
  const bonusNames = new Map<string, string>();
  for (const [id, bonus] of db.bonusById) {
    if (bonus.name) bonusNames.set(id, bonus.name);
  }

  const ctx: EvalContext = {
    class: context.class,
    role: context.role,
    combatType: context.combatType,
    damageType: context.damageType,
    duration: context.duration ?? 0,
    toggles: context.toggles ?? {},
    equipped,
    tags,
    bonusOccurrences,
    bonusNames,
    params,
  };

  return { ctx, rows, candidates, assignmentStatsBySlot };
}

// --- pass 2: evaluate ---

/** Resolve one grant against the context into a stat payload (or none). */
function evaluateGrant(
  grant: Grant,
  ctx: EvalContext,
  explain = true,
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
          stats: grant.variants[index].stats,
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
    stats: grant.stats ?? {},
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
): BonusEvaluation {
  const results = (bonus.grants ?? []).map((grant) => ({
    raw: grant,
    ...evaluateGrant(grant, ctx, explain),
  }));
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
}

export function resolve(
  db: Db,
  build: Build,
  { explain = true }: { explain?: boolean } = {},
): ResolvedBonuses {
  const { ctx, rows, candidates, assignmentStatsBySlot } = collect(db, build);

  // Group by bonus id so stacking is decided once per bonus, not once per contributing slot.
  const groups = new Map<string, Group>();
  for (const candidate of candidates) {
    const id = candidate.bonus.id;
    const group = groups.get(id);
    if (group) group.sources.push(candidate);
    else groups.set(id, { id, bonus: candidate.bonus, sources: [candidate] });
  }

  // Evaluate everything before applying any exclusion, so exclusion never cascades and the
  // outcome cannot depend on evaluation order.
  const evaluated: EvaluatedBonus[] = [...groups.values()].map((group) => {
    const result = evaluateBonus(group.bonus, ctx, explain);
    const sources = [...group.sources].sort((a, b) => a.order - b.order);

    let stacks = 1;
    if (group.bonus.stacking === "perSource") {
      stacks = group.bonus.maxStacks
        ? Math.min(sources.length, group.bonus.maxStacks)
        : sources.length;
    }

    return {
      id: group.id,
      bonus: group.bonus,
      bonusId: sources[0].bonusId,
      sources: sources.map((s) => s.source),
      slotId: sources[0].slotId, // instancing slot, used for stat attribution
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
  };
}
