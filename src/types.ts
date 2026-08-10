// The domain model shared across data.ts / db.ts / catalog.ts / bonus.ts / conditions.ts /
// engine.ts / storage.ts / condition-draft.ts / bonus-draft.ts. Pulled into one place instead
// of re-declared per file because the same shapes (Item, BonusSet, Grant, Build, Schema) cross
// every one of those module boundaries -- duplicating them per file would just be `any` with
// extra steps the next time one drifted from the others.
//
// `StatKey` was hoped to be inferable as a string-literal union straight off `data/schema.json`
// (`resolveJsonModule`), so a typo'd stat name would be a compile error. Verified that doesn't
// happen -- TS widens a JSON-imported string property to plain `string` on import, unlike an
// `as const` literal, so `StatKey` is just `string` with a documentation-only name.

import type rawSchema from "../data/schema.json";

export type StatDef = (typeof rawSchema)["stats"][number];
export type StatKey = string;
export type StatValues = Partial<Record<StatKey, number>>;

export interface RatingConversionRule {
  percent: StatKey;
  rating: StatKey;
  capPct: number;
  allowedOver: number;
  pctCap: number;
}

export interface AbilityContribution {
  ability: string;
  stat: StatKey;
  divisor: number;
}

export interface RoleDef {
  label: string;
  hpBonus: number;
  damageBonus: number;
}

export interface Schema {
  stats: StatDef[];
  statByKey: Record<StatKey, StatDef>;
  statKeys: StatKey[];
  multiplicativeStats: StatKey[];
  ratingStats: StatKey[];
  abilityStats: StatKey[];
  ratingConversion: RatingConversionRule[];
  abilityContributions: AbilityContribution[];
  forteSplit: Record<string, number>;
  roles: Record<string, RoleDef>;
}

export interface SlotSection {
  id: string;
  label: string;
  /** Whether the section starts expanded in the build editor, authored in `data/slots.json`. */
  defaultOpen?: boolean;
}

/** A build-wide value with no item of its own -- today's build-context fields (class, role,
 * duration, toggles, ...), and later mount/companion bolster, boon points, etc. `path` is a
 * dotted path into `build.context` (`role`, `forte.primary`, `toggles.combat`), resolved by
 * build-path.ts's `getPath`/`setPath` against `build.context` (not `build` itself, so a path
 * cannot address a sibling of `context` like `choices` or `id`).
 *
 * Fields below `quick` are a loose union of what each `paramType` needs (`options` for `list`,
 * `min`/`max`/`step`/`presets` for `number`/`percent`) -- same "optional fields, no separate
 * type per variant" convention `Item`'s `dynamicStat`/`dynamicMin`/`dynamicMax` already uses.
 *
 * `linkedItem` (an `Item.id`) is how a `list`/`boolean` param "equips" an item through its
 * current value -- a `list` option picks its own via `options[].linkedItem`, a `boolean`
 * shares the one on the slot itself, checked or not. `number`/`percent` never have one: there
 * is no single moment a numeric value starts/stops being "equipped". Resolved by
 * build-path.ts's `resolveLinkedItem`, which bonus.ts's `collect()` and catalog.ts's
 * `referencedOverlay` both call so a param's item is derived the same way everywhere rather
 * than stored -- see `resolveLinkedItem`'s own comment for why. */
export interface BuildParameterSlot {
  id: string;
  label: string;
  section: string;
  type: "build_parameter";
  paramType: "list" | "number" | "percent" | "boolean";
  path: string;
  /** Shown in the always-visible QuickOptions strip instead of its section's slot list. */
  quick?: boolean;
  default?: string | number | boolean;
  options?: { value: string; label: string; linkedItem?: string }[];
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
  /** Only meaningful when `paramType` is `"boolean"` -- see the class doc comment above. */
  linkedItem?: string;
}

export interface ItemPickerSlot {
  id: string;
  label: string;
  section: string;
  type: "item_picker";
  filter: string;
}

