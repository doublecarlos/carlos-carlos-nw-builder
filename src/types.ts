// The domain model shared across data.ts / db.ts / catalog.ts / bonus.ts / conditions.ts /
// engine.ts / storage.ts / condition-draft.ts / bonus-draft.ts. Pulled into one place instead
// of re-declared per file because the same shapes (Item, Bonus, Grant, Build, Schema) cross
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

/** A whole category of items whose own stat line is scaled by a build parameter -- mount and
 * companion bolster, where the game multiplies the item's every stat by `1 + bolster`.
 *
 * Declared as data so "which items scale" is a catalogue question rather than a hardcoded
 * filter list in the engine: `applies` is the same `{ filter, tags }` selector `optionsFrom`
 * uses, so an overlay item opts in by carrying a tag, with no code or schema edit. The factor
 * is read from the `build_parameter` at `param`, which is where the value's range, default and
 * UI live -- a scaler declares only *what* it scales, never how much.
 *
 * Applies to an item's own stat vector alone. Bonuses an item grants are attributed to a slot
 * rather than to the item that granted them (bonus.ts's `anchor.slotId`), so they are
 * deliberately out of scope. */
export interface StatScaler {
  id: string;
  label: string;
  /** A `BuildParameterSlot.path`, read out of `EvalContext.params`. */
  param: string;
  applies: { filter?: string[]; tags?: string[] };
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
  statScalers: StatScaler[];
}

export interface SlotSection {
  id: string;
  label: string;
  /** Whether the section starts expanded in the build editor, authored in `data/slots.json`. */
  defaultOpen?: boolean;
}

/** The one field every `Slot` variant carries, whatever it renders. */
export interface SlotVisibility {
  /** Renders this slot's row only while the condition holds, evaluated against the *resolved*
   * build (`ResolvedBuild.context`).
   *
   * Display only: a hidden row's value still reaches the engine untouched -- a param resolves,
   * a pick stays equipped, points stay spent. Anything else would make every condition reading
   * a slot depend on what happened to be rendered. Evaluating against the resolved context
   * also means a slot cannot influence its own visibility mid-resolution. */
  visibleWhen?: ConditionWhen;
}

/** A build-wide value with no item of its own -- the engine-coupled build-context fields
 * (role, damageType, forte, duration, magnitude, toggles, ...). `path` is a dotted path into
 * `build.context` (`role`, `forte.primary`, `toggles.combat`), resolved by build-path.ts's
 * `getPath`/`setPath` against `build.context` (not `build` itself, so a path cannot address a
 * sibling of `context` like `choices` or `id`).
 *
 * Fields below `quick` are a loose union of what each `paramType` needs (`options` for `list`,
 * `min`/`max`/`step`/`presets` for `number`/`percent`) -- same "optional fields, no separate
 * type per variant" convention `DynamicStatConfig` already uses.
 *
 * A parameter never equips an item. It used to: a `list`/`boolean` param could name a
 * `linkedItem` that came and went with its value, which is how `class` behaved before it
 * became an ordinary `item_picker`. `Item.publishes` inverts that relationship -- an equipped
 * item asserts the value, instead of a value conjuring an item -- so anything that needs to
 * both carry stats and set a context value is an item picker now, and a parameter is only ever
 * the scalar itself. */
export interface BuildParameterSlot extends SlotVisibility {
  id: string;
  label: string;
  section: string;
  type: "build_parameter";
  paramType: "list" | "number" | "percent" | "boolean";
  path: string;
  /** Shown in the always-visible QuickOptions strip instead of its section's slot list. */
  quick?: boolean;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  /** `list` only: derive the option set from the item catalogue instead of enumerating it
   * inline, so "add a value" becomes "add an item" and happens entirely in the item editor.
   * Same `filter` XOR `tags` selector `ItemPickerSlot` uses, resolved by db.ts's `build()`
   * against the *composed* catalogue -- an overlay-added item carrying the tag becomes an
   * option with no slot edit at all.
   *
   * Mutually exclusive with `options` (catalog.ts's `validateSlots` enforces all three rules).
   * A derived option takes its `value` and `linkedItem` from the item id and its `label` from
   * the item name, so `options[].linkedItem` structurally cannot dangle the way a hand-written
   * one can -- the option *is* the item. Ordered by name: an option set is a vocabulary to
   * pick a known value out of, not a ranking, so `Db.forSlot`'s item-level-first order (which
   * answers "which of these is best") would be the wrong question here. */
  optionsFrom?: { filter?: string; tags?: string[] };
  /** `optionsFrom` only: prepend the empty "- none -" row. Explicit rather than automatic
   * because a derived option set has no other way to say whether "no value" is legal, and
   * silently prepending it would make a genuinely required parameter unexpressible. An inline
   * `options` list just authors the empty row itself, as every shipped one does. */
  allowEmpty?: boolean;
  min?: number;
  max?: number;
  step?: number;
  presets?: number[];
}

