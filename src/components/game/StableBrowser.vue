<script setup lang="ts">
// The stable reference: which bonuses a mount can reach, and which mounts reach a bonus. Both
// directions are the same pairing (`insignia.ts`'s `Reach`) read from opposite ends, derived
// into cards by lib/stable-rows.ts.
//
// Applying a row overwrites a group, so it names what it will replace first.
//
// Tab and filter live in the store so the URL can mirror them; collapse state stays local.
import { computed, ref, watch } from "vue";
import BaseModal from "../ui/BaseModal.vue";
import BaseButton from "../ui/BaseButton.vue";
import TabStrip from "../ui/TabStrip.vue";
import TabButton from "../ui/TabButton.vue";
import ClearableInput from "../ui/ClearableInput.vue";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
} from "@lucide/vue";
import { PREFERRED_MARK, readGroup } from "../../engine/insignia";
import { stableCards, type StableCard } from "../../lib/stable-rows";
import * as stableBrowser from "../../stores/stableBrowser";
import type { Db, Build, Item } from "../../types";

const props = defineProps<{
  db: Db;
  /** Null on the landing screen, where the reference still reads fine. */
  build?: Build | null;
  /** The group a pick applies to. Null opens the same tables with nothing to set. */
  group: number | null;
}>();

const emit = defineEmits<{
  close: [];
  apply: [payload: { group: number; mount: string }];
}>();

const tab = stableBrowser.tab;
const query = stableBrowser.query;

const cards = computed(() => stableCards(props.db, tab.value, query.value));

// --- collapsing ---------------------------------------------------------------------------
// Ids explicitly collapsed, not ids expanded, so "expand all" is a reset. A row-matched card
// stays open regardless: collapsing it would hide what put it on screen.
const collapsed = ref(new Set<string>());

const isCollapsed = (card: StableCard) =>
  collapsed.value.has(card.id) && !card.matchedByRow;

