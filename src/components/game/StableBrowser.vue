<script setup lang="ts">
// The stable reference: which bonuses a mount can reach, and which mounts reach a bonus. Both
// directions are the same pairing (`insignia.ts`'s `Reach`) read from opposite ends.
//
// Applying a row overwrites a group, so it names what it will replace first.
import { computed, ref } from "vue";
import BaseModal from "../ui/BaseModal.vue";
import BaseButton from "../ui/BaseButton.vue";
import TabStrip from "../ui/TabStrip.vue";
import TabButton from "../ui/TabButton.vue";
import { descriptionParagraphs } from "../../lib/description";
import { X } from "@lucide/vue";
import IconButton from "../ui/IconButton.vue";
import {
  allBonuses,
  allMounts,
  mountsFor,
  reachableBonuses,
  readGroup,
  slotLine,
} from "../../engine/insignia";
import type { StableFocus } from "../../stores/stableBrowser";
import type { Db, Build, Item } from "../../types";

const props = defineProps<{
  db: Db;
  /** Null on the landing screen, where the reference still reads fine. */
  build?: Build | null;
  /** The group a pick applies to. Null opens the same tables with nothing to set. */
  group: number | null;
  focus?: StableFocus | null;
}>();

const emit = defineEmits<{
  close: [];
  apply: [payload: { group: number; mount: string }];
}>();

const tab = ref<"mount" | "bonus">(props.focus?.tab ?? "mount");
const query = ref(props.focus?.query ?? "");

const matches = (name: string) =>
  name.toLowerCase().includes(query.value.trim().toLowerCase());

const byMount = computed(() =>
  allMounts(props.db)
    .filter((mount) => matches(mount.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((mount) => ({
      head: mount,
      // A mount's card is headed by its slot line, which says more here than prose would.
      description: [] as string[],
      reaches: reachableBonuses(props.db, mount),
    })),
);

const byBonus = computed(() =>
  allBonuses(props.db)
    .filter((bonus) => matches(bonus.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((bonus) => ({
      head: bonus,
      description: descriptionParagraphs(
        bonus.longDescription || bonus.shortDescription,
      ),
      reaches: mountsFor(props.db, bonus),
    })),
);

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
    <div class="flex flex-none flex-wrap items-end gap-3 px-4 pt-3">
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
      <div class="relative ml-auto">
        <input
          v-model="query"
          type="text"
          placeholder="Filter…"
          class="w-52 rounded border border-line bg-surface py-1 pl-2 pr-7"
          data-testid="stable-filter"
        />
        <IconButton
          v-if="query"
          class="absolute right-1 top-1/2 -translate-y-1/2"
          title="Clear filter"
          data-testid="stable-filter-clear"
          @click="query = ''"
        >
          <X />
        </IconButton>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4">
      <div
        v-for="entry in tab === 'mount' ? byMount : byBonus"
        :key="entry.head.id"
        class="mb-3 rounded-md border border-line"
        data-testid="stable-group-card"
      >
        <div
          class="flex items-baseline gap-2 border-b border-line px-2.5 py-1.5"
        >
          <span class="font-semibold">{{ entry.head.name }}</span>
          <span v-if="entry.head.insigniaSlots" class="text-muted">{{
            slotLine(entry.head)
          }}</span>
          <span v-else class="text-muted">{{
            (entry.head.insigniaRecipe ?? []).join(" · ")
          }}</span>
          <span class="ml-auto text-muted">{{ entry.reaches.length }}</span>
          <!-- One mount per card on this side, so the pick belongs to the card, not to each
               bonus under it. -->
          <BaseButton
            v-if="tab === 'mount' && group !== null"
            data-testid="stable-apply"
            :title="`Set Mount ${group} to ${entry.head.name}`"
            @click="apply(entry.head)"
            >Use mount</BaseButton
          >
        </div>
        <div
          v-if="entry.description.length"
          class="border-b border-line px-2.5 py-1.5 text-muted"
          data-testid="stable-head-description"
        >
          <p v-for="line in entry.description" :key="line">{{ line }}</p>
        </div>
        <p v-if="!entry.reaches.length" class="px-2.5 py-1.5 text-muted">
          Nothing reaches this.
        </p>
        <ul v-else>
          <li
            v-for="reach in entry.reaches"
            :key="reach.mount.id + ':' + reach.bonus.id"
            class="flex items-center gap-2 px-2.5 py-1 odd:bg-surface-2/40"
            data-testid="stable-reach-row"
          >
            <span
              ><span>{{
                tab === "mount" ? reach.bonus.name : reach.mount.name
              }}</span
              ><span
                v-if="reach.preferred"
                class="ml-1 whitespace-nowrap text-accent"
                :title="preferredTitle(reach.preferred)"
                >{{ "★".repeat(reach.preferred) }}</span
              ></span
            >
            <BaseButton
              v-if="tab === 'bonus' && group !== null"
              class="ml-auto"
              data-testid="stable-apply"
              :title="`Set Mount ${group} to ${reach.mount.name}`"
              @click="apply(reach.mount)"
              >Use mount</BaseButton
            >
          </li>
        </ul>
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