export interface ItemPickerSlot extends SlotVisibility {
  id: string;
  label: string;
  section: string;
  type: "item_picker";
  /** Shown in the always-visible QuickOptions strip instead of its section's slot list, for a
   * pick that reads as an option rather than as gear (the location picker). Rendered bare-name
   * there whatever `hidePreview` says: the strip has no room for a stat preview. */
  quick?: boolean;
  /** Item id a fresh build starts on, and returns to when cleared -- for a slot whose empty
   * state is not a sensible build. Seeds `Build.choices`, so a read is an ordinary stored
   * choice needing no `?? slot.default` fallback. A default that is not one of this slot's own
   * candidates is an authoring error (`validateSlotDefaults`), not a silently empty slot. */
  default?: string;
  /** Drops the empty "- none -" row from this slot's picker, so a pick can be changed but not
   * taken back. Needs a `default`, or a fresh build starts in the state it forbids. */
  disallowEmpty?: boolean;
  /** Exact-match category key into `Db.forFilter`/`byFilter`. Mutually exclusive with `tags` --
   * `catalog.ts`'s `validateSlots` requires exactly one of the two, since a slot resolves its
   * candidates one way or the other, never both. */
  filter?: string;
  /** Alternative to `filter`: selects every item carrying at least one of these tags, OR-matched
   * (`Db.itemsByTag`), instead of one exact-match category. Lets a single item serve several
   * slots at once -- e.g. a companion power tagged both `companion_power:offense` and
   * `companion_power:utility` is a candidate in both slots -- without a dedicated `filter` value
   * per combination. */
  tags?: string[];
  /** Strips the dropdown down to bare item names -- no item level, no conditional-bonus marker,
   * no stat/bonus preview lines. For slots whose candidates are identities rather than gear
   * (the class picker), where the preview is noise: what a class "grants" is the whole build,
   * not a stat line worth comparing rows by. Purely presentational -- candidate filtering
   * (`hideFromPicker`) is unaffected. */
  hidePreview?: boolean;
  /** Set only on a row expanded from an `ItemPickerListSlot`: the container's id, which is
   * what the row's remove button acts on. */
  list?: string;
}

/** A row of independent numeric steppers sharing one label, one per item matching `filter` --
 * same resolution `ItemPickerSlot` uses, except every match becomes its own row instead of one
 * picked choice. Every point spent on a row's item is resolved by the engine exactly as if that
 * item had been picked in that many separate `item_picker` slots (bonus.ts's `collect()` bumps
 * `equipped`/tags/bonus occurrences/bonus candidates by the count instead of by one). No shared point
 * budget across the row: each item's `inlineRepetition.min`/`max` (on the item itself, see
 * `Item`) is its own bound, not a pool split between them. */
