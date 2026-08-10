<script setup lang="ts">
// Hover card for an equipped item: its full stat line and every bonus it participates in,
// with the active ones marked and the inactive ones explained.
//
// Pure presentation -- the caller resolves which bonuses belong to the item and positions the
// card. Rendered once by BuildEditor.vue, not once per row: 180 slots must not mean 180 cards.
//
// Interactive (see this file's own <style> block): a long card scrolls, so it must accept
// the pointer. BuildEditor
// keeps it open while the pointer is over it and closes it on leave.
import { computed } from "vue";
import { NW_SCHEMA } from "../../data/data";
import { label as statLabel, signedStat } from "../../lib/format";
import { isHiddenBonus } from "../../engine/bonus";
import type { Item, Db, EvaluatedBonus, StatValues } from "../../types";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseCardHeader from "../ui/BaseCardHeader.vue";
import BaseCardBody from "../ui/BaseCardBody.vue";

const props = withDefaults(
  defineProps<{
    item: Item;
    /** Resolved bonus entries this item takes part in, from `result.bonuses`. */
    bonuses?: EvaluatedBonus[];
    slotLabel?: string;
    /** Only for resolving `item.bonuses` group ids to their set names in `notes` below. */
    db?: Db | null;
  }>(),
  {
    bonuses: () => [],
    slotLabel: "",
    db: null,
  },
);

/** Same {key, label, value} shape as the `stats` computed, for one-per-line rendering
 *  anywhere a bonus payload is shown -- the tooltip should read the same way whether it's
 *  the item's own stats or a bonus's. */
function statList(stats: StatValues | null | undefined) {
  return Object.entries(stats ?? {}).map(([key, value]) => ({
    key,
    label: statLabel(key),
    value: signedStat(key, value),
  }));
}

const stats = computed(() => {
  const out: { key: string; label: string; value: string }[] = [];
  for (const key of NW_SCHEMA.statKeys) {
    const value = props.item[key];
    if (!value) continue;
    out.push({
      key,
      label: statLabel(key),
      value: signedStat(key, value as number),
    });
  }
  return out;
});

/** Notes that are not stats but change whether the item is legal or what it grants. */
const notes = computed(() => {
  const out: string[] = [];
  if (props.item.allowedClass)
    out.push(`${props.item.allowedClass.join(" or ")} only`);
  if (props.item.maxCopies) out.push(`max ${props.item.maxCopies} equipped`);
  if (props.item.dynamicStat) {
    const lbl = statLabel(props.item.dynamicStat);
    out.push(
      `${lbl} ${props.item.dynamicMin}–${props.item.dynamicMax}, you choose`,
    );
  }
  return out;
});

/**
 * A flat, non-stacking bonus can still have more than one contributing item -- e.g. a
 * set effect with no piece requirement at all, granted once as long as *any* piece is
 * worn (M31 Thayan Predator's base +2%, fed by both Runebound Shackle and Sanguine Seal).
 * Every contributing item's own card shows the same resolved total, so owning both reads
 * as "each one gives +2%" when really it is one +2% shared between them. Tiered and
 * per-source-stacking bonuses already explain their own multi-source case (the ladder,
 * and `payload().each`), so this only fires for the plain leftover case.
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

/** The one grant (if any) of this bonus that carries a `tiers` ladder. A bonus is a sum
 * of several independent grants now, so "is this bonus tiered" means "does any one of its
 * grants happen to be", not a property of the whole thing. */
function tierGrant(entry: EvaluatedBonus) {
  return entry.grants?.find((g) => g.raw.tiers) ?? null;
}

/**
 * A tiered set bonus (e.g. Gladiator's Guile: 10% at 1 piece, 15% at 2) has no `when`
 * condition at all -- the piece count is matched directly in bonus.ts, so `gate.leaves`
 * is empty and the card would otherwise show "always" next to a number that quietly
 * depends on how many pieces of the set are equipped. Every piece's own card lists the
 * same shared bonus, so without the ladder each ring reads as granting the full total on
 * its own. Returns null for a bonus with no tiered grant.
 */
