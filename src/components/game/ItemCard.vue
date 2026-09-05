<script setup lang="ts">
// Hover card for an equipped item: its full stat line and every bonus it participates in,
// with the active ones marked and the inactive ones explained.
//
// Pure presentation -- the caller resolves which bonuses belong to the item and positions the
// card. Rendered once by BuildEditor.vue, not once per row: 180 slots must not mean 180 cards.
//
// Interactive: a long card scrolls internally (BaseCardBody, capped by BasePopover's
// max-height), so it must accept the pointer -- the root carries `.itemcard` so
// useHoverCard's window-level scroll listener can tell a scroll inside the card apart from
// one outside it that should close the card. BuildEditor keeps it open while the pointer is
// over it and closes it on leave.
import { computed } from "vue";
import { NW_SCHEMA } from "../../data/data";
import {
  int,
  label as statLabel,
  signedStat,
  stat as formatStat,
} from "../../lib/format";
import { descriptionParagraphs } from "../../lib/description";
import { isHiddenBonus } from "../../engine/bonus";
import { scaledStat } from "../../engine/scaling";
import type { OccurrenceRow } from "../../composables/useItemBonusOccurrences";
import type { DynamicStatConfig } from "../../types";
import type {
  Item,
  Db,
  EvaluatedBonus,
  GrantEvaluation,
  Grant,
  StatValues,
} from "../../types";
import { SquarePen, TriangleAlert } from "@lucide/vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseCardHeader from "../ui/BaseCardHeader.vue";
import BaseCardBody from "../ui/BaseCardBody.vue";
import IconButton from "../ui/IconButton.vue";

const props = withDefaults(
  defineProps<{
    item: Item;
    /** Resolved bonus entries this item takes part in, from `result.bonuses`. */
    bonuses?: EvaluatedBonus[];
    slotLabel?: string;
    /** Only for resolving `item.bonuses` ids to their bonus names in `notes` below. */
    db?: Db | null;
    /** `item`'s own BonusOccurrenceConfig rows (useItemBonusOccurrences.ts) -- same data
     *  ItemPickerRow.vue's checkbox/stepper inputs read, resolved by the caller rather than
     *  here so this component stays prop-driven. Lets an inactive row that's `item`'s own
     *  count-of-0 explain that directly instead of only through a generic unmet-gate
     *  leaf, which reads oddly for a bonus gated on its own occurrence count. */
    occurrenceRows?: OccurrenceRow[];
    /** Mount/companion bolster acting on this item (`itemScaleFactor`), resolved by the caller
     *  rather than read from the store here so this component stays prop-driven. Scales the
     *  item's own stat line only -- the bonus payloads below are attributed to a slot, not
     *  owned by the item. */
    scale?: number;
    /** Lines naming what `scale` came from (`itemScaleNotes`), listed among `notes` so the
     *  card never shows numbers that silently disagree with the catalogue. */
    scaleNotes?: string[];
    /** Tooltip for the header's edit button, naming the layer the edit lands in -- which is
     *  not necessarily the one on screen. Empty hides the button. */
    editLabel?: string;
  }>(),
  {
    bonuses: () => [],
    slotLabel: "",
    db: null,
    occurrenceRows: () => [],
    scale: 1,
    scaleNotes: () => [],
    editLabel: "",
  },
);

defineEmits<{ edit: [] }>();

/** What this item would be swapped for, when the card has a catalogue to ask. */
const replacement = computed(
  () => props.db?.replacementFor(props.item.id) ?? null,
);

const occurrenceRowByBonusId = computed(
  () => new Map(props.occurrenceRows.map((row) => [row.bonusId, row])),
);

/** `item`'s own BonusOccurrenceConfig row for `bonusId`, only when it's the reason this
 *  (inactive) row has nothing to show: at `value: 0`. An active bonus never needs this --
 *  its numbers already speak for themselves -- and a row this item doesn't itself have a
 *  config for (contributed only by other items, or gated on something else entirely) has none
 *  to show either. */
function zeroOccurrenceNote(bonusId: string, active: boolean) {
  if (active) return null;
  const row = occurrenceRowByBonusId.value.get(bonusId);
  return row && row.value === 0 ? row : null;
}