export interface PointAssignmentSlot extends SlotVisibility {
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
export interface SeparatorSlot extends SlotVisibility {
  id: string;
  section: string;
  type: "separator";
  label?: string;
}

/** A purely informational line of muted text in a section's list -- no choice, no cursor stop.
 * Unlike `SeparatorSlot` it does render its own content (`text`), sized/padded like a real row
 * so it reads as an inline note rather than a divider. `label` is optional and unused, kept for
 * the same reason as `SeparatorSlot`'s -- see that type's doc comment. */
export interface TextSlot extends SlotVisibility {
  id: string;
  section: string;
  type: "text";
  text: string;
  label?: string;
}

/**
 * A variable-length run of item pickers over one selector. item-picker-list.ts expands it into
 * that many ordinary `ItemPickerSlot`s, so everything downstream sees plain picks.
 *
 * Row ids are positional (`misc.misc#3`, 1-based to match the label), which is what lets a
 * `SectionPreset` address rows through the same `choices`/`values`/`assignments` fields every
 * other slot uses; removing a row therefore re-keys the ones below it.
 *
 * The container holds no value -- `Build.listRows` has its row count -- and renders only the
 * row that adds another.
 */
export interface ItemPickerListSlot extends SlotVisibility {
  id: string;
  label: string;
  section: string;
  type: "item_picker_list";
  /** Rows an empty build starts with. Usually 0. */
  defaultRows?: number;
  /** The exclusive `filter` XOR `tags` selector `ItemPickerSlot` carries, handed to every row. */
  filter?: string;
  tags?: string[];
}

export type Slot =
  | ItemPickerSlot
  | ItemPickerListSlot
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
  /** An `item_picker` slot's dynamic-stat magnitude(s), paired with `choices` the same way
   * `Build.values` pairs with `Build.choices` -- see `Build.values`'s own doc comment for the
   * inner key. */
  values?: Record<string, Record<string, number>>;
  /** `point_assignment` slots -- slot id to `{ itemId: count }`, merged into the existing row
   * rather than replacing it (matches `setAssignment`'s own per-item merge). */
  assignments?: Record<string, Record<string, number>>;
  /** Each item's `BonusOccurrenceConfig` count(s), item id then bonus id -- keyed by item, not
   * by slot, because `Build.occurrenceInputs` (the field this writes into) is itself per-item:
   * an item's count follows the item wherever it is picked, so a slot key here would have
   * nothing to address. Reaches items picked through `choices` and items stepped on a
   * `point_assignment` row alike, which is also why this is the one field a preset carries that
   * the section's slot ids don't scope. */
  occurrences?: Record<string, Record<string, number>>;
  /** Slot ids the preset resets to their built-in default instead of setting -- the one field
   * that *removes* rather than writes, so a preset can say "this section has no ring" rather
   * than only ever adding to whatever was already there. Same per-slot-type handling
   * `clearSection` uses: an `item_picker` loses its choice and values, a `build_parameter`
   * goes back to its `default`, a `point_assignment` row back to every item's
   * `inlineRepetition.default`. Applied before the writing fields, so naming a slot in both
   * (as `Create new from current` never does, but a hand-authored preset may) still ends with
   * the written value. */
  clears?: string[];
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
  /** Zero or more player-typed magnitudes this item carries -- e.g. a weapon enchant whose
   *  rank the player picks, or (once a matching `Grant`/`GrantVariant` declares its own) a
   *  companion power whose percentage the player dials in. Each entry's stored value lives in
   *  `Build.values[slotId]`, keyed by `dynamicValueKey` (dynamic-stats.ts) -- an item's own
   *  entries key by `stat` alone, so two entries on one item must target different stats. */
  dynamicStats?: DynamicStatConfig[];
  /** Declares that this item repeats "inline" N times wherever it's chosen: a
   * `point_assignment` row (one repetition per point spent) or an `item_picker` pick (the row
   * grows a stepper). Named apart from either slot type deliberately -- it is the item's own
   * property, so both consumers read the same declaration. */
  inlineRepetition?: InlineRepetitionConfig;
  /** A bare id means "always exactly 1 occurrence of this bonus" (the original, still-common
   * shape). A `BonusOccurrenceConfig` lets the same item instead declare a typed, player-set
   * count for one bonus -- e.g. one item standing in for 1-5 stacks of a set bonus instead of 5
   * separate mutually-exclusive items, or a stacking effect that coexists with the item's own
   * always-on stats. An item may mix both shapes, one entry per bonus it carries. */
  bonuses?: (string | BonusOccurrenceConfig)[];
  excludes?: string[];
  /** Short blurb shown alongside the item's stat summary in the build editor, for an
   * effect that reads better as text than as a stat (e.g. a proc) -- see
   * `BuildEditor.vue`'s `statSummary`. */
  shortDescription?: string;
  /** Longer flavor/explanation shown on the item's hover card, below its stats -- see
   * `ItemCard.vue`. */
  longDescription?: string;
  /** Drops this item from every list offering a *new* pick: an item_picker dropdown, an
   * `optionsFrom` option set, a point_assignment row at count 0. A build already using it keeps
   * calculating it unchanged. The item-level counterpart to `GrantProblem.hideFromPicker`.
   *
   * Never hides what the build already holds (db.ts's `stillOffered`), or clearing a pick would
   * be a one-way door. */
  hideFromPicker?: boolean;
  /** The item that supersedes this one: an offer, not a redirect. A build holding this id
   * keeps reading and calculating as *this* item until the player accepts the swap, so lookups
   * never forward (db.ts's `endOfChain`).
   *
   * A bare id is the plain case; an `ItemReplacement` adds `values` to seed the replacement's
   * dynamic stats, which is what makes accepting change ids without changing stats. Read
   * through item-replacement.ts, same convention `Item.bonuses` uses.
   *
   * Independent of `hideFromPicker`; setting both is the ordinary retirement.
   * `validateReplacements` reports cycles and dangling ids. */
  replacedBy?: string | ItemReplacement;
  /** In-game internal item identifiers (`Hitem` in a demo record) that this catalogue entry
   * stands for. The relation is many-to-many. Several game items routinely collapse onto one
   * entry -- different ranks of the same enchantment, or a mount's four rarity tiers. One game
   * item also spreads across several entries when its stats depend on where it is slotted: a
   * Celestial Garnet is one `Hitem` in game but an offense, a defense and a utility entry
   * here, all three carrying it. Entries sharing a game id must differ by `filter` so the
   * importer can tell them apart. Consumed only by the game importer; the engine ignores it. */
  gameIds?: string[];
  /** `build_parameter` slot id to the value it should take on whenever this item gets picked
   * through an `item_picker` slot -- e.g. a Paragon item defaulting Role and Forte to its
   * canonical spec. Same shape as `SectionPreset.params`. Applied once at pick time
   * (`buildEditor.ts`'s `setChoice`); the fields stay ordinary editable params afterward, so a
   * player can still override them for a "what-if" build.
   *
   * Values are optional because entries declare different key sets: the shipped JSON's
   * inferred type gives an absent key `?: undefined` on entries whose siblings do declare
   * it, which a bare index signature rejects. No entry ever holds an explicit undefined. */
  defaultParams?: Record<string, string | number | boolean | undefined>;
  /** Context path to the value this item asserts *while it is equipped* -- e.g. a class item
   * publishing `{ "class": "bard" }`. Continuous and derived: never stored on the build, never
   * user-editable, and gone the moment the item is unequipped. bonus.ts's `collect()` folds it
   * into `ctx.params` and the derived context after the equipped set is known, so the result
   * does not depend on slot order.
   *
   * The counterpart to `defaultParams`, and deliberately not a replacement for it -- they
   * answer different questions. `defaultParams` seeds a *suggestion* at pick time that the
   * player may then override; `publishes` states a fact that the player cannot edit at all.
   *
   * Keyed by path (`class`), not by slot id -- unlike `defaultParams` -- because a published
   * value has no slot: it is what lets a selector-only build_parameter become an ordinary
   * `item_picker`. Two equipped items publishing *different* values for one path is a build
   * error (engine.ts's `publishConflicts`), not a race; the same value twice is fine, which is
   * what makes equipping two copies of one item harmless. */
  publishes?: Record<string, string | number | boolean>;
  [key: string]: unknown;
}

