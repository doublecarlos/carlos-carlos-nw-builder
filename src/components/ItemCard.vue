<script setup lang="ts">
// Hover card for an equipped item: its full stat line and every bonus it participates in,
// with the active ones marked and the inactive ones explained.
//
// Pure presentation -- the caller resolves which bonuses belong to the item and positions the
// card. Rendered once by SlotList.vue, not once per row: 180 slots must not mean 180 cards.
//
// Interactive (see app.css): a long card scrolls, so it must accept the pointer. SlotList
// keeps it open while the pointer is over it and closes it on leave.
import { computed } from 'vue';
import { NW_SCHEMA } from '../data';
import { label as statLabel, signedStat } from '../format';
import type { Item, Db, EvaluatedBonus, StatValues } from '../types';

const props = withDefaults(defineProps<{
  item: Item;
  /** Resolved bonus entries this item takes part in, from `result.bonuses`. */
  bonuses?: EvaluatedBonus[];
  slotLabel?: string;
  /** Only for resolving `item.bonuses` group ids to their set names in `notes` below. */
  db?: Db | null;
}>(), {
  bonuses: () => [],
  slotLabel: '',
  db: null,
});

/** Same {key, label, value} shape as the `stats` computed, for one-per-line rendering
 *  anywhere a bonus payload is shown -- the tooltip should read the same way whether it's
 *  the item's own stats or a bonus's. */
function statList(stats: StatValues | null | undefined) {
  return Object.entries(stats ?? {}).map(([key, value]) => (
    { key, label: statLabel(key), value: signedStat(key, value) }
  ));
}

const stats = computed(() => {
  const out: { key: string; label: string; value: string }[] = [];
  for (const key of NW_SCHEMA.statKeys) {
    const value = props.item[key];
    if (!value) continue;
    out.push({ key, label: statLabel(key), value: signedStat(key, value as number) });
  }
  return out;
});