function toggleCard(id: string) {
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

const collapseAll = () => {
  collapsed.value = new Set(cards.value.map((card) => card.id));
};
const expandAll = () => {
  collapsed.value = new Set();
};

/** The other side lists different ids, so an old collapse would land on whatever shares one. */
watch(tab, expandAll);

const openCount = computed(
  () => cards.value.filter((card) => !isCollapsed(card)).length,
);

// --- applying -----------------------------------------------------------------------------

const occupied = computed(() => {
  if (props.group === null || !props.build) return null;
  const state = readGroup(props.db, props.build, props.group);
  const held = state.insignia.filter(Boolean).length;
  if (!state.mount && !held) return null;
  return { mount: state.mount, held };
});

const preferredTitle = (count: number) =>
  `${count} preferred slot${count === 1 ? "" : "s"} satisfied`;

/** The mount only: which insignia go in its slots is the picker's job, and a group filled from
 * here would be four picks the player never made. */
function apply(mount: Item) {
  if (props.group === null) return;
  emit("apply", { group: props.group, mount: mount.id });
  emit("close");
}
</script>

<template>
  <BaseModal
    :title="
      group === null ? 'Stable reference' : `Browse stable for Mount ${group}`
    "
    panel-class="h-[80vh] w-[720px]"
    data-testid="stable-browser"
    @close="emit('close')"
  >
    <div class="flex flex-none flex-wrap items-center gap-2 px-4 pt-3">
      <TabStrip>
        <TabButton
          :active="tab === 'mount'"
          data-testid="stable-tab-mount"
          @click="tab = 'mount'"
          >By mount</TabButton
        >
        <TabButton
          :active="tab === 'bonus'"
          data-testid="stable-tab-bonus"
          @click="tab = 'bonus'"
          >By bonus</TabButton
        >
      </TabStrip>
      <!-- Same pair, order and icons as the build editor's own section controls. -->
      <BaseButton
        class="ml-auto"
        :disabled="openCount === cards.length"
        data-testid="stable-expand-all"
        @click="expandAll"
        ><ChevronsUpDown />expand all</BaseButton
      >
      <BaseButton
        :disabled="!openCount"
        data-testid="stable-collapse-all"
        @click="collapseAll"
        ><ChevronsDownUp />collapse all</BaseButton
      >
      <ClearableInput
        v-model="query"
        class="w-56"
        placeholder="Filter mounts and bonuses…"
        testid="stable-filter"
      />
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      <p
        v-if="!cards.length"
        class="text-muted"
        data-testid="stable-no-matches"
      >
        No mount or bonus matches that filter.
      </p>
      <div
        v-for="card in cards"
        :key="card.id"
        class="mb-3 rounded-md border border-line"
        data-testid="stable-group-card"
      >
        <div class="flex items-center gap-2 border-b border-line pr-2.5">
          <!-- "Use mount" stays outside the toggle: a button cannot nest in another. -->
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1.5 pl-2.5 text-left hover:bg-surface-2"
            :aria-expanded="!isCollapsed(card)"
            :title="isCollapsed(card) ? 'Expand' : 'Collapse'"
            :data-testid="'stable-card-toggle:' + card.id"
            @click="toggleCard(card.id)"
          >
            <ChevronRight
              v-if="isCollapsed(card)"
              class="size-4 flex-none text-muted"
            />
            <ChevronDown v-else class="size-4 flex-none text-muted" />
            <span class="shrink-0 font-semibold">{{ card.name }}</span>
            <span class="min-w-0 truncate text-muted">{{ card.meta }}</span>
            <!-- A narrowed card says what it is a subset of. -->
            <span class="ml-auto shrink-0 pl-2 text-muted">{{
              card.matchedByRow
                ? `${card.rows.length} of ${card.total}`
                : card.total
            }}</span>
          </button>
          <!-- One mount per card on this side, so the pick belongs to the card, not to each
               bonus under it. -->
          <BaseButton
            v-if="tab === 'mount' && group !== null"
            class="flex-none"
            data-testid="stable-apply"
            :title="`Set Mount ${group} to ${card.name}`"
            @click="apply(card.head)"
            >Use mount</BaseButton
          >
        </div>
        <template v-if="!isCollapsed(card)">
          <div
            v-if="card.description.length"
            class="border-b border-line px-2.5 py-1.5 text-muted"
            data-testid="stable-head-description"
          >
            <p v-for="line in card.description" :key="line">{{ line }}</p>
          </div>
          <p v-if="!card.rows.length" class="px-2.5 py-1.5 text-muted">
            Nothing reaches this.
          </p>
          <ul v-else>
            <li
              v-for="row in card.rows"
              :key="row.id"
              class="flex items-center gap-2 border-l-2 px-2.5 py-1"
              :class="
                row.matched && !card.matchedByRow
                  ? 'border-accent bg-accent-soft font-semibold'
                  : 'border-transparent odd:bg-surface-2/40'
              "
              data-testid="stable-reach-row"
            >
              <span class="shrink-0"
                ><span>{{ row.name }}</span
                ><span
                  v-if="row.preferred"
                  class="ml-1 whitespace-nowrap text-accent"
                  :title="preferredTitle(row.preferred)"
                  >{{ PREFERRED_MARK.repeat(row.preferred) }}</span
                ></span
              >
              <span class="min-w-0 truncate text-muted">{{ row.meta }}</span>
              <BaseButton
                v-if="tab === 'bonus' && group !== null"
                class="ml-auto"
                data-testid="stable-apply"
                :title="`Set Mount ${group} to ${row.name}`"
                @click="apply(row.item)"
                >Use mount</BaseButton
              >
            </li>
          </ul>
        </template>
      </div>
    </div>

    <p
      v-if="occupied"
      class="flex-none border-t border-line px-4 py-2 text-muted"
      data-testid="stable-overwrite-warning"
    >
      Mount {{ group }} already holds
      {{ occupied.mount ? occupied.mount.name : "no mount" }}
      <template v-if="occupied.held">and {{ occupied.held }} insignia</template
      >. <br />
      Using another replaces the mount and drops any incompatible insignia.
    </p>
  </BaseModal>
</template>