/**
 * A replacement that carries values forward, not just identity.
 *
 * `values` seeds the replacement's `dynamicStats` at migration (`migrateItemIds`). It exists
 * for the shape this mechanism is for: several fixed-value items collapsing onto one with a
 * player-typed magnitude, where migrating on identity alone would move every old build onto
 * the new `default` and silently change its numbers.
 */
export interface ItemReplacement {
  item: string;
  values?: StatValues;
}

/** Bounds for one item's repetition count. Its presence is what gates the input, the role a
 * `DynamicStatConfig` entry plays for its own: on a `PointAssignmentSlot` matching this item's
 * `filter` it also decides whether the item is offered there at all (`Db.forSlot`), and on an
 * `ItemPickerSlot` it adds a stepper beside the picker.
 *
 * `priority` orders a point_assignment slot's rows (lower first, then by name). It means
 * nothing to an `item_picker`, which shows one item at a time. */
export interface InlineRepetitionConfig {
  min: number;
  max: number;
  default: number;
  priority?: number;
  /** Overrides this item's repetition stepper caption -- its own `name` on a point-assignment
   *  row, the default "Copies" on an `item_picker` row. Same per-attachment display override
   *  `BonusOccurrenceConfig.label` makes; item lists and hover cards still show the real name. */
  label?: string;
}

