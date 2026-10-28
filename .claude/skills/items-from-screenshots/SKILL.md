---
name: items-from-screenshots
description: Add Neverwinter items and their bonuses to data/db-items.json and data/db-bonuses.json from in-game tooltip screenshots. Use when the user shares item tooltip images and asks to create, add or model items, sets or equip bonuses.
---

# Items and bonuses from tooltip screenshots

Turn each tooltip into one entry in `data/db-items.json` plus any bonuses it carries in `data/db-bonuses.json`. Before writing, find 1–2 similar existing items (same slot, mod and role) and copy how they're modeled. Some older entries follow deprecated conventions (see "Legacy patterns" below), so follow this skill where they disagree.

## Core rules

- **Model as fully as possible.** Model every effect on the tooltip, including healer and tank lines, not just DPS ones.
- **Damage is additive.** Never assume a damage bonus is multiplicative; that is rare in game, and the user will say so when it is. Use `outgoing_damage`, never `outgoing_damage_mult` or `base_damage_mult`, unless told otherwise.
- **Only the version shown.** Add only the rarity and upgrade level in the screenshot. Don't invent other rarities or `+N` levels.
- **Ask when unsure.** Ask about anything the tooltip doesn't settle, rather than guessing.

## 1. Read the tooltip

Note down these fields for each tooltip:

| Tooltip part                                                               | Goes to                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Name, as shown (keep a trailing `+N`)                                      | `name`, prefixed with the mod: `M34 Ashen Hood of the Devourer +2` |
| Name color                                                                 | `quality`                                                          |
| `Item Level`                                                               | `il`                                                               |
| Stat lines (`+6,581 Accuracy`)                                             | rating keys on the item, using the tooltip number as shown         |
| `Combined Rating`                                                          | `combined_rating`                                                  |
| `Equip: ...`                                                               | a bonus                                                            |
| `Set X (n/m)` + `2 of Set` / `3 of Set`                                    | one shared set bonus                                               |
| `Requires Class: Warlock, Wizard`                                          | `allowedClass: ["warlock", "wizard"]` (lowercase)                  |
| Slot line (`Arms`, `Armor`, `Feet`, `Head`, `Weapon, Ranged`, `Implement`) | `filter`                                                           |
| Dev info `Def:` line                                                       | `gameIds: ["<Def value>"]`                                         |

- **Mod number:** read it from the `Def:` id (`Head_M33_..._Sss-tier` means M33). If there's no dev info and the user hasn't named the mod, ask; don't infer it from item level.
- **Never omit `gameIds`.** Without dev info, build the id as `<Slot>_M<nn>_<Role>_<Tier>`: role from the class groups table, tier from sibling items of the same mod and rarity (M34: legendary `R4`, mythic `R5`, celestial `R6`). Flag derived ids in the report.
- **Quality from the name color:** white `common`, green `uncommon`, blue `rare`, purple `epic`, orange `legendary`, cyan `mythic`, magenta `celestial`. OCR text doesn't carry the color, so read it from the image. If the color is unclear, use the rarity in the name or the `Def:` tier (M34: `R4` legendary, `R5` mythic, `R6` celestial), and say so in the report.
- **Copy the `Def:` value exactly.** Never guess the tier suffix: it varies by mod and rarity (`S-tier` in M31, `R4`/`R5`/`R6` in M34).
- **Game ID clashes:** before adding a game ID, grep `data/` for it. If another item already uses it, stop and ask, because the id was probably mistyped.
- **Ignore these parts:**
  - `Reinforced:` armor kits, which the player adds separately.
  - Armor `Modification:` slot text. Support for it comes later, like weapon modification slots.
  - Binding, flavor text, price and minimum level.
- **No class line:** if the tooltip has no `Requires Class`, leave out `allowedClass`.

### Class groups

Gear is usually limited to one of these class groups, which match the armor type and role in the game id. Write `allowedClass` in alphabetical order.

