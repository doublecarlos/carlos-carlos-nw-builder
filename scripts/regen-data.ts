// Rewrites data/db-items.json, data/db-bonuses.json and data/slots.json from the
// statically-imported base catalogue, through the same canonical serializer *and* the same
// `compose()` sort the in-app export drawer uses (catalog.ts's compose, catalogExport.ts's
// toItemsFile/toBonusesFile/toSlotsFile) -- so the committed files stay in the exporter's
// shape without anyone needing to open the app and paste the result back by hand. Run via
// `npm run fix`, before Prettier reformats whitespace.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NW_SLOTS } from "../src/data/data";
import * as catalog from "../src/data/catalog";
import * as catalogExport from "../src/data/catalogExport";

const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
);

// No overlays -- this regenerates the *base* catalogue, sorted the same way `compose()`
// sorts it for the export drawer (by id) so both paths agree on file order.
const { items, bonuses, sectionPresets } = catalog.compose([]);

writeFileSync(
  path.join(dataDir, "db-items.json"),
  catalogExport.toItemsFile(items),
);
writeFileSync(
  path.join(dataDir, "db-bonuses.json"),
  catalogExport.toBonusesFile(bonuses),
);
writeFileSync(
  path.join(dataDir, "slots.json"),
  catalogExport.toSlotsFile(NW_SLOTS.sections, NW_SLOTS.slots, sectionPresets),
);
