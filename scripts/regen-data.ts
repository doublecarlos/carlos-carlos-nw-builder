// Rewrites data/db-items.json, data/db-bonuses.json and data/slots.json from the
// statically-imported base catalogue, through the same canonical serializer the in-app
// export drawer uses (catalog.ts's toItemsFile/toBonusesFile/toSlotsFile) -- so the
// committed files stay in the exporter's shape without anyone needing to open the app
// and paste the result back by hand. Run via `npm run fix`, before Prettier reformats
// whitespace.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { NW_ITEMS, NW_BONUSES, NW_SLOTS } from "../src/data/data";
import * as catalog from "../src/data/catalog";

const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
);

writeFileSync(
  path.join(dataDir, "db-items.json"),
  catalog.toItemsFile(NW_ITEMS),
);
writeFileSync(
  path.join(dataDir, "db-bonuses.json"),
  catalog.toBonusesFile(NW_BONUSES),
);
writeFileSync(
  path.join(dataDir, "slots.json"),
  catalog.toSlotsFile(
    NW_SLOTS.sections,
    NW_SLOTS.slots,
    NW_SLOTS.presets ?? [],
  ),
);