/** Same {key, label, value} shape as the `stats` computed, for one-per-line rendering
 *  anywhere a bonus payload is shown -- the tooltip should read the same way whether it's
 *  the item's own stats or a bonus's. `multiplier` scales for stacking sources (see
 *  `grantRows`'s own doc comment) without needing a separate scaled copy of the stats object. */
function statList(stats: StatValues | null | undefined, multiplier = 1) {
  return Object.entries(stats ?? {}).map(([key, value]) => ({
    key,
    label: statLabel(key),
    value: signedStat(
      key,
      multiplier === 1 ? value : (value ?? 0) * multiplier,
    ),
  }));
}

/** The header badge, scaled like the stat lines below it -- an unscaled figure next to scaled
 *  rows reads as a contradiction rather than as two different numbers. */
const scaledIl = computed(() =>
  int(scaledStat(NW_SCHEMA, props.item, "il", props.scale)),
);

const longDescription = computed(() =>
  descriptionParagraphs(props.item.longDescription),
);

const stats = computed(() => {
  const out: { key: string; label: string; value: string }[] = [];
  for (const key of NW_SCHEMA.statKeys) {
    const value = props.item[key];
    if (!value) continue;
    out.push({
      key,
      label: statLabel(key),
      value: signedStat(
        key,
        scaledStat(NW_SCHEMA, props.item, key, props.scale),
      ),
    });
  }
  return out;
});

/** One line per `DynamicStatConfig` -- shared between an item's own `dynamicStats` (below)
 *  and a grant's (`grantRows`'s preview), same "you choose" phrasing either way. */
function dynamicStatNote(config: DynamicStatConfig): string {
  const lbl = config.label ?? statLabel(config.stat);
  return `${lbl} ${formatStat(config.stat, config.min)}–${formatStat(config.stat, config.max)}, you choose`;
}

/** Notes that are not stats but change whether the item is legal or what it grants. */
const notes = computed(() => {
  const out: string[] = [...props.scaleNotes];
  if (props.item.allowedClass)
    out.push(`${props.item.allowedClass.join(" or ")} only`);
  // The effective cap, so an item inheriting its filter's default still states one.
  const cap = props.db
    ? props.db.maxCopies(props.item)
    : (props.item.maxCopies ?? 0);
  if (cap) out.push(`max ${cap} equipped`);
  for (const config of props.item.dynamicStats ?? []) {
    out.push(dynamicStatNote(config));
  }
  return out;
});

/**
 * A flat, non-stacking bonus can still have more than one contributing item -- e.g. a
 * bonus with no occurrence-count requirement at all, granted once as long as *any*
 * one of its items is worn (M31 Thayan Predator's base +2%, fed by both Runebound Shackle
 * and Sanguine Seal).
 * Every contributing item's own card shows the same resolved total, so owning both reads
 * as "each one gives +2%" when really it is one +2% shared between them. Tiered and
 * per-source-stacking bonuses already explain their own multi-source case (the ladder,
 * and `grantRows`'s own stacking multiplier), so this only fires for the plain leftover case.
 */
function sharedSources(entry: EvaluatedBonus) {
  if (
    !entry.active ||
    tierGrant(entry) ||
    entry.bonus?.stacking === "perSource"
  ) {
    return null;
  }
  const others = [...new Set(entry.sources ?? [])].filter(
    (name) => name !== props.item.name,
  );
  return others.length ? others : null;
}

type ResolvedGrant = GrantEvaluation & { raw: Grant };

/** The one grant (if any) of this bonus that carries a `tiers` ladder. A bonus is a sum
 * of several independent grants now, so "is this bonus tiered" means "does any one of its
 * grants happen to be", not a property of the whole thing. */
function tierGrant(entry: EvaluatedBonus) {
  return entry.grants?.find((g) => g.raw.tiers) ?? null;
}

