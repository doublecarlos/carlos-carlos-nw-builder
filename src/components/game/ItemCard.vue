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
import { itemCardRows, scaleNote } from "../../lib/item-card-rows";
import type { ItemCardRow, StatLine } from "../../lib/item-card-rows";
import { occurrenceStateText } from "../../lib/bonus-inspector";
import { supplyNeedFor } from "../../lib/bonus-slots";
import {
  PREFERRED_MARK,
  itemDisplay,
  mountsFor,
  reachableBonuses,
  slotSummary,
} from "../../engine/insignia";
import { composeFactor, scaledStat } from "../../engine/scaling";
import type { OccurrenceRow } from "../../composables/useItemBonusOccurrences";
import type {
  DynamicStatConfig,
  Item,
  Db,
  EvaluatedBonus,
  ResolvedScaler,
  SupplyNeed,
} from "../../types";
import { Crosshair, SquarePen, Table, TriangleAlert } from "@lucide/vue";
import BaseBadge from "../ui/BaseBadge.vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseCardHeader from "../ui/BaseCardHeader.vue";
import BaseCardBody from "../ui/BaseCardBody.vue";
import IconButton from "../ui/IconButton.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseLink from "../ui/BaseLink.vue";
import DescriptionText from "../ui/DescriptionText.vue";
import LinkList from "../ui/LinkList.vue";
import type { LinkListItem } from "../ui/LinkList.vue";
import StatRows from "./StatRows.vue";

const props = withDefaults(
  defineProps<{
    item: Item;
    /** Resolved bonus entries this item takes part in, from `result.bonuses`. */
    bonuses?: EvaluatedBonus[];
    slotLabel?: string;
    /** The catalog, for what the card cannot read off the item alone: its replacement, its
     *  effective copy cap, its stable reach, and which unmet conditions a slot could supply. */
    db?: Db | null;
    /** `item`'s own BonusOccurrenceConfig rows (useItemBonusOccurrences.ts) -- same data
     *  ItemPickerRow.vue's checkbox/stepper inputs read, resolved by the caller rather than
     *  here so this component stays prop-driven. Lets an inactive row that's `item`'s own
     *  count-of-0 explain that directly instead of only through a generic unmet-gate
     *  leaf, which reads oddly for a bonus gated on its own occurrence count. */
    occurrenceRows?: OccurrenceRow[];
    /** Mount/companion bolster acting on this item (`itemScalers`), resolved by the caller
     *  rather than read from the store here so this component stays prop-driven. Scales the
     *  item's own stat line only, since the bonus payloads below are attributed to a slot, not
     *  owned by the item. Each scaled row notes the real value and the scaler, the same way a
     *  scaled grant's rows do. */
    scalers?: ResolvedScaler[];
    /** Tooltip for the header's edit button, naming the layer the edit lands in -- which is
     *  not necessarily the one on screen. Empty hides the button. */
    editLabel?: string;
    /** Set when the card is shown over a stable row. Without one the browser has nothing to
     *  apply to, so "and N more" stays plain text. */
    stableGroup?: number | null;
    /** Every resolved bonus in the build by id, so an "overridden by" line can name the
     *  excluder and link to its slot; that bonus usually sits on another item. */
    bonusById?: Map<string, EvaluatedBonus>;
  }>(),
  {
    bonuses: () => [],
    slotLabel: "",
    db: null,
    occurrenceRows: () => [],
    scalers: () => [],
    editLabel: "",
    stableGroup: null,
    bonusById: () => new Map(),
  },
);

const emit = defineEmits<{
  edit: [];
  "open-stable": [];
  "go-to-slot": [slotId: string];
  /** Asks the caller to narrow its slot list to what could supply an unmet condition. */
  locate: [need: SupplyNeed, label: string];
}>();

/** What this item would be swapped for, when the card has a catalog to ask. */
const replacement = computed(
  () => props.db?.replacementFor(props.item.id) ?? null,
);

const scale = computed(() => composeFactor(props.scalers));

/** The header badge, scaled like the stat lines below it -- an unscaled figure next to scaled
 *  rows reads as a contradiction rather than as two different numbers. */
const scaledIl = computed(() => int(scaledStat(props.item, "il", scale.value)));

/** Falls back to the short description, so an item carrying only that still says something on
 * its card rather than nothing. */
