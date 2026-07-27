// Loads `window.NW_ITEMS` from `data/db-items.json`.
//
// GENERATED (the json, not this loader) by tools/migrate_bonuses.py from
// data/raw/db-items.json. Safe to hand-edit db-items.json once migration is signed off --
// adding an item is one line. Percentages are decimals (0.09 === 9%). See plan §4.3.

window.NW = window.NW ?? {};

// Resolved against this script's own URL, not the page's -- see data/schema.js for why.
const itemsUrl = new URL('db-items.json', document.currentScript.src);

window.NW.dataReady = Promise.all([
  window.NW.dataReady,
  fetch(itemsUrl)
    .then((response) => response.json())
    .then((data) => { window.NW_ITEMS = data; }),
]);