/** One item's typed occurrence count for one bonus it carries -- an `Item.bonuses` entry in
 * place of a bare id, see `Item.bonuses`'s own doc comment. `bonus` is required (unlike
 * `InlineRepetitionConfig`, which needs none: an item may carry several of these, one per bonus,
 * so each has to say which bonus it's for). `min === max` needs no player input at all -- the
 * item always contributes `min` occurrences, same as a bare-id attachment always contributes 1
 * but with a magnitude other than 1. Deliberately not named/shaped after `InlineRepetitionConfig`
 * even though the bounds match: the two are independent counts (see bonus.ts's
 * `collectInlineRepetition` -- a plain-id bonus scales with the item's own inline-repetition
 * count, but a `BonusOccurrenceConfig`-carrying one does not) that may not stay structurally
 * identical as either one grows. */
export interface BonusOccurrenceConfig {
  bonus: string; // Bonus.id
  min: number;
  max: number;
  default: number;
  /** Overrides the bonus's own `name` for this attachment's row only -- the checkbox/stepper
   *  `useItemBonusOccurrences.ts` builds for the build editor, and the matching compare-diff
   *  title in `useCompareDiff.ts`. Everywhere else (bonus lists, hover cards, etc.) still shows
   *  the bonus's real name; this only reads differently on this one item's own input, e.g. a
   *  bonus named for its overall effect whose per-item stepper should read "Stacks" instead. */
  label?: string;
}

/** One player-typed magnitude an item or a grant/variant declares -- `Item.dynamicStats`,
 *  `Grant.dynamicStats`, `GrantVariant.dynamicStats`. Same `min`/`max`/`default` shape as
 *  `BonusOccurrenceConfig` (a `default` is what makes an unset value read as something other
 *  than 0), just addressing a stat directly instead of a bonus's occurrence count. */
export interface DynamicStatConfig {
  stat: StatKey;
  min: number;
  max: number;
  default: number;
  /** Overrides the stat's own label for this one input, same convention
   *  `BonusOccurrenceConfig.label`/`InlineRepetitionConfig.label` already use. */
  label?: string;
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
 * parameter's `paramType`: `atLeast`/`below`/`exactly` for `number`/`percent` (half-open range,
 * same as `duration`'s, or a single exact match), `is` for `boolean`, `equals` for `list` (a
 * scalar or array -- an array means "is one of", same as `role`/`class`/`damageType`). */
export interface ParamCondition {
  key: string;
  atLeast?: number;
  below?: number;
  exactly?: number;
  is?: boolean;
  equals?: string | string[];
}

/** A `when` predicate (conditions.ts). Keys present are ANDed; an absent key is unconstrained.
 * Loose on leaf value types (`string | string[]`) because conditions.ts's `asArray` accepts
 * either uniformly. */
export interface ConditionWhen {
  /** A toggle's name, or several matched as "one of" -- the same join every list-taking leaf
   *  uses. Requiring more than one at once is spelled with `all`. */
  toggle?: string | string[];
  role?: string | string[];
  class?: string | string[];
  damageType?: string | string[];
  duration?: RangeLike;
  enemies?: RangeLike;
  /** How many total occurrences of `bonus` (usually this bonus's own id -- a "self-referential"
   *  attachment) are currently attached across every equipped item, tallied from each
   *  contributing item's `BonusOccurrenceConfig` (or 1 per bare-id attachment). A `min:0,max:1`
   *  attachment gating its own flat grant with `atLeast: 1` is a per-item on/off checkbox --
   *  what a dedicated `proc` leaf used to be, before it was folded into this same mechanism
   *  instead of keeping a second, less general one. Gating this way is redundant with the
   *  attachment's count itself for a plain flat grant (a 0-count attachment already contributes
   *  no candidate at all, so the grant is never reached either way) -- it's kept anyway so the
   *  bonus inspector's `gate.leaves` has something to explain, the same way `proc` always did. */
  bonusOccurrences?: RangeSpec & { bonus: string };
  equipped?: RangeSpec & { tag?: string; item?: string };
  param?: ParamCondition;
  all?: ConditionWhen[];
  any?: ConditionWhen[];
  not?: ConditionWhen;
}

export interface GrantVariant {
  when?: ConditionWhen;
  stats: StatValues;
  /** Same role as `Grant.dynamicStats`, scoped to this one variant's payload -- a different
   *  variant of the same grant may declare its own, unrelated set. */
  dynamicStats?: DynamicStatConfig[];
}

export interface GrantTier {
  /** `bonus` is technically optional on the type (mirroring `RangeSpec`'s shape) but a tier
   * omitting it always evaluates to 0 occurrences -- see conditions.ts's `bonusOccurrences`
   * leaf. */
  bonusOccurrences?: RangeSpec & { bonus?: string };
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
   * with a class or another equipped item. Consumers may still choose not to apply this (an
   * "ignore picker filters" toggle for what-if builds), so it's a request, not a guarantee. */
  hideFromPicker?: boolean;
}