/** Notes that are not stats but change whether the item is legal or what it grants. */
const notes = computed(() => {
  const out: string[] = [];
  if (props.item.allowedClass) out.push(`${props.item.allowedClass.join(' or ')} only`);
  if (props.item.maxCopies) out.push(`max ${props.item.maxCopies} equipped`);
  if (props.item.dynamicStat) {
    const lbl = statLabel(props.item.dynamicStat);
    out.push(`${lbl} ${props.item.dynamicMin}–${props.item.dynamicMax}, you choose`);
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
  if (!entry.active || tierGrant(entry) || entry.bonus?.stacking === 'perSource') {
    return null;
  }
  const others = [...new Set(entry.sources ?? [])].filter((name) => name !== props.item.name);
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
  const activeAt = grant!.active && grant!.chose?.startsWith('tier:')
    ? Number(grant!.chose.slice('tier:'.length))
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
  if (!stats) return tierGrant(entry) ? { total: null, each: null, tiered: true } : null;

  const stacks = entry.stacks ?? 1;
  const each = entry.active && stacks > 1 ? statList(entry.stats) : null;
  return { total: statList(stats), each, tiered: false };
}

const rows = computed(() => props.bonuses.map((entry) => {
  const sharedWith = sharedSources(entry);
  // `sources` is sorted deterministically upstream (bonus.ts, by evaluation order), so
  // every card agrees on which one is "first" without any cross-item coordination.
  const isFirst = !entry.sources?.length || entry.sources[0] === props.item.name;
  return {
    id: entry.id,
    state: entry.excluded ? 'excluded' : (entry.active ? 'active' : 'inactive'),
    name: entry.bonus?.name ?? null,
    conditions: (entry.gate?.leaves ?? []).map((leaf) => leaf.label).filter(Boolean)
      .join(' + '),
    unmet: entry.gate?.unmet ?? [],
    excludedBy: entry.excludedBy,
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
}));
</script>

<template>
  <div class="itemcard">
    <div class="itemcard-head">
      <span class="itemcard-name">{{ item.name }}</span>
      <span v-if="item.il" class="itemcard-il">iL {{ item.il.toLocaleString() }}</span>
    </div>
    <div v-if="slotLabel" class="itemcard-slot">{{ slotLabel }}</div>

    <div class="itemcard-stats">
      <div v-for="stat in stats" :key="stat.key" class="itemcard-stat">
        <span>{{ stat.label }}</span><span class="num">{{ stat.value }}</span>
      </div>
      <div v-if="!stats.length" class="dim">no direct stats</div>
    </div>

    <div v-if="notes.length" class="itemcard-notes">
      <div v-for="note in notes" :key="note">{{ note }}</div>
    </div>

    <div v-if="rows.length" class="itemcard-bonuses">
      <div class="itemcard-section">Bonuses</div>
      <div v-for="row in rows" :key="row.id" class="itemcard-bonus" :class="'bonus--' + row.state">
        <div class="itemcard-bonus-head">
          <span class="bonus-dot"></span>
          <span class="itemcard-bonus-cond">{{ row.name || row.conditions || 'always' }}</span>
          <span v-if="row.stacks > 1" class="badge">×{{ row.stacks }}</span>
        </div>
        <div v-if="row.name && row.conditions" class="stat-sub itemcard-bonus-when">
          Conditions: {{ row.conditions }}
        </div>
        <div v-if="row.secondary" class="stat-sub itemcard-bonus-shared">
          This bonus was accounted for in {{ row.firstSource }}
        </div>
        <template v-else>
          <div v-if="row.sharedWith" class="stat-sub itemcard-bonus-shared">
            Other parts: {{ row.sharedWith.join(', ') }}
          </div>
          <div v-if="row.stats && row.stats.tiered" class="itemcard-bonus-stats dim">(tiered)</div>
          <div v-else-if="row.stats" class="itemcard-bonus-stats">
            <div v-if="row.stacks > 1" class="stat-sub">total, from {{ row.stacks }} stacking sources</div>
            <div class="itemcard-stats">
              <div v-for="s in row.stats.total" :key="s.key" class="itemcard-stat">
                <span>{{ s.label }}</span><span class="num">{{ s.value }}</span>
              </div>
            </div>
            <template v-if="row.stats.each">
              <div class="stat-sub">each:</div>
              <div class="itemcard-stats">
                <div v-for="s in row.stats.each" :key="s.key" class="itemcard-stat">
                  <span>{{ s.label }}</span><span class="num">{{ s.value }}</span>
                </div>
              </div>
            </template>
          </div>
        </template>
        <div v-if="row.tiers" class="itemcard-bonus-tiers">
          <div class="stat-sub">tiered by set pieces, shared by every piece:</div>
          <div v-for="tier in row.tiers" :key="tier.pieces" class="itemcard-tier"
               :class="{ 'is-active': tier.active }">
            <div>{{ tier.pieces }} piece{{ tier.pieces > 1 ? 's' : '' }}:</div>
            <div class="itemcard-stats">
              <div v-for="s in tier.stats" :key="s.key" class="itemcard-stat">
                <span>{{ s.label }}</span><span class="num">{{ s.value }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-for="(leaf, i) in row.unmet" :key="i" class="itemcard-bonus-unmet">
          needs {{ leaf.label }}<span v-if="leaf.detail"> — {{ leaf.detail }}</span>
        </div>
        <div v-if="row.excludedBy" class="itemcard-bonus-unmet">
          overridden by {{ row.excludedBy }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.itemcard {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .22);
  /* Width and max-height are read back by SlotList.vue for positioning -- keep them in step
   * with the `CARD_W` constant there. `max-width` is a narrow-viewport fallback: `place()`
   * already clamps the card's `left` to stay on screen, but on a viewport under 330px wide
   * (a small phone) the fixed width itself would still overflow. */
  width: 330px;
  max-width: calc(100vw - 20px);
  max-height: 440px;
  overflow-y: auto;
  /* Without this, a wheel scroll that reaches the card's own scroll limit chains onto the
   * page underneath -- scrolling the build page and invalidating the card's anchor rect,
   * which closes the card mid-scroll. */
  overscroll-behavior: contain;
  padding: 9px 11px;
  position: fixed;
  z-index: 40;
  /* Interactive on purpose: long cards overflow and need the scroll wheel, and reaching them
   * with the pointer must not make them vanish. SlotList.vue gives the card its own
   * mouseenter/mouseleave so it stays open while the pointer is over it. */
  pointer-events: auto;
}

.itemcard-head { align-items: baseline; display: flex; gap: 8px; }
.itemcard-name { flex: 1; font-weight: 600; }
.itemcard-il { color: var(--muted); font-size: 1rem; font-variant-numeric: tabular-nums; }
.itemcard-slot { color: var(--muted); font-size: 1rem; margin-bottom: 5px; }

.itemcard-stats { display: flex; flex-direction: column; }
.itemcard-stat {
  border-bottom: 1px solid var(--line);
  display: flex;
  gap: 8px;
  justify-content: space-between;
  font-size: 1rem;
  padding: 3px 0;
}
.itemcard-stat:last-child { border-bottom: none; }
.itemcard-stat .num { font-variant-numeric: tabular-nums; }

.itemcard-notes {
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 1rem;
  margin-top: 6px;
  padding-top: 5px;
}

.itemcard-bonuses { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 5px; }
.itemcard-section {
  color: var(--muted);
  font-size: 1rem;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.itemcard-bonus { margin-top: 4px; }
.itemcard-bonus-head { align-items: center; display: flex; gap: 5px; }
.itemcard-bonus-cond { flex: 1; font-size: 1rem; min-width: 0; }
.bonus--inactive .itemcard-bonus-cond, .bonus--excluded .itemcard-bonus-cond { color: var(--muted); }
.itemcard-bonus-stats { font-size: 1rem; padding-left: 12px; }
/* An inactive/excluded bonus's numbers are what it *would* grant, not what it does -- muted
 * the same as its title, so the card doesn't read as if it were already contributing. */
.bonus--inactive .itemcard-bonus-stats, .bonus--excluded .itemcard-bonus-stats { color: var(--muted); }
.itemcard-bonus-unmet { color: var(--warn); font-size: 1rem; padding-left: 12px; }
.itemcard-bonus-when { padding-left: 12px; }

.itemcard-bonus-tiers { padding-left: 12px; }
.itemcard-tier { color: var(--muted); font-size: 1rem; }
.itemcard-tier.is-active { color: var(--text); font-weight: 600; }
.itemcard-tier .itemcard-stat { font-size: 1rem; padding: 2px 0; }
.itemcard-bonus-shared { padding-left: 12px; }

.stat-sub { color: var(--muted); font-size: 1rem; line-height: 1.3; }

/* Bonus state indicator (dot + title colour) -- same small vocabulary as
 * BonusInspector.vue's own `.bonus-dot`/`.bonus--*`, duplicated rather than shared: the two
 * live in different visual contexts (a hover card vs. a sidebar list) and each fully owns
 * its own look even though the convention happens to match. */
.bonus-dot { border-radius: 50%; flex: none; height: 7px; width: 7px; }
.bonus--active .bonus-dot { background: var(--ok); }
.bonus--inactive .bonus-dot { background: var(--muted); opacity: .5; }
.bonus--excluded .bonus-dot { background: var(--danger); }
</style>