const longDescription = computed(() =>
  descriptionParagraphs(
    props.item.longDescription || props.item.shortDescription,
  ),
);

const STABLE_ROWS = 8;

/** Null without a catalog, as on the layer editor's preview card. */
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

/** The item's own stat line at the build's bolster. A scaled row's note shows the catalog
 *  value (the unfloored item level included) and every scaler behind the number. */
const stats = computed(() => {
  const out: StatLine[] = [];
  const slots = props.db?.slots ?? [];
  for (const key of NW_SCHEMA.statKeys) {
    const value = props.item[key] as number | undefined;
    if (!value) continue;
    out.push({
      key,
      label: statLabel(key),
      value: signedStat(key, scaledStat(props.item, key, scale.value)),
      ...(props.scalers.length && {
        note: scaleNote(value, key, props.scalers, slots),
      }),
    });
  }
  return out;
});

/** One line per `DynamicStatConfig`; shared between an item's own `dynamicStats` (below)
 *  and a grant's (`grantRows`'s preview). */
function dynamicStatNote(config: DynamicStatConfig): string {
  const lbl = config.label ?? statLabel(config.stat);
  return `${lbl} ${formatStat(config.stat, config.min)} to ${formatStat(config.stat, config.max)}`;
}

/** Non-stat lines shown above a flat grant's rows. */
function grantNotes(
  row: { stacks: number },
  grant: Pick<ItemCardRow["grants"][number], "active" | "eachStack">,
): string[] {
  const notes: string[] = [];
  if (row.stacks > 1 && grant.active) {
    notes.push(`total, from ${row.stacks} stacking sources`);
  }
  if (grant.eachStack) notes.push("each stack would give:");
  return notes;
}