/** Grants are not addressable by the engine -- only the owning `Bonus.id` is (stacking,
 * exclusion, everything else keys off that). `name` is display-only, for a bonus whose
 * several grants need distinguishing in the hover card (ItemCard.vue); leave it unset and
 * the card falls back to a label derived from the grant's own `when`.
 * `stats`/`tiers`/`variants`/`problem` are mutually exclusive payloads chosen at authoring
 * time (see bonus-draft.ts's `payload`); only one is ever set on a given grant. */
export interface Grant {
  name?: string;
  when?: ConditionWhen;
  stats?: StatValues;
  /** Player-typed magnitudes added into `stats` when this grant is active -- resolved from
   *  the first slot contributing to the bonus (bonus.ts's `resolve`, same "instancing slot"
   *  `EvaluatedBonus.slotId` already uses for stat attribution), stored under a bonus-id-
   *  qualified key so it can't collide with an item's own `dynamicStats` entry on that same
   *  slot. Applies only to the flat `stats` payload -- a grant using `variants`/`tiers`/
   *  `problem` instead declares its own per-branch dynamic stats where relevant
   *  (`GrantVariant.dynamicStats`). */
  dynamicStats?: DynamicStatConfig[];
  variants?: GrantVariant[];
  tiers?: GrantTier[];
  problem?: GrantProblem;
  /** Same as `Item.shortDescription`/`longDescription`, shown whenever this grant is
   * active -- next to its slot's stat summary and on that slot's hover card
   * respectively, alongside the item's own text. */
  shortDescription?: string;
  longDescription?: string;
}

export interface Bonus {
  id: string;
  name?: string;
  grants?: Grant[];
  excludes?: string[];
  stacking?: "perSource" | string;
  maxStacks?: number;
}

/** One item's contribution of one bonus -- db.ts's `bonusesFor`. */
export interface BonusCandidate {
  bonus: Bonus;
  bonusId: string;
  source: string;
}

// --- the db (db.ts's `build` return shape) --------------------------------------------------

export interface Db {
  items: Item[];
  schema: Schema;
  /** The slot list as everything downstream should read it: a `list` param's `optionsFrom` has
   * already been resolved into a concrete `options` array (db.ts's `build`), so no consumer
   * needs to know whether an option set was authored inline or derived. */
  slots: Slot[];
  /** The same list *before* that resolution. Anything that writes a slot back out reads this
   * instead: the editor's form (which must not turn derived options into inline ones on save),
   * `validateSlots` (whose `options` XOR `optionsFrom` rule only means anything pre-resolution)
   * and `referencedOverlay` (which would otherwise see every derived slot as differing from
   * base and embed a frozen copy of it into every download). */
  authoredSlots: Slot[];
  sections: SlotSection[];
  presets: SectionPreset[];
  slotById: Map<string, Slot>;
  bonuses: Bonus[];
  bonusById: Map<string, Bonus>;
  bonusMembers: Map<string, string[]>;
  itemsByTag: Map<string, string[]>;
  /** Game `Hitem` -> every catalogue item id claiming it, in catalogue order. Built from base
   *  catalogue + active overlay, so a layer can add mappings the shipped catalogue does not
   *  have. Usually one claimant, but one in-game item is modelled as several entries whenever
   *  its stats depend on where it is slotted -- an enchantment grants power in an offense slot,
   *  defense in a defense slot and forte in the utility slot, so all three entries claim the
   *  one `Hitem` the game records. Claimants must therefore differ by `filter`, which is what
   *  lets the importer tell them apart by the slot that accepts them (see demo-slots.ts);
   *  catalog.ts's validate rejects two claimants sharing a filter as genuinely ambiguous. */
  itemByGameId: Map<string, string[]>;
  duplicates: string[];
  /** Look up an item by the id given. Never forwards through `Item.replacedBy`. */
  get(id: string | null | undefined): Item | null;
  /** The item `id` would migrate to, or null. Drives the offer; never resolves a build. */
  replacementFor(id: string | null | undefined): Item | null;
  /** Values `id` carries forward when migrated, merged along the chain, later hops winning.
   * Consumed by `migrateItemIds`, the only place a seed lands. */
  replacementSeeds(id: string | null | undefined): StatValues;
  forFilter(filter: string): Item[];
  forSlot(slotId: string): Item[];
  /** `slotById.get`, extended to the row ids an `item_picker_list` expands into -- those exist
   * per build, so they are never in the map, but their id alone names the row. */
  slotFor(slotId: string): Slot | undefined;
  maxCopies(item: Item | null | undefined): number;
  bonusesFor(item: Item): BonusCandidate[];
}

