// Bridges already-converted ES modules onto `window.NW.*` so not-yet-converted classic
// <script> files (still executed as-is by index.html during the phased npm/Vite migration)
// keep working unmodified. Imported first from src/main.ts. Entries are removed as their last
// classic consumer converts; the whole file is deleted once nothing classic remains (see the
// migration plan in llm/plans/).

import * as conditions from './conditions';
import * as db from './db';
import * as bonus from './bonus';
import * as engine from './engine';

declare global {
  interface Window {
    NW: any;
  }
}

window.NW = window.NW ?? {};
window.NW.conditions = conditions;
window.NW.db = db;
window.NW.bonus = bonus;
window.NW.engine = engine;
