// Bridges already-converted ES modules onto `window.NW.*` so not-yet-converted classic
// <script> files (still executed as-is by index.html during the phased npm/Vite migration)
// keep working unmodified. Imported first from src/main.ts. Entries are removed as their last
// classic consumer converts; the whole file is deleted once nothing classic remains (see the
// migration plan in llm/plans/).

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

declare global {
  interface Window {
    NW: any;
    NW_SCHEMA: any;
    NW_SLOTS: any;
    NW_ITEMS: any;
    NW_BONUSES: any;
  }
}

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