/** A row of independent numeric steppers sharing one label, one per item matching `filter` --
 * same resolution `ItemPickerSlot` uses, except every match becomes its own row instead of one
 * picked choice. Every point spent on a row's item is resolved by the engine exactly as if that
 * item had been picked in that many separate `item_picker` slots (bonus.ts's `collect()` bumps
 * `equipped`/tags/set pieces/bonus candidates by the count instead of by one). No shared point
 * budget across the row: each item's `pointAssignment.min`/`max` (on the item itself, see
 * `Item`) is its own bound, not a pool split between them. */
export interface PointAssignmentSlot {
  id: string;
  label: string;
  section: string;
  type: "point_assignment";
  filter: string;
}

/** The three slot types that render a real row (label, cursor anchor, hover/diff wiring) --
 * `BuildSlot.vue`'s own prop type, since a `SeparatorSlot` is routed around it entirely and
 * never reaches its shared row chrome. */
export type RowSlot = ItemPickerSlot | BuildParameterSlot | PointAssignmentSlot;

/** A purely visual divider between slots in a section's list -- no choice, no cursor stop, no
 * label rendering. Exists only so `data/slots.json` can group related slots (offense vs. defense
 * enchantments, boots vs. neck gear) without a dedicated section per group. `label` is optional
 * and unused by `SeparatorRow.vue` itself -- it only exists so the handful of call sites that
 * look up any `Slot` by id (`slotById.get(id)?.label`) keep compiling without special-casing a
 * type they'll never actually see a separator's id come through. */
export interface SeparatorSlot {
  id: string;
  section: string;
  type: "separator";
  label?: string;
}

/** A purely informational line of muted text in a section's list -- no choice, no cursor stop.
 * Unlike `SeparatorSlot` it does render its own content (`text`), sized/padded like a real row
 * so it reads as an inline note rather than a divider. `label` is optional and unused, kept for
 * the same reason as `SeparatorSlot`'s -- see that type's doc comment. */
export interface TextSlot {
  id: string;
  section: string;
  type: "text";
  text: string;
  label?: string;
}

export type Slot =
  | ItemPickerSlot
  | BuildParameterSlot
  | PointAssignmentSlot
  | SeparatorSlot
  | TextSlot;

/** A named set of defaults for one section, authored alongside it in `data/slots.json` (see
 * `deriveSlots` in data.ts, which injects `section` the same way it does for a `Slot`). Applying
 * one (buildEditor.ts's `applyPreset`) is a merge, not a replace: only the slots/items a field
 * mentions are written, everything else in the section is left as-is. Each field mirrors the
 * `Build` field it writes into, keyed by slot id rather than by path/nothing so a preset is
 * self-contained without needing a slot lookup to author. */
export interface SectionPreset {
  id: string;
  label: string;
  section: string;
  /** `build_parameter` slots -- same value shape as their own `default`. */
  params?: Record<string, string | number | boolean>;
  /** `item_picker` slots -- slot id to item id. */
  choices?: Record<string, string>;
  /** An `item_picker` slot's dynamic-stat magnitude, paired with `choices` the same way
   * `Build.values` pairs with `Build.choices`. */
  values?: Record<string, number>;
  /** `point_assignment` slots -- slot id to `{ itemId: count }`, merged into the existing row
   * rather than replacing it (matches `setAssignment`'s own per-item merge). */
  assignments?: Record<string, Record<string, number>>;
}

export interface SlotsData {
  sections: SlotSection[];
  slots: Slot[];
  /** Optional: several unit-test fixtures build a minimal `SlotsData` with no presets of
   * their own -- `db.ts`'s `build()` already defaults a missing one to `[]`. */
  presets?: SectionPreset[];
}

// --- items / bonuses -----------------------------------------------------------------------

/** Every non-stat field an item may carry -- see catalog.ts's `ITEM_FIELDS`, which lints
 * against this same list. Stat keys ride alongside as top-level properties (`item.acc`, not
 * `item.stats.acc`); a same-named index signature can't be typed `number` without conflicting
 * with `name`/`tags`/etc (TS2411), so it's `unknown` here -- read a stat with `item[key] as
 * number` (or `Number(item[key]) || 0`), same coercion the code already did untyped. */
