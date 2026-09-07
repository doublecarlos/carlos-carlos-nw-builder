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
import {
  allBonuses,
  allMounts,
  mountsFor,
  planFor,
  reachableBonuses,
  readGroup,
  slotLine,
} from "../../engine/insignia";
import type { StableFocus } from "../../stores/stableBrowser";
import type { Db, Build, Item } from "../../types";

const props = defineProps<{
  db: Db;
  build: Build;
  group: number;
  focus?: StableFocus | null;
}>();

const emit = defineEmits<{
  close: [];
  apply: [payload: { group: number; mount: string; insignia: string[] }];
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
      reaches: reachableBonuses(props.db, mount),
    })),
);

const byBonus = computed(() =>
  allBonuses(props.db)
    .filter((bonus) => matches(bonus.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((bonus) => ({ head: bonus, reaches: mountsFor(props.db, bonus) })),
);

const occupied = computed(() => {
  const state = readGroup(props.db, props.build, props.group);
  const held = state.insignia.filter(Boolean).length;
  if (!state.mount && !held) return null;
  return { mount: state.mount, held };
});

const preferredTitle = (count: number) =>
  count === 0
    ? "No preferred slot is satisfied by this combination"
    : `${count} preferred slot${count === 1 ? "" : "s"} satisfied`;

function apply(mount: Item, bonus: Item) {
  const insignia = planFor(props.db, mount, bonus);
  if (!insignia) return;
  emit("apply", { group: props.group, mount: mount.id, insignia });
  emit("close");
}
</script>

<template>
  <BaseModal
    :title="`Browse stable for Mount ${group}`"
    panel-class="max-h-[80vh] w-[720px]"
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
      <input
        v-model="query"
        type="text"
        placeholder="Filter…"
        class="ml-auto w-52 rounded border border-line bg-surface px-2 py-1"
        data-testid="stable-filter"
      />
    </div>

    <p
      v-if="occupied"
      class="flex-none px-4 pt-2 text-muted"
      data-testid="stable-overwrite-warning"
    >
      Mount {{ group }} already holds
      {{ occupied.mount ? occupied.mount.name : "no mount" }}
      <template v-if="occupied.held">and {{ occupied.held }} insignia</template
      >. Applying replaces it.
    </p>

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
              class="w-12 whitespace-nowrap text-accent"
              :title="preferredTitle(reach.preferred)"
              >{{ "★".repeat(reach.preferred) }}</span
            >
            <span>{{
              tab === "mount" ? reach.bonus.name : reach.mount.name
            }}</span>
            <BaseButton
              class="ml-auto"
              data-testid="stable-apply"
              @click="apply(reach.mount, reach.bonus)"
              >Use</BaseButton
            >
          </li>
        </ul>
      </div>
    </div>
  </BaseModal>
</template>