| Group         | `allowedClass`                          | Game id role |
| ------------- | --------------------------------------- | ------------ |
| Light DPS     | `["warlock", "wizard"]`                 | `Lightdps`   |
| Medium DPS    | `["bard", "cleric", "ranger", "rogue"]` | `Mediumdps`  |
| Medium DPS 1  | `["ranger", "rogue"]`                   | `Mediumdps1` |
| Medium DPS 2  | `["bard", "cleric"]`                    | `Mediumdps2` |
| Heavy DPS     | `["barbarian", "fighter"]`              | `Heavydps`   |
| Medium healer | `["bard", "warlock"]`                   | `Mediumheal` |
| Heavy healer  | `["cleric", "paladin"]`                 | `Heavyheal`  |
| Heavy tank    | `["barbarian", "fighter", "paladin"]`   | `Heavytank`  |

- **M34 Medium DPS split:** from M34, some Medium DPS items are split into Rogue/Ranger (`Mediumdps1`) and Cleric/Bard (`Mediumdps2`), while others stay on all four classes (`Mediumdps`). Always use the classes the tooltip lists, and pick the role from them.
- **Check the tooltip anyway:** the role in the game id suggests the group, but the `Requires Class` line wins. If they disagree, mention it in the report.
- **Single-class items:** some items are limited to a single class (class weapons such as `Primary_M32_Warlock_All_R6`).

### Slot filters

`gear_head`, `gear_armor` (body / Armor), `gear_arms`, `gear_boots` (Feet), `gear_pants`, `gear_shirt`, `gear_neck`, `gear_waist`, `gear_ring`, `gear_weapon_mainhand`, `gear_weapon_offhand`. Game id slot prefixes: `Head`, `Body`, `Arms`, `Feet`, `Pants`, `Shirt`, `Primary`, `Secondary`.

Artifact weapons also get `"tags": ["artifact:mainhand"]` or `["artifact:offhand"]`. Rarity variants put the rarity in the name and id: `M32 Omen of Doom (Celestial)`, `m32-omen-of-doom-celestial`.

### Stat keys

Ratings are plain numbers. Percents are fractions (`1.7%` → `0.017`). Full list: `data/schema.json`.

| Tooltip                                                                             | Item rating                                        | Percent key (in bonuses)                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Power                                                                               | `power`                                            | `power_p`                                                  |
| Accuracy                                                                            | `acc`                                              | `acc_p`                                                    |
| Combat Advantage                                                                    | `ca`                                               | `ca_p`                                                     |
| Critical Strike                                                                     | `strike`                                           | `strike_p`                                                 |
| Critical Severity                                                                   | `severity`                                         | `sev_p`                                                    |
| Forte                                                                               | `forte`                                            | `forte_p`                                                  |
| Defense / Awareness / Critical Avoidance / Deflect                                  | `defense` / `awareness` / `crit_avoid` / `deflect` | `defense_p` / `awareness_p` / `crit_avoid_p` / `deflect_p` |
| Damage (weapon)                                                                     | `base_damage_flat`                                 |                                                            |
| Action Points Gain                                                                  |                                                    | `ap_gain`                                                  |
| Recharge Speed                                                                      |                                                    | `recharge`                                                 |
| Movement Speed                                                                      |                                                    | `movement`                                                 |
| Base Damage Boost / Damage                                                          |                                                    | `outgoing_damage`                                          |
| Physical / Magical damage                                                           |                                                    | `physical_damage_boost` / `magical_damage_boost`           |
| Maximum Hit Points                                                                  |                                                    | `hit_points_p`; a loss uses `hit_points_mult`              |
| Divinity / Soulweave / Performance Regeneration                                     |                                                    | `mana_regen`                                               |
| Outgoing Healing                                                                    |                                                    | `out_healing_p`                                            |
| Overall Healing (also "Total Healing", "Overall Outgoing Healing", plain "Healing") |                                                    | `overall_healing`                                          |

- **Percent stat lines:** a plain percent line on the item itself (`+1.7% Recharge Speed`, `+1.5% Action Point Gain`) goes directly on the item as `recharge: 0.017` or `ap_gain: 0.015`.
- **"Physical and Magical damage":** set both keys.

## 2. Write the item

Keep the field order of the existing entries:

```json
{
  "id": "m34-ashen-hood-of-the-devourer-2",
  "name": "M34 Ashen Hood of the Devourer +2",
  "filter": "gear_head",
  "quality": "celestial",
  "il": 6750,
  "power": 3544,
  "acc": 6581,
  "combined_rating": 6075,
  "gameIds": ["Head_M34_Lightdps_R6"],
  "allowedClass": ["warlock", "wizard"],
  "bonuses": [
    "m34-ashen-hood-of-the-devourer-2",
    "m34-dps-celestial-ashen-vestments"
  ]
}
```