/**
 * A tiered bonus (e.g. Gladiator's Guile: 10% at 1 occurrence, 15% at 2) has no `when`
 * condition at all -- the occurrence count is matched directly in bonus.ts, so
 * `gate.leaves` is empty and the card would otherwise show "always" next to a number that
 * quietly depends on how many of the bonus's items are equipped. Every contributing item's
 * own card lists the same shared bonus, so without the ladder each one reads as granting
 * the full total on its own. Returns null for a grant with no `tiers`.
 */
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
/**
 * A varied bonus (e.g. role-dependent payloads) picks its first matching branch and, unlike
 * tiers, had no ladder of its own before -- the card only ever showed the winning branch's
 * numbers, with no way to see what the other branches needed or would have granted. This
 * mirrors `tierLadderFor`, using `variantBranches` (bonus.ts's per-branch `explain`, run for
 * every branch, not just up to the first match) so an unmatched branch can show *why* it
 * didn't apply, not just that it didn't. Returns null for a grant with no `variants`.
 */
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

// Bonus state -> dot colour + whether its title/numbers read muted (an inactive/excluded
// bonus's numbers are what it *would* grant, not what it does).
const STATE_DOT: Record<string, string> = {
  active: "bg-ok",
  inactive: "bg-muted opacity-50",
  excluded: "bg-danger",
};

/** Falls back to the grant's own `when` (same label text `entry.gate`/`row.conditions`
 * already use at the bonus level) so an unnamed grant still reads as *something* other than
 * a bare position in the list. Only shown by the template when the bonus has more than one
 * grant -- for the (overwhelmingly common) single-grant case this would just repeat the
 * bonus-level "Conditions: ..." line right above it. */
function grantLabel(grant: ResolvedGrant, index: number) {
  if (grant.raw.name) return grant.raw.name;
  const fromConditions = (grant.gate?.leaves ?? [])
    .map((leaf) => leaf.label)
    .filter(Boolean)
    .join(" + ");
  return fromConditions || `Part ${index + 1}`;
}

/**
 * Every grant of this bonus, one row each -- a bonus is a sum of independent grants, and the
 * bonus-level `conditions`/`unmet`/`stats` fields above collapse that down to one
 * representative grant (evaluateBonus's "closest to unlocking" pick), which hides why every
 * *other* grant is or isn't active. Always has at least one entry; the template only draws
 * the per-grant label/border chrome when there's more than one to distinguish.
 *
 * `stacks` scales an active grant's own stats for perSource stacking (e.g. two rings of the
 * same item) -- `entry.appliedStats` is the already-multiplied bonus total, but a single
 * grant's own `stats` is pre-stacking (bonus.ts multiplies the *summed* grant stats, not each
 * grant individually), so without this a stacking bonus's card would show one copy's worth.
 */
/** A flat grant's preview payload for the inactive/near-miss branch below -- `raw.stats` plus
 *  each `dynamicStats` config's own `default`, same merge `bonus.ts`'s `withDynamicStats`
 *  applies at evaluation time (using the config's default rather than a resolved player value,
 *  since there is nothing resolved to show for a grant that isn't active). `null` for a grant
 *  with neither, or one using `tiers`/`variants` instead (those preview through their own
 *  ladder helpers above). */
function previewStatsFor(raw: Grant): StatValues | null {
  if (raw.tiers || raw.variants) return null;
  if (!raw.stats && !raw.dynamicStats?.length) return null;
  const merged: StatValues = { ...(raw.stats ?? {}) };
  for (const config of raw.dynamicStats ?? []) {
    merged[config.stat] = (merged[config.stat] ?? 0) + config.default;
  }
  return merged;
}

function grantRows(entry: EvaluatedBonus) {
  const stacks = entry.stacks ?? 1;
  // A `perSource`-stacking bonus's preview (no active stack to total up) is what *one* stack
  // would grant, not a flat always-on number -- label it as such so it doesn't read like the
  // bonus already grants this regardless of stack count.
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

const rows = computed(() =>
  props.bonuses
    .filter((entry) => !isHiddenBonus(entry.bonus))
    .map((entry) => {
      const sharedWith = sharedSources(entry);
      // `sources` is sorted deterministically upstream (bonus.ts, by evaluation order), so
      // every card agrees on which one is "first" without any cross-item coordination.
      const isFirst =
        !entry.sources?.length || entry.sources[0] === props.item.name;
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
        conditions: (entry.gate?.leaves ?? [])
          .map((leaf) => leaf.label)
          .filter(Boolean)
          .join(" + "),
        zeroOccurrence: zeroOccurrenceNote(entry.id, entry.active),
        excludedBy: entry.excludedBy,
        // Every active grant's own longDescription, in grant order -- a bonus with more than
        // one descriptive grant shows each (rare: usually only one grant per bonus bothers).
        // Flattened to paragraphs: each already renders as its own line, so a grant that
        // breaks its description needs nothing else to tell the halves apart.
        descriptions: (entry.grants ?? [])
          .filter((g) => g.active)
          .flatMap((g) => descriptionParagraphs(g.raw.longDescription)),
        stacks: entry.stacks ?? 1,
        grants: grantRows(entry),
        sharedWith,
        // A shared bonus is real numbers on exactly one card and a pointer everywhere else
        // -- showing the same total on every contributing card reads as each one granting
        // it independently, when they share credit for one thing.
        secondary: Boolean(sharedWith) && !isFirst,
        firstSource: entry.sources?.[0] ?? null,
      };
    }),
);
</script>

