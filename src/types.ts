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

import type rawSchema from '../data/schema.json';

export type StatDef = (typeof rawSchema)['stats'][number];
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
}

/** A build-wide value with no item of its own -- today's build-context fields (class, role,
 * duration, toggles, ...), and later mount/companion bolster, boon points, etc. `path` is a
 * dotted path into `Build` (`context.role`, `context.forte.primary`, `context.toggles.combat`)
 * resolved by build-path.ts's `getPath`/`setPath`, so the engine keeps reading/writing exactly
 * the fields it does today -- this only changes how the value is declared and rendered.
 *
 * Fields below `quick` are a loose union of what each `paramType` needs (`options` for `list`,
 * `min`/`max`/`step`/`presets` for `number`/`percent`) -- same "optional fields, no separate
 * type per variant" convention `Item`'s `dynamicStat`/`dynamicMin`/`dynamicMax` already uses. */
export interface BuildParameterSlot {
  id: string;
  label: string;
  section: string;
  type: 'build_parameter';
  paramType: 'list' | 'number' | 'percent' | 'boolean';
  path: string;
  /** Shown in the always-visible QuickOptions strip instead of its section's slot list. */
  quick?: boolean;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
}

export interface ItemPickerSlot {
  id: string;
  label: string;
  section: string;
  type: 'item_picker';
  filter: string;
}

export type Slot = ItemPickerSlot | BuildParameterSlot;

export interface SlotsData {
  sections: SlotSection[];
  slots: Slot[];
}

// --- items / bonuses -----------------------------------------------------------------------

/** Every non-stat field an item may carry -- see catalog.ts's `ITEM_FIELDS`, which lints
 * against this same list. Stat keys ride alongside as top-level properties (`item.acc`, not
 * `item.stats.acc`); a same-named index signature can't be typed `number` without conflicting
 * with `name`/`tags`/etc (TS2411), so it's `unknown` here -- read a stat with `item[key] as
 * number` (or `Number(item[key]) || 0`), same coercion the code already did untyped. */
export interface Item {
  name: string;
  filter?: string;
  tags?: string[];
  maxCopies?: number;
  allowedClass?: string[];
  dynamicStat?: StatKey;
  dynamicMin?: number;
  dynamicMax?: number;
  bonuses?: string[];
  excludes?: string[];
  [key: string]: unknown;
}

export interface RangeSpec {
  atLeast?: number;
  below?: number;
  exactly?: number;
}

/** A bare number is shorthand for `{ atLeast: n }` -- see conditions.ts's `inRange`. */
export type RangeLike = number | RangeSpec;

/** A `when` predicate (conditions.ts). Keys present are ANDed; an absent key is unconstrained.
 * Loose on leaf value types (`string | string[]`) because conditions.ts's `asArray` accepts
 * either uniformly. */
export interface ConditionWhen {
  toggle?: string | string[];
  role?: string | string[];
  class?: string | string[];
  combatType?: string | string[];
  location?: string | string[];
  damageType?: string | string[];
  duration?: RangeLike;
  pieces?: RangeSpec & { set: string };
  equipped?: RangeSpec & { tag?: string; item?: string };
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

/** Anonymous by design -- only the owning `BonusSet.id` is addressable, not the grant itself.
 * See CLAUDE.md, "a bonus set resolves as one unit". */
export interface Grant {
  when?: ConditionWhen;
  stats?: StatValues;
  variants?: GrantVariant[];
  tiers?: GrantTier[];
}

export interface BonusSet {
  id: string;
  name?: string;
  grants?: Grant[];
  excludes?: string[];
  stacking?: 'perSource' | string;
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
  slotById: Map<string, Slot>;
  bonusSets: BonusSet[];
  bonusSetById: Map<string, BonusSet>;
  setMembers: Map<string, string[]>;
  itemsByTag: Map<string, string[]>;
  duplicates: string[];
  get(name: string | null | undefined): Item | null;
  forFilter(filter: string): Item[];
  forSlot(slotId: string): Item[];
  maxCopies(item: Item | null | undefined): number;
  bonusesFor(item: Item): BonusCandidate[];
}

// --- catalogue overlay (catalog.ts) ----------------------------------------------------------

export interface CatalogOverlay {
  items: Record<string, Item | null>;
  bonusSets: Record<string, BonusSet | null>;
}

export type CatalogGroup = 'items' | 'bonusSets';

export interface LintFinding {
  level: 'error' | 'warn';
  message: string;
  name?: string;
  kind: 'item' | 'bonusSet';
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
  location: string;
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
  updated: number;
  choices: Record<string, string>;
  values: Record<string, number>;
  context: BuildContext;
  compare: BuildCompare;
  catalog?: CatalogOverlay;
}

export interface Library {
  builds: Build[];
  activeId: string;
}

export interface Collection {
  id: string;
  name: string;
  updated: number;
  buildIds: string[];
  activeBuildId: string;
}

export interface Collections {
  collections: Collection[];
  activeCollectionId: string;
}

// --- resolution (bonus.ts / engine.ts) --------------------------------------------------------

/** The context a `when` predicate is evaluated against -- bonus.ts's `collect()` builds this
 * once per resolve from the build's slots/context, conditions.ts only ever reads it. */
export interface EvalContext {
  class?: string;
  role?: string;
  combatType?: string;
  location?: string;
  damageType?: string;
  duration: number;
  toggles: Record<string, boolean>;
  equipped: Map<string, number>;
  tags: Map<string, number>;
  setPieces: Map<string, number>;
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
}

export interface BonusEvaluation {
  active: boolean;
  gate: ConditionExplain;
  stats: StatValues | null;
  chose: string | null;
  previewStats: StatValues | null;
  grants: (GrantEvaluation & { raw: Grant })[];
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
}

export interface EngineError {
  slotId: string;
  kind: 'class' | 'maxCopies' | 'outOfRange';
  choice: string;
  message: string;
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