export interface Item {
  /** Generator-assigned slug, frozen at first assignment (catalog.ts's `nextId`) and never
   * regenerated from `name` afterwards -- see catalog.ts's own note on why. This, not `name`,
   * is what a build/overlay/condition addresses; `name` is display-only and may repeat. */
  id: string;
  /** Display only, may repeat -- see `id` above. Still required (the editor won't save an
   * item with no name), just no longer the identity. */
  name: string;
  filter?: string;
  tags?: string[];
  maxCopies?: number;
  allowedClass?: string[];
  dynamicStat?: StatKey;
  dynamicMin?: number;
  dynamicMax?: number;
  /** Set only on an item meant to be spent points on via a `point_assignment` slot whose
   * `filter` matches this item's own -- see `PointAssignmentConfig`. */
  pointAssignment?: PointAssignmentConfig;
  bonuses?: string[];
  excludes?: string[];
  /** Short blurb shown alongside the item's stat summary in the build editor, for an
   * effect that reads better as text than as a stat (e.g. a proc) -- see
   * `BuildEditor.vue`'s `statSummary`. */
  shortDescription?: string;
  /** Longer flavor/explanation shown on the item's hover card, below its stats -- see
   * `ItemCard.vue`. */
  longDescription?: string;
  /** In-game internal item identifiers (`Hitem` in a demo record) that this catalogue entry
   * stands for. Several game items routinely collapse onto one entry -- different ranks of
   * the same enchantment, or a mount's four rarity tiers. Consumed only by the game importer;
   * the engine ignores it. */
  gameIds?: string[];
  [key: string]: unknown;
}

/** Bounds for one item's stepper in whichever `PointAssignmentSlot` matches this item's
 * `filter` -- presence of this object is what makes an item selectable there at all (see
 * `Db.forSlot`'s point_assignment branch), same role `dynamicStat` plays in gating
 * `dynamicMin`/`dynamicMax`. `priority` breaks ties in display order (lower first); items
 * sharing one priority (or omitting it, default 0) fall back to name order. */
export interface PointAssignmentConfig {
  min: number;
  max: number;
  default: number;
  priority?: number;
}

export interface RangeSpec {
  atLeast?: number;
  below?: number;
  exactly?: number;
}

/** A bare number is shorthand for `{ atLeast: n }` -- see conditions.ts's `inRange`. */
export type RangeLike = number | RangeSpec;

/** Reads any `build_parameter` by its (context-relative) path -- the escape hatch for a
 * parameter with no dedicated leaf. `key` is a path, e.g. `bolster` or `toggles.combat`, not a
 * slot id. The three comparison forms are mutually exclusive, chosen by the addressed
 * parameter's `paramType`: `atLeast`/`below` for `number`/`percent` (half-open, same as
 * `duration`'s range), `is` for `boolean`, `equals` for `list` (a scalar or array -- an array
 * means "is one of", same as `role`/`class`/`combatType`). */
export interface ParamCondition {
  key: string;
  atLeast?: number;
  below?: number;
  is?: boolean;
  equals?: string | string[];
}

/** The object form of a `proc` leaf -- authored when the default label/default-on behaviour
 * (see `ConditionWhen.proc`) isn't enough. Both fields optional, so `{}` is legal (equivalent
 * to bare `true`) though authors should just write `true` in that case. */
export interface ProcCondition {
  /** Overrides the per-item checkbox's label, which otherwise falls back to the bonus set's own
   *  `name` -- lets the bonus's `name` stay the in-game-accurate flavor text while the checkbox
   *  describes the actual trigger (e.g. bonus "Avalanche of Blades", label "10% chance on crit
   *  to launch an avalanche"). */
  label?: string;
  /** Whether this proc starts enabled for a build that has never touched it. Omitted means
   *  true, matching every other toggle's own default-on behaviour. */
  default?: boolean;
}

/** A `when` predicate (conditions.ts). Keys present are ANDed; an absent key is unconstrained.
 * Loose on leaf value types (`string | string[]`) because conditions.ts's `asArray` accepts
 * either uniformly. */
