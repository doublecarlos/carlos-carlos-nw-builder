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
import { itemCardRows } from "../../lib/item-card-rows";
import {
  PREFERRED_MARK,
  itemDisplay,
  mountsFor,
  reachableBonuses,
  slotSummary,
} from "../../engine/insignia";
import { scaledStat } from "../../engine/scaling";
import type { OccurrenceRow } from "../../composables/useItemBonusOccurrences";
import type { DynamicStatConfig } from "../../types";
import type { Item, Db, EvaluatedBonus } from "../../types";
import { SquarePen, Table, TriangleAlert } from "@lucide/vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseCardHeader from "../ui/BaseCardHeader.vue";
import BaseCardBody from "../ui/BaseCardBody.vue";
import IconButton from "../ui/IconButton.vue";
import BaseButton from "../ui/BaseButton.vue";

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
    /** Set when the card is shown over a stable row. Without one the browser has nothing to
     *  apply to, so "and N more" stays plain text. */
    stableGroup?: number | null;
  }>(),
  {
    bonuses: () => [],
    slotLabel: "",
    db: null,
    occurrenceRows: () => [],
    scale: 1,
    scaleNotes: () => [],
    editLabel: "",
    stableGroup: null,
  },
);

const emit = defineEmits<{ edit: []; "open-stable": [] }>();

/** What this item would be swapped for, when the card has a catalogue to ask. */
const replacement = computed(
  () => props.db?.replacementFor(props.item.id) ?? null,
);

/** The header badge, scaled like the stat lines below it -- an unscaled figure next to scaled
 *  rows reads as a contradiction rather than as two different numbers. */
const scaledIl = computed(() =>
  int(scaledStat(NW_SCHEMA, props.item, "il", props.scale)),
);

/** Falls back to the short description, so an item carrying only that still says something on
 * its card rather than nothing. */
const longDescription = computed(() =>
  descriptionParagraphs(
    props.item.longDescription || props.item.shortDescription,
  ),
);

const STABLE_ROWS = 8;

/** Null without a catalogue, as on the layer editor's preview card. */
const stableReach = computed(() => {
  const db = props.db;
  if (!db) return null;
  const isMount = !!props.item.insigniaSlots;
  if (!isMount && !props.item.insigniaRecipe) return null;
  const rows = isMount
    ? reachableBonuses(db, props.item)
    : mountsFor(db, props.item);
  return {
    title: isMount ? "Insignia bonuses" : "Mounts",
    rows: rows.slice(0, STABLE_ROWS).map((reach) => ({
      id: isMount ? reach.bonus.id : reach.mount.id,
      name: isMount ? reach.bonus.name : reach.mount.name,
      preferred: reach.preferred,
    })),
    more: Math.max(0, rows.length - STABLE_ROWS),
    preferred: rows.filter((reach) => reach.preferred > 0).length,
    total: rows.length,
  };
});

const slots = computed(() => slotSummary(props.item));

const shown = computed(() => itemDisplay(props.db, props.item));

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

const rows = computed(() =>
  itemCardRows(props.item, props.bonuses, props.occurrenceRows),
);
</script>

<template>
  <!-- Content inside the tooltip -- positioning, z-index, scroll, and max dimensions
       are handled by BasePopover. Internal structure uses BaseCard for the visual frame. -->
  <BaseCard class="itemcard" data-testid="item-card">
    <BaseCardHeader sticky>
      <!-- Inline, so a name that wraps carries the star along on its last line. -->
      <span class="flex-1 font-semibold"
        ><span data-testid="item-card-name">{{ shown.name }}</span
        ><span
          v-if="shown.preferred"
          class="ml-1 text-accent"
          title="the upgraded half, which only a slot preferring its shape takes"
          >{{ PREFERRED_MARK }}</span
        ></span
      >
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
      <div v-if="slots" class="mt-2 text-muted" data-testid="item-card-slots">
        {{ slots }}
      </div>
      <div
        v-if="stableReach"
        class="mt-2 border-t border-line pt-1.5"
        data-testid="item-card-stable"
      >
        <div class="mb-0.5 font-semibold">
          {{ stableReach.title }}
          <span class="font-normal text-muted"
            >({{ stableReach.total }} total,
            {{ stableReach.preferred }} preferred)</span
          >
        </div>
        <p v-if="!stableReach.rows.length" class="text-muted">
          Nothing reaches this.
        </p>
        <div
          v-for="row in stableReach.rows"
          :key="row.id"
          class="py-0.5 hover:shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"
          data-testid="item-card-stable-row"
        >
          <span>{{ row.name }}</span
          ><span
            v-if="row.preferred"
            class="ml-1 whitespace-nowrap text-accent"
            >{{ PREFERRED_MARK.repeat(row.preferred) }}</span
          >
        </div>
        <BaseButton
          v-if="stableReach.more && stableGroup"
          variant="ghost"
          class="mt-0.5"
          data-testid="item-card-stable-more"
          @click="emit('open-stable')"
          >and {{ stableReach.more }} more<Table
        /></BaseButton>
        <div v-else-if="stableReach.more" class="text-muted">
          and {{ stableReach.more }} more
        </div>
      </div>
    </BaseCardBody>
  </BaseCard>
</template>
