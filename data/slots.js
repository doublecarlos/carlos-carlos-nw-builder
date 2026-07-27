// Loads `window.NW_SLOTS` from `data/slots.json`.
//
// GENERATED (the json, not this loader) by tools/gen_slots.py from data/raw/slots.json -- do
// not edit slots.json by hand unless you intend the app layout to diverge from the source
// spreadsheet.
//
// Slot ids are `<section>.<slot>` and are stable: the section prefix is unconditional, so
// adding a slot can never change an existing id and break saved builds.
//
// The sheet's whole Options section is deliberately absent: Class, Role, the three Forte
// picks, Damage Type, Magnitude, Combat Type, Duration, Location, the five effect toggles and
// M32 Forte are build *context* now, not item slots. In the sheet they were pseudo-items with
// no stats, existing only so the string-matching bonus engine could count them. See
// data/schema.json's `context` (loaded by data/schema.js) and plan §2.1.

window.NW = window.NW ?? {};

// Resolved against this script's own URL, not the page's -- see data/schema.js for why.
const slotsUrl = new URL('slots.json', document.currentScript.src);

window.NW.dataReady = Promise.all([
  window.NW.dataReady,
  fetch(slotsUrl)
    .then((response) => response.json())
    .then((data) => { window.NW_SLOTS = data; }),
]);