export interface ConditionWhen {
  toggle?: string | string[];
  role?: string | string[];
  class?: string | string[];
  combatType?: string | string[];
  damageType?: string | string[];
  duration?: RangeLike;
  pieces?: RangeSpec & { set: string };
  equipped?: RangeSpec & { tag?: string; item?: string };
  param?: ParamCondition;
  /** Gates the grant on its own per-grant proc toggle (build.procs, keyed by a stable
   *  `${bonusSetId}:${grantIndex}` -- see bonus.ts's `evaluateBonus`) rather than the build-wide
   *  `toggles` map, so a build with several proc-conditional items can enable/disable each
   *  independently. Bare `true` is the common case (default label, default-on); the object form
   *  overrides the checkbox's label and/or starting state -- see `ProcCondition`. */
  proc?: boolean | ProcCondition;
  all?: ConditionWhen[];
  any?: ConditionWhen[];
  not?: ConditionWhen;
}

export interface GrantVariant {
  when?: ConditionWhen;
  stats: StatValues;
}

export interface GrantTier {
  /** `set` is technically optional on the type (mirroring `RangeSpec`'s shape) but a tier
   * omitting it always evaluates to 0 pieces -- see conditions.ts's `pieces` leaf. */
  pieces?: RangeSpec & { set?: string };
  stats: StatValues;
}

/** A grant that reports a build problem instead of granting stats -- surfaced the same way as
 * engine.ts's own hardcoded checks (inline on the slot, summarized in the sidebar), just
 * authored as data via the bonus system instead of TypeScript. */
export interface GrantProblem {
  severity: "error" | "warning";
  message: string;
  /** Shown instead of the triggering slot's name as the sidebar summary's lead-in -- for a
   * problem about a build-wide concept (e.g. boon progression) rather than the slot it happens
   * to be attributed to, the slot name is misleading as a label. Falls back to the slot's own
   * label when absent. */
  label?: string;
  /** When true, an item that would make this problem active is left out of that slot's item
   * picker dropdown entirely, not just flagged once picked -- e.g. a variant that's incompatible
   * with a class or another equipped piece. Consumers may still choose not to apply this (an
   * "ignore picker filters" toggle for what-if builds), so it's a request, not a guarantee. */
  hideFromPicker?: boolean;
}

/** Anonymous by design -- only the owning `BonusSet.id` is addressable, not the grant itself.
 * `stats`/`tiers`/`variants`/`problem` are mutually exclusive payloads chosen at authoring
 * time (see bonus-draft.ts's `payload`); only one is ever set on a given grant. */
export interface Grant {
  when?: ConditionWhen;
  stats?: StatValues;
  variants?: GrantVariant[];
  tiers?: GrantTier[];
  problem?: GrantProblem;
  /** Same as `Item.shortDescription`/`longDescription`, shown whenever this grant is
   * active -- next to its slot's stat summary and on that slot's hover card
   * respectively, alongside the item's own text. */
  shortDescription?: string;
  longDescription?: string;
}

export interface BonusSet {
  id: string;
  name?: string;
  grants?: Grant[];
  excludes?: string[];
  stacking?: "perSource" | string;
  maxStacks?: number;
}

/** One item's contribution of one bonus set -- db.ts's `bonusesFor`. */
export interface BonusCandidate {
  bonus: BonusSet;
  setId: string;
  source: string;
}

// --- the db (db.ts's `build` return shape) --------------------------------------------------

export interface Db {
  items: Item[];
  schema: Schema;
  slots: Slot[];
  sections: SlotSection[];
  presets: SectionPreset[];
  slotById: Map<string, Slot>;
  bonusSets: BonusSet[];
  bonusSetById: Map<string, BonusSet>;
  setMembers: Map<string, string[]>;
  itemsByTag: Map<string, string[]>;
  /** Game `Hitem` -> catalogue item id. Built from base catalogue + active overlay, so a
   *  layer can add mappings the shipped catalogue does not have. Overlay entries win over
   *  base entries for the same game id, matching how overlays already win for the item
   *  itself -- see catalog.ts's `compose`. */
  itemByGameId: Map<string, string>;
  duplicates: string[];
  get(id: string | null | undefined): Item | null;
  forFilter(filter: string): Item[];
  forSlot(slotId: string): Item[];
  maxCopies(item: Item | null | undefined): number;
  bonusesFor(item: Item): BonusCandidate[];
}

// --- catalogue overlay (catalog.ts) ----------------------------------------------------------

export interface CatalogOverlay {
  items: Record<string, Item | null>;
  bonusSets: Record<string, BonusSet | null>;
  sectionPresets: Record<string, SectionPreset | null>;
}

