// Rewrites the shipped data/*.json files from the base catalog, using the same `compose()` and
// serializers as the in-app export, so the committed files stay in the exporter's shape.
// Run via `npm run fix`, before Prettier reformats whitespace.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as catalog from "../src/data/catalog";
import * as catalogExport from "../src/data/catalogExport";

const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
);

// No overlays: this regenerates the base catalog, in the same order the export drawer uses.
const { items, bonuses, sectionPresets, slots, sections, filters } =
  catalog.compose([]);

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
  catalogExport.toSlotsFile(sections, slots, sectionPresets),
);
writeFileSync(
  path.join(dataDir, "filters.json"),
  catalogExport.toFiltersFile(filters),
);
