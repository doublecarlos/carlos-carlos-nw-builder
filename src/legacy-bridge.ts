// Bridges already-converted ES modules onto `window.NW.*` so not-yet-converted classic
// <script> files (still executed as-is by index.html during the phased npm/Vite migration)
// keep working unmodified. Imported first from src/main.ts. Entries are removed as their last
// classic consumer converts; the whole file is deleted once nothing classic remains (see the
// migration plan in llm/plans/).

import * as Vue from 'vue';
import * as conditions from './conditions';
import * as db from './db';
import * as bonus from './bonus';
import * as engine from './engine';
import * as format from './format';
import * as catalog from './catalog';
import * as router from './router';
import * as storage from './storage';
import * as fsStore from './fs-store';
import { NW_SCHEMA, NW_SLOTS, NW_ITEMS, NW_BONUSES } from './data';
import * as statRowNav from './stat-row-nav';
import ComboBox from './components/ComboBox.vue';
import IconButton from './components/IconButton.vue';
import TokenInput from './components/TokenInput.vue';
import PercentInput from './components/PercentInput.vue';
import QuickOptions from './components/QuickOptions.vue';
import Options from './components/Options.vue';
import ConditionRows from './components/ConditionRows.vue';
import * as conditionDraft from './condition-draft';
import BonusRows from './components/BonusRows.vue';
import * as bonusDraft from './bonus-draft';
import BonusGroups from './components/BonusGroups.vue';
import ItemCard from './components/ItemCard.vue';
import ItemPicker from './components/ItemPicker.vue';
import BonusInspector from './components/BonusInspector.vue';
import BuildBar from './components/BuildBar.vue';
import BuildNav from './components/BuildNav.vue';
import ItemForm from './components/ItemForm.vue';
import BonusSetForm from './components/BonusSetForm.vue';
import SlotList from './components/SlotList.vue';

declare global {
  interface Window {
    NW: any;
    NW_SCHEMA: any;
    NW_SLOTS: any;
    NW_ITEMS: any;
    NW_BONUSES: any;
    Vue: any;
  }
}

// `window.Vue` used to come from the classic vendor/vue.global.prod.js script, a *separate*
// copy of Vue from the one Vite resolves for every SFC's own `import { ref, computed } from
// 'vue'`. Two copies of Vue in the same render tree corrupts internal component-instance state
// the moment a component crosses the boundary (symptom: "Cannot read properties of null
// (reading 'refs')" deep in Vue's internals, only on components that use a template `ref` --
// found by mounting each converted component standalone and bisecting). Re-exposing the *same*
// module Vite gives everyone else as `window.Vue` fixes it for app.js and every not-yet-
// converted classic component (`const { createApp, markRaw } = window.Vue`) without touching
// their code. vendor/vue.global.prod.js's <script> tag is removed from index.html accordingly;
// the file itself is deleted in the final cutover phase along with the tag's neighbors.
window.Vue = Vue;

window.NW = window.NW ?? {};
window.NW.conditions = conditions;
window.NW.db = db;
window.NW.bonus = bonus;
window.NW.engine = engine;
window.NW.format = format;
window.NW.catalog = catalog;
window.NW.router = router;
window.NW.storage = storage;
window.NW.fsStore = fsStore;

// Data is now loaded via static imports (src/data.ts), not the classic fetch loaders
// (data/*.js, deleted this phase) -- so it's synchronously available. Not-yet-converted
// classic files (app.js, most of src/components/) still read these as globals and still
// `await window.NW.dataReady` before doing anything with them, so both stay bridged as an
// already-resolved promise/plain values until those files convert (Phase 5/6) and start
// importing from './data' directly instead.
window.NW_SCHEMA = NW_SCHEMA;
window.NW_SLOTS = NW_SLOTS;
window.NW_ITEMS = NW_ITEMS;
window.NW_BONUSES = NW_BONUSES;
window.NW.dataReady = Promise.resolve();

// Already-converted components, bridged the same way for not-yet-converted classic parents
// that still do `components: { X: window.NW.components.X }`. A .vue SFC's default export is
// already a plain component-options object (true for <script setup> too, post-compile), so
// this needs no adapter -- just the same assignment pattern as every other bridged module.
window.NW.statRowNav = statRowNav;
window.NW.components = window.NW.components ?? {};
window.NW.components.ComboBox = ComboBox;
window.NW.components.IconButton = IconButton;
window.NW.components.TokenInput = TokenInput;
window.NW.components.PercentInput = PercentInput;
window.NW.components.QuickOptions = QuickOptions;
window.NW.components.Options = Options;
window.NW.components.ConditionRows = ConditionRows;
window.NW.conditionDraft = conditionDraft;
window.NW.components.BonusRows = BonusRows;
window.NW.bonusDraft = bonusDraft;
window.NW.components.BonusGroups = BonusGroups;
window.NW.components.ItemCard = ItemCard;
window.NW.components.ItemPicker = ItemPicker;
window.NW.components.BonusInspector = BonusInspector;
window.NW.components.BuildBar = BuildBar;
window.NW.components.BuildNav = BuildNav;
window.NW.components.ItemForm = ItemForm;
window.NW.components.BonusSetForm = BonusSetForm;
window.NW.components.SlotList = SlotList;
