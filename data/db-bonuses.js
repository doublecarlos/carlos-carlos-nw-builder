// Loads `window.NW_BONUSES` from `data/db-bonuses.json`.
//
// GENERATED (the json, not this loader) by tools/migrate_bonuses.py -- every bonus, one per
// set. A set with one member is private to that item; membership lives on the items
// (`sets: [...]`), never here. See plan §2.3.

window.NW = window.NW ?? {};

// Resolved against this script's own URL, not the page's -- see data/schema.js for why.
const bonusesUrl = new URL('db-bonuses.json', document.currentScript.src);

window.NW.dataReady = Promise.all([
  window.NW.dataReady,
  fetch(bonusesUrl)
    .then((response) => response.json())
    .then((data) => { window.NW_BONUSES = data; }),
]);