// --- catalogue overlay (catalog.ts) ----------------------------------------------------------

export interface CatalogOverlay {
  items: Record<string, Item | null>;
  bonuses: Record<string, Bonus | null>;
  sectionPresets: Record<string, SectionPreset | null>;
  /** Build-parameter slots, same add/edit/tombstone shape as the three above. Only
   * `build_parameter` slots are authorable (SlotForm.vue) -- the other four `Slot` variants
   * carry layout structure (`section` membership, ordering, separators) that an overlay's
   * flat id->value map cannot express, so they stay base-only. Composed slots keep base's
   * declaration order with overlay-added ones appended per section; see `compose`. */
  slots: Record<string, Slot | null>;
}

export type CatalogGroup = "items" | "bonuses" | "sectionPresets" | "slots";

export interface LintFinding {
  level: "error" | "warn";
  message: string;
  name?: string;
  kind: "item" | "bonus" | "sectionPreset" | "slot";
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
  damageType: string;
  duration: number;
  enemies: number;
  magnitude: number;
  m32Forte: boolean;
  forte: ForteSplit;
  toggles: Record<string, boolean>;
  /** Collection-wide bolster, as decimal fractions (1.25 === 125%) -- what `Schema.statScalers`
   * multiplies the matching items' stat lines by. Character-wide values from the stable and
   * companion collection, not properties of the equipped mount/companion, which is why they are
   * context and not item fields. */
  mountBolster: number;
  companionBolster: number;
}

export interface BuildCompare {
  id: string;
  highlight: boolean;
  onlyDiff: boolean;
  /** Stat panel: stack the compare build's own number under each stat that differs from
   *  this one. Independent of `highlight`/`onlyDiff` above, which drive the editor's rows. */
  statLines: boolean;
}

export interface Build {
  id: string;
  name: string;
  choices: Record<string, string>;
  /** Every slot's typed `DynamicStatConfig` value(s), by slot id then a `dynamicValueKey`
   * (dynamic-stats.ts) -- an item's own entry keys by its stat alone, a grant/variant's by
   * its bonus id plus stat, so the two (and two different bonuses) can't collide on one slot.
   * A key absent here reads as that config's own `default` -- only explicit overrides a user
   * made are stored, same convention `occurrenceInputs` below uses. */
  values: Record<string, Record<string, number>>;
  /** Every inline-repetition count, by slot id then item id -- a `point_assignment` slot's
   * rows and an `item_picker` whose pick declares an `inlineRepetition`. One field for both,
   * since the stored fact is the same: "item X repeats N times at slot Y". A point_assignment
   * slot's rows are seeded up front (`defaultBuild`); an item_picker's cannot be (the pick
   * changes), so that one falls back to the config's own `default` on read. */
  assignments: Record<string, Record<string, number>>;
  /** Every item's typed `BonusOccurrenceConfig` count(s), by item id then bonus id -- keyed by
   * bonus id (not just item id) since one item may carry several such configs, each needing its
   * own count (see `Item.bonuses`). A key absent here reads as that config's own `default` --
   * only explicit overrides a user made are stored. */
  occurrenceInputs: Record<string, Record<string, number>>;
  /** Each `item_picker_list`'s row count, by container slot id. Stored rather than derived
   * from `choices` so a row left empty is still a row. Absent reads as `defaultRows`. */
  listRows: Record<string, number>;
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
  /** Full content as last downloaded or imported - decision 15. */
  downloaded?: { snapshot: LayerSnapshot; at: number };
}

export type LayerSnapshot = Omit<Layer, "downloaded">;

/** A named group of builds in the sidebar. Exactly one level deep -- a folder holds builds
 * and never another folder -- so `builds` is a plain id list rather than a tree of entries.
 * The folder's own position in the sidebar comes from `AppMeta.buildOrder`, not from this
 * array's order, so a folder is described in exactly one place. */
export interface BuildFolder {
  id: string;
  name: string;
  collapsed: boolean;
  /** Build ids inside, in display order. A build id appears in at most one folder. */
  builds: string[];
}