/** Notes that are not stats but change whether the item is legal or what it grants. */
const notes = computed(() => {
  const out: string[] = [];
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
  itemCardRows(
    props.item,
    props.bonuses,
    props.occurrenceRows,
    props.bonusById,
    props.db?.slots ?? [],
  ).map((row) => ({
    ...row,
    sharedWith: row.sharedWith
      ? row.sharedWith.map<LinkListItem>((part) => ({
          key: part.slotId,
          label: part.name,
        }))
      : null,
    // No catalog (the layer editor's preview card) means no "where would I get this" action.
    grants: row.grants.map((grant) => ({
      ...grant,
      unmet: grant.unmet.map((leaf) => ({
        leaf,
        need: props.db ? supplyNeedFor(props.db, leaf) : null,
      })),
    })),
  })),
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
          title="Preferred"
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
          <template v-if="item.hideFromPicker">Retired.</template>
          <template v-if="replacement">
            <br v-if="item.hideFromPicker" />
            Replaced by {{ replacement.name }}.
          </template>
        </span>
      </div>
      <DescriptionText
        v-if="longDescription.length"
        class="mb-1.5"
        data-testid="item-card-long-description"
        :paragraphs="longDescription"
      />
      <StatRows
        :rows="stats"
        empty-text="no direct stats"
        @go-to-slot="emit('go-to-slot', $event)"
      ></StatRows>

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
              row.name || "always"
            }}</span>
            <BaseBadge v-if="row.stacks > 1">×{{ row.stacks }}</BaseBadge>
          </div>
          <div
            v-if="row.zeroOccurrence"
            class="pl-3 leading-snug text-muted"
            data-testid="item-card-bonus-zero-occurrence"
          >
            {{ row.zeroOccurrence.label }}:
            {{ occurrenceStateText(row.zeroOccurrence) }} on this item
          </div>
          <div
            v-if="row.secondary && row.firstSource"
            class="pl-3 leading-snug text-muted"
          >
            This bonus was accounted for in
            <BaseLink
              data-testid="item-card-first-source"
              @click="emit('go-to-slot', row.firstSource.slotId)"
              >{{ row.firstSource.name }}</BaseLink
            >
          </div>
          <template v-else>
            <div v-if="row.sharedWith" class="pl-3 leading-snug text-muted">
              Other parts:
              <LinkList
                :items="row.sharedWith"
                link-testid="item-card-shared-source"
                @select="emit('go-to-slot', $event)"
              />
            </div>

            <!-- One block per grant -- own label, own active state, own ladder/unmet. The
                 label/border chrome only appears once there's more than one grant to tell
                 apart; a single grant already reads fine under the bonus's own name/dot and
                 "Conditions: ..." line above, so repeating that here would just be noise. -->
            <div class="pl-3">
              <div
                v-for="g in row.grants"
                :key="g.key"
                data-testid="item-card-grant"
                :class="
                  row.grants.length > 1 &&
                  'mt-1.5 border-l-2 border-t-2 border-b-2 border-line pl-2 pt-1.5'
                "
              >
                <div
                  v-if="g.unmet.length <= 0"
                  class="flex items-center gap-1.5"
                  :class="!g.active && 'text-muted'"
                >
                  <span
                    v-if="row.grants.length > 1"
                    class="size-1.5 flex-none rounded-full"
                    :class="g.active ? 'bg-ok' : 'bg-muted opacity-50'"
                  ></span>
                  <span class="min-w-0 flex items-center flex-1">{{
                    g.label
                  }}</span>
                </div>
                <div
                  v-for="({ leaf, need }, i) in g.unmet"
                  :key="i"
                  class="text-warn flex items-center gap-2"
                  data-testid="item-card-bonus-unmet"
                >
                  <span class="flex-1">
                    needs {{ leaf.label
                    }}<span v-if="leaf.detail"> - {{ leaf.detail }}</span>
                  </span>
                  <IconButton
                    v-if="need"
                    class="ml-1 align-middle text-warn"
                    title="Show the slots that could supply this"
                    data-testid="item-card-need-locate"
                    @click="emit('locate', need, leaf.label)"
                  >
                    <Crosshair />
                  </IconButton>
                </div>
                <div v-if="g.problem" class="text-warn">
                  {{ g.problem.message }}
                </div>
                <!-- A ladder's rungs are already at the grant's scale, each noting the
                     catalog's real value, so a scaled line reads the same here as on a flat
                     grant or on the item's own rows above. -->
                <template v-else-if="g.tiers">
                  <div v-for="tier in g.tiers" :key="tier.atLeast">
                    <div
                      :class="
                        tier.active ? 'font-semibold text-text' : 'text-muted'
                      "
                    >
                      {{ tier.atLeast }} equipped:
                    </div>
                    <StatRows
                      :rows="tier.stats"
                      :active="tier.active"
                      @go-to-slot="emit('go-to-slot', $event)"
                    ></StatRows>
                  </div>
                </template>
                <template v-else-if="g.variants">
                  <div class="divide-y divide-line divide-y-2">
                    <div v-for="v in g.variants" :key="v.key" class="py-1">
                      <div
                        :class="
                          v.active ? 'font-semibold text-text' : 'text-muted'
                        "
                      >
                        {{ v.label }}:
                      </div>
                      <StatRows
                        :rows="v.stats"
                        :active="v.active"
                        @go-to-slot="emit('go-to-slot', $event)"
                      ></StatRows>
                    </div>
                  </div>
                </template>
                <StatRows
                  v-else-if="g.stats"
                  :rows="g.stats"
                  :active="g.active"
                  :notes="grantNotes(row, g)"
                  @go-to-slot="emit('go-to-slot', $event)"
                ></StatRows>
                <div
                  v-if="g.scale?.unset"
                  class="text-muted"
                  data-testid="grant-scale-unset"
                >
                  <BaseLink
                    :plain="!g.scale.slotId"
                    @click="
                      g.scale.slotId && emit('go-to-slot', g.scale.slotId)
                    "
                    >{{ g.scale.label }}</BaseLink
                  >
                  share is unset
                </div>
                <DescriptionText
                  v-if="g.descriptions.length"
                  class="mt-1"
                  :paragraphs="g.descriptions"
                  data-testid="item-card-grant-description"
                />
              </div>
            </div>
          </template>
          <div
            v-if="row.excludedBy"
            class="pl-3 text-warn"
            data-testid="item-card-excluded-by"
          >
            Overridden by
            <BaseLink
              :plain="!row.excludedBy.slotId"
              @click="emit('go-to-slot', row.excludedBy.slotId)"
              >{{ row.excludedBy.name }}</BaseLink
            >
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
        <p v-if="!stableReach.rows.length" class="text-muted">None.</p>
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