export type CatalogGroup = "items" | "bonusSets" | "sectionPresets";

export interface LintFinding {
  level: "error" | "warn";
  message: string;
  name?: string;
  kind: "item" | "bonusSet" | "sectionPreset";
}

// --- builds (storage.ts) ---------------------------------------------------------------------

export interface ForteSplit {
  primary?: StatKey;
  secondaryA?: StatKey;
  secondaryB?: StatKey;
}

export interface BuildContext {
  class: string;
  role: string;
  combatType: string;
  damageType: string;
  duration: number;
  magnitude: number;
  m32Forte: boolean;
  forte: ForteSplit;
  toggles: Record<string, boolean>;
}

export interface BuildCompare {
  id: string;
  highlight: boolean;
  onlyDiff: boolean;
}

export interface Build {
  id: string;
  name: string;
  choices: Record<string, string>;
  values: Record<string, number>;
  /** Every `point_assignment` slot's current counts, by slot id then item id. Seeded from each
   * row's `default` (storage.ts's `defaultBuild`), same as `context` is seeded from
   * `build_parameter` defaults -- so a read never needs an `?? row.default` fallback for a
   * build the app itself produced, only for hand-edited/imported ones. */
  assignments: Record<string, Record<string, number>>;
  /** Per-grant proc toggles, keyed by `${bonusSetId}:${grantIndex}` (see `EvalContext.procs`).
   *  A key absent here reads as on -- only ever holds explicit off/on overrides a user made,
   *  not one entry per proc-gated grant that exists. */
  procs: Record<string, boolean>;
  context: BuildContext;
  compare: BuildCompare;
  catalog?: CatalogOverlay;
  downloaded?: { snapshot: BuildSnapshot; at: number };
}

export type BuildSnapshot = Omit<Build, "downloaded">;

export interface Layer {
  id: string;
  name: string;
  /** Travels with the layer in a download. */
  enabled: boolean;
  overlay: CatalogOverlay;
  /** Full content as last downloaded or imported — decision 15. */
  downloaded?: { snapshot: LayerSnapshot; at: number };
}

export type LayerSnapshot = Omit<Layer, "downloaded">;

/** App-level state that belongs to no single item. */
export interface AppMeta {
  buildOrder: string[];
  layerOrder: string[];
  lastSelection: Selection | null;
}

export type Selection = { kind: "build" | "layer"; id: string };

export interface HistoryEntry {
  json: string;
  label: string;
}

export interface ItemHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
  lastKey: string | null;
  lastAt: number;
}

export interface TrashEntry {
  kind: "build" | "layer";
  item: Build | Layer;
  deletedAt: number;
}

// --- resolution (bonus.ts / engine.ts) --------------------------------------------------------

/** The context a `when` predicate is evaluated against -- bonus.ts's `collect()` builds this
 * once per resolve from the build's slots/context, conditions.ts only ever reads it. */
export interface EvalContext {
  class?: string;
  role?: string;
  combatType?: string;
  damageType?: string;
  duration: number;
  toggles: Record<string, boolean>;
  equipped: Map<string, number>;
  tags: Map<string, number>;
  setPieces: Map<string, number>;
  /** Friendly names for bonus set IDs, so conditions can display "Gladiator's Guile"
   *  instead of "m31-gladiators-guile" in their labels. */
  setNames: Map<string, string>;
  /** Every `build_parameter`'s current value, keyed by its (context-relative) `path` -- what
   *  the `param` leaf reads. Built once by bonus.ts's `collect()`. */
  params: Map<string, string | number | boolean>;
  /** Every per-grant proc toggle currently on record (`build.procs`), keyed by
   *  `${bonusSetId}:${grantIndex}`. A key absent from the map defaults to *on*, mirroring the
   *  old global toggle's default-on behaviour -- see conditions.ts's `proc` leaf. */
  procs?: Record<string, boolean>;
}

export interface ConditionLeafResult {
  ok: boolean;
  label: string;
  detail?: string;
  children?: ConditionLeafResult[];
}

export interface ConditionExplain {
  ok: boolean;
  leaves: ConditionLeafResult[];
  unmet: ConditionLeafResult[];
}