function tierLadder(entry: EvaluatedBonus) {
  const grant = tierGrant(entry);
  const tiers = grant?.raw.tiers;
  if (!tiers?.length) return null;
  const activeAt =
    grant!.active && grant!.chose?.startsWith("tier:")
      ? Number(grant!.chose.slice("tier:".length))
      : null;
  return tiers
    .map((tier) => ({
      pieces: tier.pieces?.atLeast ?? 1,
      stats: statList(tier.stats),
    }))
    .sort((a, b) => a.pieces - b.pieces)
    .map((tier) => ({ ...tier, active: tier.pieces === activeAt }));
}

/**
 * Active bonuses report what actually reached the pipeline (`appliedStats`); inactive
 * ones can only offer a preview of the grant closest to unlocking (`previewStats`, null
 * for a tiered/varied one that hasn't chosen a branch at all).
 *
 * When several sources stack (e.g. two rings of the same item), `appliedStats` is the
 * combined total and `entry.stats` (the resolved sum of active grants, pre-stacking) is
 * what one copy grants. Showing only the total on *each* ring's own card reads as "this
 * ring alone gives +15%" -- when really the two rings share credit for it. `each` carries
 * the per-copy figure so the template can spell that out; it is null whenever there is
 * nothing to disambiguate (stacks === 1).
 */
function payload(entry: EvaluatedBonus) {
  const stats = entry.active ? entry.appliedStats : entry.previewStats;
  if (!stats)
    return tierGrant(entry) ? { total: null, each: null, tiered: true } : null;

  const stacks = entry.stacks ?? 1;
  const each = entry.active && stacks > 1 ? statList(entry.stats) : null;
  return { total: statList(stats), each, tiered: false };
}