<template>
  <!-- Content inside the tooltip -- positioning, z-index, scroll, and max dimensions
       are handled by BasePopover. Internal structure uses BaseCard for the visual frame. -->
  <BaseCard class="itemcard">
    <BaseCardHeader sticky>
      <span class="flex-1 font-semibold" data-testid="item-card-name">{{
        item.name
      }}</span>
      <span v-if="item.il" class="tabular-nums text-muted"
        >iL {{ scaledIl }}</span
      >
      <IconButton
        v-if="editLabel"
        :title="editLabel"
        class="-my-1 -mr-1"
        data-testid="item-card-edit"
        @click="$emit('edit')"
      >
        <SquarePen />
      </IconButton>
    </BaseCardHeader>
    <BaseCardBody>
      <div v-if="slotLabel" class="mb-1 text-muted">
        {{ slotLabel }}
      </div>
      <!-- The one fact on this card the player has to act on, so it outweighs the stats. -->
      <div
        v-if="item.hideFromPicker || replacement"
        class="mb-1.5 flex items-start gap-1.5 rounded-md border border-warn bg-warn/25 px-1.5 py-1 font-semibold text-warn"
        data-testid="item-card-retired"
      >
        <TriangleAlert class="mt-0.5 h-[14px] w-[14px] shrink-0" />
        <span>
          <template v-if="item.hideFromPicker"
            >Retired: no longer offered as a new pick.</template
          >
          <template v-if="replacement">
            Replaced by {{ replacement.name }}.
          </template>
        </span>
      </div>
      <div
        v-if="longDescription.length"
        class="mb-1.5"
        data-testid="item-card-long-description"
      >
        <p
          v-for="(paragraph, index) in longDescription"
          :key="index"
          class="mt-1 first:mt-0"
        >
          {{ paragraph }}
        </p>
      </div>
      <div class="flex flex-col divide-y divide-line">
        <div
          v-for="stat in stats"
          :key="stat.key"
          class="flex justify-between gap-2 py-0.5 hover:shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"
        >
          <span>{{ stat.label }}</span
          ><span class="tabular-nums">{{ stat.value }}</span>
        </div>
        <div v-if="!stats.length" class="text-muted">no direct stats</div>
      </div>

      <div
        v-if="notes.length"
        class="mt-1.5 border-y border-line py-1 text-muted"
      >
        <div v-for="note in notes" :key="note">{{ note }}</div>
      </div>

      <div v-if="rows.length" class="mt-1.5">
        <div class="uppercase tracking-wide text-muted">Bonuses</div>
        <div v-for="row in rows" :key="row.id" class="mt-1">
          <div class="flex items-center gap-1.5">
            <span
              class="size-1.5 flex-none rounded-full"
              :class="row.dotClass"
            ></span>
            <span class="min-w-0 flex-1" :class="row.muted && 'text-muted'">{{
              row.name || row.conditions || "always"
            }}</span>
            <BaseBadge v-if="row.stacks > 1">×{{ row.stacks }}</BaseBadge>
          </div>
          <div
            v-if="row.name && row.conditions"
            class="pl-3 leading-snug text-muted"
            data-testid="item-card-bonus-conditions"
          >
            Conditions: {{ row.conditions }}
          </div>
          <div
            v-if="row.zeroOccurrence"
            class="pl-3 leading-snug text-muted"
            data-testid="item-card-bonus-zero-occurrence"
          >
            {{ row.zeroOccurrence.label }}:
            {{
              row.zeroOccurrence.kind === "checkbox"
                ? "off on this item"
                : "0 on this item"
            }}
          </div>
          <div
            v-for="(desc, index) in row.descriptions"
            :key="index"
            class="pl-3 leading-snug"
          >
            {{ desc }}
          </div>
          <div v-if="row.secondary" class="pl-3 leading-snug text-muted">
            This bonus was accounted for in {{ row.firstSource }}
          </div>
          <template v-else>
            <div v-if="row.sharedWith" class="pl-3 leading-snug text-muted">
              Other parts: {{ row.sharedWith.join(", ") }}
            </div>

            <!-- One block per grant -- own label, own active state, own ladder/unmet. The
                 label/border chrome only appears once there's more than one grant to tell
                 apart; a single grant already reads fine under the bonus's own name/dot and
                 "Conditions: ..." line above, so repeating that here would just be noise. -->
            <div class="pl-3">
              <div
                v-for="g in row.grants"
                :key="g.key"
                :class="
                  row.grants.length > 1 &&
                  'mt-1.5 border-l-2 border-t-2 border-b-2 border-line pl-2 pt-1.5'
                "
              >
                <div
                  v-if="row.grants.length > 1"
                  class="flex items-center gap-1.5"
                  :class="!g.active && 'text-muted'"
                >
                  <span
                    class="size-1.5 flex-none rounded-full"
                    :class="g.active ? 'bg-ok' : 'bg-muted opacity-50'"
                  ></span>
                  <span class="min-w-0 flex-1">{{ g.label }}</span>
                </div>
                <div v-if="g.problem" class="text-warn">
                  {{ g.problem.message }}
                </div>
                <template v-else-if="g.tiers">
                  <div
                    v-for="tier in g.tiers"
                    :key="tier.atLeast"
                    class=""
                    :class="
                      tier.active ? 'font-semibold text-text' : 'text-muted'
                    "
                  >
                    <div>{{ tier.atLeast }} equipped:</div>
                    <div class="flex flex-col divide-y divide-line">
                      <div
                        v-for="s in tier.stats"
                        :key="s.key"
                        class="flex justify-between gap-2 py-0.5 ml-4 hover:shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"
                      >
                        <span>{{ s.label }}</span
                        ><span class="tabular-nums">{{ s.value }}</span>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else-if="g.variants">
                  <div class="divide-y divide-line divide-y-2">
                    <div
                      v-for="v in g.variants"
                      :key="v.key"
                      class="py-1"
                      :class="
                        v.active ? 'font-semibold text-text' : 'text-muted'
                      "
                    >
                      <div>{{ v.label }}:</div>
                      <div class="flex flex-col divide-y divide-line">
                        <div
                          v-for="s in v.stats"
                          :key="s.key"
                          class="flex justify-between gap-2 py-0.5 hover:shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"
                        >
                          <span>{{ s.label }}</span
                          ><span class="tabular-nums">{{ s.value }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <div
                  v-else-if="g.stats"
                  class="flex flex-col divide-y divide-line"
                  :class="!g.active && 'text-muted'"
                >
                  <div
                    v-if="row.stacks > 1 && g.active"
                    class="leading-snug text-muted"
                  >
                    total, from {{ row.stacks }} stacking sources
                  </div>
                  <div v-if="g.eachStack" class="leading-snug text-muted">
                    each stack would give:
                  </div>
                  <div
                    v-for="s in g.stats"
                    :key="s.key"
                    class="flex justify-between gap-2 py-0.5 hover:shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"
                  >
                    <span>{{ s.label }}</span
                    ><span class="tabular-nums">{{ s.value }}</span>
                  </div>
                </div>
                <div
                  v-for="(leaf, i) in g.unmet"
                  :key="i"
                  class="text-warn"
                  data-testid="item-card-bonus-unmet"
                >
                  needs {{ leaf.label
                  }}<span v-if="leaf.detail"> - {{ leaf.detail }}</span>
                </div>
              </div>
            </div>
          </template>
          <div v-if="row.excludedBy" class="pl-3 text-warn">
            overridden by {{ row.excludedBy }}
          </div>
        </div>
      </div>
    </BaseCardBody>
  </BaseCard>
</template>
