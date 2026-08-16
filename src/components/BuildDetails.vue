<script setup lang="ts">
// The right column: a Stats/Bonuses tab strip over StatPanel/BonusInspector. Only ever mounted
// when engine.resolved.value.ok -- both panels throw otherwise, see their own files.
import TabStrip from "./ui/TabStrip.vue";
import TabButton from "./ui/TabButton.vue";
import StatPanel from "./StatPanel.vue";
import BonusInspector from "./game/BonusInspector.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import * as engine from "../stores/resolved";
import * as details from "../stores/details";

const tab = details.tab;
</script>

<template>
  <aside class="sidebar">
    <TabStrip>
      <TabButton :active="tab === 'stats'" @click="details.setTab('stats')"
        >Stats</TabButton
      >
      <TabButton :active="tab === 'bonuses'" @click="details.setTab('bonuses')">
        Bonuses
        <span class="opacity-75 tabular-nums"
          >{{ engine.bonusCounts.value.active }}/{{
            engine.bonusCounts.value.total
          }}</span
        >
        <BaseBadge v-if="engine.bonusCounts.value.nearMiss" variant="near">
          {{ engine.bonusCounts.value.nearMiss }} away
        </BaseBadge>
      </TabButton>
    </TabStrip>

    <!-- v-show, not v-if: switching tabs must not discard the inspector's filter. -->
    <StatPanel v-show="tab === 'stats'" />
    <BonusInspector v-show="tab === 'bonuses'" />
  </aside>
</template>