- **Ids:** kebab-case slug of the name (`'` becomes `-`, as in `m33-survivor-s-avoidance`; `+2` becomes `-2`), plus a rarity suffix where the name has one. Both JSON files are sorted by `id`, so insert at the right spot.
- **`shortDescription`:** use it for an effect the engine can't calculate yet. Always add one for maximum resource effects such as Max Divinity, Performance, Soulweave or Soul Sparks (e.g. `"shortDescription": "Max Divinity +25%"`). Resource regeneration is not text-only: it is `mana_regen`.

## 3. Write the bonuses

Pick the bonus shape:

- **Plain `Equip: +8.6% Accuracy`:** a per-item bonus named after the item.
- **Named equip (`Equip: Ruthless Advantage`):** a bonus named after the effect (`m29-ruthless-advantage`, `m33-reckless-advantage-celestial`). Grep for it first and reuse it if it exists; add a rarity suffix when values differ by rarity.
- **Set:** one bonus shared by every set piece, named after the set without a `-set` suffix (`m33-freezing-grasp`). Each `N of Set` line becomes a grant gated by `"bonusOccurrences": { "atLeast": N }`.
- **Set name shared across classes or categories:** when each class or class group has its own pieces under the same set name, check whether the set effects differ. Groups whose effects are identical share one bonus, as long as no class can wear pieces from two of those groups; the class restrictions keep the counts correct. Name the bonus after what the groups share: `M34 DPS Celestial Ashen Vestments` covers the Light, Medium and Heavy DPS pieces. Groups whose effects differ get one bonus each, with the class or group in the name (`M32 Cleric's Impending Doom (Celestial)`).

```json
{
  "id": "m34-dps-celestial-ashen-vestments",
  "name": "M34 DPS Celestial Ashen Vestments",
  "grants": [
    {
      "when": { "bonusOccurrences": { "atLeast": 2 } },
      "stats": { "strike_p": 0.04 }
    },
    {
      "when": { "bonusOccurrences": { "atLeast": 3 } },
      "stats": { "physical_damage_boost": 0.08, "magical_damage_boost": 0.08 }
    }
  ]
}
```

### Conditions

- **Combat gating:** add `"toggle": "combat"` when the effect says "in combat", or depends on something that happens in combat (when you hit, heal, are healed, take damage, are crit, etc.). A plain `Equip: +x%` with no such wording has no `when`.
- **Stacking buffs:** model them at max stacks with the "Max N stacks" values. For example, Reckless Advantage is `ca_p: 0.08, crit_avoid_p: -0.08`.
- **Build-up time:** if the stacks or charges build slowly, also gate on `"duration": { "atLeast": <seconds> }`, derived from how fast they build. See `m32-impending-doom-celestial`. How fast an effect stacks varies a lot, so ask the user when it's unclear.
- **Chance-based procs:** add a boolean input plus an optional `effectiveness` percent input used as `scale` (see `m31-bloodletting-ascendant`). Drawbacks such as "decrease your Max HP by 20%" go in a separate grant without the scale.
- **Role-split effects** (`DPS: ... / Heal: ...`): model every line with `variants` gated by `role` (`"dps"`, `"healer"`, `"tank"`). Grep `"role":` in `data/db-bonuses.json` for the shape.
- **Text-only effects:** put anything you can't model in the grant's `longDescription`, or the item's `shortDescription`.

For other condition leaves (`enemies`, `equipped`, `param`, `input`, `formula`, `all`/`any`/`not`), read `ConditionWhen` in `src/types.ts`, and find a precedent with grep in `data/db-bonuses.json`.

## Legacy patterns (don't copy)

These come from when the builder was a spreadsheet:

- **Stat-split id suffixes** such as `-acc-ca`, `-damage`, `-strike-sev`.
- **`-set` suffixes** on set bonus ids.
- **Unrounded ratings** such as `3149.685`. Use the tooltip number.
- **DPS-only models** of role-split effects, as in `m32-impending-doom-celestial`.

## 4. Check and report

1. Run `npm run fix`, `npm run test` and `npm run typecheck`. The catalog tests validate references and game ids.
2. Report a table of the items and their bonuses.
3. List every assumption: ambiguous stat mappings, combat gating, stacking speed, and anything skipped.