export interface ResolvedRow {
  slotId: string;
  slot: Slot;
  choice: string | undefined;
  item: Item | null;
}

export interface GrantEvaluation {
  active: boolean;
  gate: ConditionExplain;
  stats: StatValues | null;
  chose: string | null;
  problem: GrantProblem | null;
  /** Set to this grant's stable `${bonusSetId}:${grantIndex}` key when its `when` is gated by
   *  `proc` -- null otherwise. The UI uses this both to know a grant needs a per-item proc
   *  checkbox at all, and as the key to read/write in `build.procs`. */
  procKey: string | null;
}

export interface BonusEvaluation {
  active: boolean;
  gate: ConditionExplain;
  stats: StatValues | null;
  chose: string | null;
  previewStats: StatValues | null;
  grants: (GrantEvaluation & { raw: Grant })[];
  /** Every active grant's `problem` payload, in grant order -- a set mixing stat and problem
   * grants reports both, same as it sums both grants' stats. */
  problems: GrantProblem[];
}

export interface EvaluatedBonus {
  id: string;
  bonus: BonusSet;
  setId: string;
  sources: string[];
  slotId: string;
  active: boolean;
  gate: ConditionExplain;
  chose: string | null;
  stats: StatValues | null;
  previewStats: StatValues | null;
  grants: (GrantEvaluation & { raw: Grant })[];
  problems: GrantProblem[];
  stacks: number;
  excluded: boolean;
  excludedBy: string | null;
  appliedStats?: StatValues | null;
}

export interface ResolvedBonuses {
  ctx: EvalContext;
  rows: ResolvedRow[];
  bonuses: EvaluatedBonus[];
  bonusStatsBySlot: Map<string, Map<StatKey, number>>;
  /** A `point_assignment` slot's own item stats (each row's item stats × its count, summed) --
   * the counterpart to `bonusStatsBySlot` for the item side rather than the bonus side, since
   * a `point_assignment` row has no single `ResolvedRow.item` to read stats off of. */
  assignmentStatsBySlot: Map<string, Map<StatKey, number>>;
}

export interface EngineError {
  slotId: string;
  kind: "class" | "maxCopies" | "outOfRange" | "missing" | "bonusRule";
  choice: string;
  message: string;
  severity: "error" | "warning";
  /** `GrantProblem.label`, when the error came from one -- StatPanel.vue's sidebar summary
   * prefers this over the slot's own label. */
  label?: string;
}

/** A slot's item stats plus the bonuses attributed to it -- engine.ts's `rowVectors`. */
export interface EngineRow {
  slotId: string;
  choice: string | undefined;
  item: Item | null;
  stats: Record<StatKey, number>;
}

/** Every stage of the pipeline (engine.ts's `run`), each a full stat vector. Kept as a
 * dictionary rather than one named field per stage because the bonus inspector and stat panel
 * both look a stage up by name at runtime (`stages[stageName]`). */
export type Stages = Record<string, Record<StatKey, number>>;

// Each of these three keeps a `[key: string]: number` index signature alongside its named
// properties (harmless -- every property here is already a `number`) because StatPanel.vue
// picks a row dynamically off a `[label, key][]` table (its own `damageRows`/`healingRows`/
// `ehpRows`), not by a literal property access.
export interface DamageOutputs {
  average: number;
  critNoDeflect: number;
  critDeflect: number;
  noCritNoDeflect: number;
  noCritDeflect: number;
  [key: string]: number;
}

export interface HealingOutputs {
  average: number;
  crit: number;
  noCrit: number;
  [key: string]: number;
}

export interface EhpOutputs {
  average: number;
  critNoDeflect: number;
  [key: string]: number;
}

export interface DerivedOutputs {
  itemLevel: number;
  hp: number;
  baseDamage: number;
  effectiveMagPhys: number;
  overallHealing: number;
  damage: DamageOutputs;
  healing: HealingOutputs;
  ehp: EhpOutputs;
}

export interface ResolvedBuild {
  context: EvalContext;
  rows: EngineRow[];
  bonuses: EvaluatedBonus[];
  stages: Stages;
  derived: DerivedOutputs;
  errors: EngineError[];
}