// Bonus state -> dot colour + whether its title/numbers read muted (an inactive/excluded
// bonus's numbers are what it *would* grant, not what it does).
const STATE_DOT: Record<string, string> = {
  active: "bg-ok",
  inactive: "bg-muted opacity-50",
  excluded: "bg-danger",
};

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
        unmet: entry.gate?.unmet ?? [],
        excludedBy: entry.excludedBy,
        // Every active grant's own longDescription, in grant order -- a set with more than
        // one descriptive grant shows each (rare: usually only one grant per set bothers).
        descriptions: (entry.grants ?? [])
          .filter((g) => g.active && g.raw.longDescription)
          .map((g) => g.raw.longDescription as string),
        stats: payload(entry),
        stacks: entry.stacks ?? 1,
        tiers: tierLadder(entry),
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
  <BaseCard>
    <BaseCardHeader sticky>
      <span class="flex-1 font-semibold" data-testid="item-card-name">{{
        item.name
      }}</span>
      <span v-if="item.il" class="text-sm tabular-nums text-muted"
        >iL {{ item.il.toLocaleString() }}</span
      >
    </BaseCardHeader>
    <BaseCardBody>
      <div v-if="slotLabel" class="mb-1 text-sm text-muted">
        {{ slotLabel }}
      </div>
      <div
        v-if="item.longDescription"
        class="mb-1.5 text-sm"
        data-testid="item-card-long-description"
      >
        {{ item.longDescription }}
      </div>
      <div class="flex flex-col">
        <div
          v-for="stat in stats"
          :key="stat.key"
          class="flex justify-between gap-2 border-b border-line py-0.5 text-sm last:border-b-0"
        >
          <span>{{ stat.label }}</span
          ><span class="tabular-nums">{{ stat.value }}</span>
        </div>
        <div v-if="!stats.length" class="text-muted">no direct stats</div>
      </div>

      <div
        v-if="notes.length"
        class="mt-1.5 border-t border-line pt-1 text-sm text-muted"
      >
        <div v-for="note in notes" :key="note">{{ note }}</div>
      </div>

      <div v-if="rows.length" class="mt-1.5 border-t border-line pt-1">
        <div class="text-sm uppercase tracking-wide text-muted">Bonuses</div>
        <div v-for="row in rows" :key="row.id" class="mt-1">
          <div class="flex items-center gap-1.5">
            <span
              class="size-1.5 flex-none rounded-full"
              :class="row.dotClass"
            ></span>
            <span
              class="min-w-0 flex-1 text-sm"
              :class="row.muted && 'text-muted'"
              >{{ row.name || row.conditions || "always" }}</span
            >
            <BaseBadge v-if="row.stacks > 1">×{{ row.stacks }}</BaseBadge>
          </div>
          <div
            v-if="row.name && row.conditions"
            class="pl-3 text-sm leading-snug text-muted"
          >
            Conditions: {{ row.conditions }}
          </div>
          <div
            v-for="desc in row.descriptions"
            :key="desc"
            class="pl-3 text-sm leading-snug"
          >
            {{ desc }}
          </div>
          <div
            v-if="row.secondary"
            class="pl-3 text-sm leading-snug text-muted"
          >
            This bonus was accounted for in {{ row.firstSource }}
          </div>
          <template v-else>
            <div
              v-if="row.sharedWith"
              class="pl-3 text-sm leading-snug text-muted"
            >
              Other parts: {{ row.sharedWith.join(", ") }}
            </div>
            <div
              v-if="row.stats && row.stats.tiered"
              class="pl-3 text-sm text-muted"
            >
              (tiered)
            </div>
            <div
              v-else-if="row.stats"
              class="pl-3 text-sm"
              :class="row.muted && 'text-muted'"
            >
              <div
                v-if="row.stacks > 1"
                class="text-sm leading-snug text-muted"
              >
                total, from {{ row.stacks }} stacking sources
              </div>
              <div class="flex flex-col">
                <div
                  v-for="s in row.stats.total"
                  :key="s.key"
                  class="flex justify-between gap-2 border-b border-line py-0.5 last:border-b-0"
                >
                  <span>{{ s.label }}</span
                  ><span class="tabular-nums">{{ s.value }}</span>
                </div>
              </div>
              <template v-if="row.stats.each">
                <div class="text-sm leading-snug text-muted">each:</div>
                <div class="flex flex-col">
                  <div
                    v-for="s in row.stats.each"
                    :key="s.key"
                    class="flex justify-between gap-2 border-b border-line py-0.5 last:border-b-0"
                  >
                    <span>{{ s.label }}</span
                    ><span class="tabular-nums">{{ s.value }}</span>
                  </div>
                </div>
              </template>
            </div>
          </template>
          <div v-if="row.tiers" class="pl-3">
            <div class="text-sm leading-snug text-muted">
              tiered by set pieces, shared by every piece:
            </div>
            <div
              v-for="tier in row.tiers"
              :key="tier.pieces"
              class="text-sm"
              :class="tier.active ? 'font-semibold text-text' : 'text-muted'"
            >
              <div>
                {{ tier.pieces }} piece{{ tier.pieces > 1 ? "s" : "" }}:
              </div>
              <div class="flex flex-col">
                <div
                  v-for="s in tier.stats"
                  :key="s.key"
                  class="flex justify-between gap-2 py-0.5"
                >
                  <span>{{ s.label }}</span
                  ><span class="tabular-nums">{{ s.value }}</span>
                </div>
              </div>
            </div>
          </div>

          <div
            v-for="(leaf, i) in row.unmet"
            :key="i"
            class="pl-3 text-sm text-warn"
          >
            needs {{ leaf.label
            }}<span v-if="leaf.detail"> — {{ leaf.detail }}</span>
          </div>
          <div v-if="row.excludedBy" class="pl-3 text-sm text-warn">
            overridden by {{ row.excludedBy }}
          </div>
        </div>
      </div>
    </BaseCardBody>
  </BaseCard>
</template>