/** A build offered as a picker choice, outside the sidebar that shows the grouping. `folder`
 * is what keeps two same-named builds in different folders apart; absent for a build sitting
 * at the top level. `BuildComboBox.vue` renders these, in sidebar order -- which is what lets
 * it draw one heading per folder rather than repeating the name on every row. */
export interface BuildOption {
  value: string;
  label: string;
  folder?: string;
}

/** One row-group under the sidebar's Builds heading: a build sitting at the top level, or a
 * folder together with the builds it holds. What `NavBuilds.vue` renders. */
export type BuildNavEntry =
  | { kind: "build"; build: Build }
  | { kind: "folder"; folder: BuildFolder; builds: Build[] };

/** App-level state that belongs to no single item. */
export interface AppMeta {
  /** Top-level sidebar order under Builds: build ids and folder ids interleaved. A build id
   * claimed by a folder lives in that folder's `builds` instead of here. Data written before
   * folders existed is a list of build ids alone, which is already a valid value. */
  buildOrder: string[];
  folders: BuildFolder[];
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
  damageType?: string;
  duration: number;
  enemies: number;
  toggles: Record<string, boolean>;
  equipped: Map<string, number>;
  tags: Map<string, number>;
  bonusOccurrences: Map<string, number>;
  /** Friendly names for bonus IDs, so conditions can display "Gladiator's Guile"
   *  instead of "m31-gladiators-guile" in their labels. */
  bonusNames: Map<string, string>;
  /** Every `build_parameter`'s current value, keyed by its (context-relative) `path` -- what
   *  the `param` leaf reads. Built once by bonus.ts's `collect()`. */
  params: Map<string, string | number | boolean>;
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
  /** How many times this row's `item` is in the build: 1 for an ordinary pick, its
   * `inlineRepetition` count for one that repeats inline, 0 for a row with no item (a
   * `point_assignment` row included -- its per-item counts never collapse to one number).
   * `rowVectors`' stat sum and `findErrors`' maxCopies tally both multiply by it. */
  repetitions: number;
}

export interface GrantEvaluation {
  active: boolean;
  gate: ConditionExplain;
  stats: StatValues | null;
  chose: string | null;
  problem: GrantProblem | null;
  /** One `ConditionExplain` per entry of `raw.variants`, in order -- lets the hover card
   * show every branch (met or not), not just the one that won. Only populated when `explain`
   * is on and the grant actually carries `variants`. */
  variantBranches?: ConditionExplain[];
}

export interface BonusEvaluation {
  active: boolean;
  gate: ConditionExplain;
  stats: StatValues | null;
  chose: string | null;
  previewStats: StatValues | null;
  grants: (GrantEvaluation & { raw: Grant })[];
  /** Every active grant's `problem` payload, in grant order -- a bonus mixing stat and problem
   * grants reports both, same as it sums both grants' stats. */
  problems: GrantProblem[];
}

export interface EvaluatedBonus {
  id: string;
  bonus: Bonus;
  bonusId: string;
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
  /** Paths two equipped items published different values for -- see `Item.publishes`. Carried
   * out of `collect()` rather than reported there, so error surfacing stays in engine.ts with
   * every other build error. */
  publishConflicts: PublishConflict[];
  bonuses: EvaluatedBonus[];
  bonusStatsBySlot: Map<string, Map<StatKey, number>>;
  /** A `point_assignment` slot's own item stats (each row's item stats × its count, summed) --
   * the counterpart to `bonusStatsBySlot` for the item side rather than the bonus side, since
   * a `point_assignment` row has no single `ResolvedRow.item` to read stats off of. */
  assignmentStatsBySlot: Map<string, Map<StatKey, number>>;
}

/** One path with two equipped items asserting different values for it. */
export interface PublishConflict {
  path: string;
  /** Item id to the value it published, for every contributor -- at least two entries. */
  contributors: {
    itemId: string;
    slotId: string;
    value: string | number | boolean;
  }[];
}

export interface EngineError {
  slotId: string;
  kind:
    | "class"
    | "maxCopies"
    | "outOfRange"
    | "missing"
    | "bonusRule"
    | "publishConflict";
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
  /** Carried through from the row's `ResolvedRow`. `stats` above is already multiplied by it;
   * the count itself is here for the stages that need it (maxCopies, dynamic stats). */
  repetitions: number;
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
