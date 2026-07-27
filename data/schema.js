// Canonical stat definitions, caps and pipeline constants.
//
// HAND-WRITTEN AND AUTHORITATIVE. Reverse-engineered from `test-dev` rows 236-253; see
// llm/plans/0001-web-builder-implementation.md §1.3 for the derivation and §3 for the
// deviations from the sheet (each one is marked `FIX #n` below).
//
// The slot list is *not* here -- it is generated into data/slots.js from data/raw/slots.json,
// because 185 slots is too many to transcribe reliably by hand.

window.NW_SCHEMA = (function () {
  // --- stat kinds -----------------------------------------------------------------------
  //   flat     plain additive number (item level, hit points, ability scores)
  //   rating   additive; receives `combined_rating`; capped at IL + allowedOver
  //   percent  additive fraction (0.09 === 9%); may be capped
  //   mult     combines multiplicatively across sources: prod(1 + v) - 1
  //
  // `enemy` marks the opposing-side stats, which share the pipeline but are displayed apart.

  var STATS = [
    // identity / totals
    { key: 'il',              label: 'Item Level',        kind: 'flat', abbr: 'IL' },
    { key: 'combined_rating', label: 'Combined Rating',   kind: 'flat', abbr: 'CR' },

    // offensive percents (paired with the ratings below)
    { key: 'power_p',         label: 'Power',             kind: 'percent', rating: 'power' },
    { key: 'acc_p',           label: 'Accuracy',          kind: 'percent', rating: 'acc', abbr: 'Acc' },
    { key: 'ca_p',            label: 'Combat Advantage',  kind: 'percent', rating: 'ca', abbr: 'CA' },
    { key: 'strike_p',        label: 'Critical Strike',   kind: 'percent', rating: 'strike', abbr: 'C. Strike' },
    { key: 'sev_p',           label: 'Critical Severity', kind: 'percent', rating: 'severity', abbr: 'C. Sev.' },
    { key: 'forte_p',         label: 'Forte',             kind: 'percent', rating: 'forte' },

    // offensive ratings
    { key: 'power',           label: 'Power',             kind: 'rating' },
    { key: 'acc',             label: 'Accuracy',          kind: 'rating', abbr: 'Acc' },
    { key: 'ca',              label: 'Combat Advantage',  kind: 'rating', abbr: 'CA' },
    { key: 'strike',          label: 'Critical Strike',   kind: 'rating', abbr: 'C. Strike' },
    { key: 'severity',        label: 'Critical Severity', kind: 'rating', abbr: 'C. Sev.' },
    { key: 'forte',           label: 'Forte',             kind: 'rating' },

    // damage
    { key: 'flat_damage',            label: 'Flat Damage',            kind: 'flat' },
    { key: 'outgoing_damage',        label: 'Outgoing Damage',        kind: 'percent' },
    { key: 'mult_damage',            label: 'Mult Damage',            kind: 'mult' },
    { key: 'overall_damage',         label: 'Overall Damage',         kind: 'percent' },
    { key: 'magical_damage_boost',   label: 'Magical Damage',         kind: 'percent' },
    { key: 'physical_damage_boost',  label: 'Physical Damage',        kind: 'percent' },
    { key: 'incoming_damage',        label: 'Incoming Damage',        kind: 'mult' },

    // hit points
    { key: 'hit_points_p',    label: 'HP Bonus',          kind: 'percent' },
    { key: 'mult_hit_points', label: 'HP Multiplier',     kind: 'mult' },
    { key: 'hit_points',      label: 'Hit Points',        kind: 'flat' },

    // defensive percents
    { key: 'defense_p',       label: 'Defense',            kind: 'percent', rating: 'defense' },
    { key: 'awareness_p',     label: 'Awareness',          kind: 'percent', rating: 'awareness' },
    { key: 'crit_avoid_p',    label: 'Critical Avoidance', kind: 'percent', rating: 'crit_avoid' },
    { key: 'deflect_p',       label: 'Deflect',            kind: 'percent', rating: 'deflect' },
    { key: 'deflect_sev_p',   label: 'Deflect Severity',   kind: 'percent', rating: 'deflect_sev' },
    { key: 'inc_healing_p',   label: 'Incoming Healing',   kind: 'percent', rating: 'inc_healing' },
    { key: 'out_healing_p',   label: 'Outgoing Healing',   kind: 'percent', rating: 'out_healing' },

    // defensive ratings
    { key: 'defense',         label: 'Defense',            kind: 'rating' },
    { key: 'awareness',       label: 'Awareness',          kind: 'rating' },
    { key: 'crit_avoid',      label: 'Critical Avoidance', kind: 'rating' },
    { key: 'deflect',         label: 'Deflect',            kind: 'rating' },
    { key: 'deflect_sev',     label: 'Deflect Severity',   kind: 'rating' },
    { key: 'inc_healing',     label: 'Incoming Healing',   kind: 'rating' },
    { key: 'out_healing',     label: 'Outgoing Healing',   kind: 'rating' },
    { key: 'overall_healing', label: 'Overall Healing',    kind: 'percent' },

    // utility percents
    { key: 'ap_gain',         label: 'AP Gain',           kind: 'percent' },
    { key: 'recharge',        label: 'Recharge',          kind: 'percent' },
    { key: 'movement',        label: 'Movement',          kind: 'percent' },
    { key: 'mana_regen',      label: 'Mana Regen',        kind: 'percent' },
    { key: 'stamina_regen',   label: 'Stamina Regen',     kind: 'percent' },

    // control -- FIX #3: `control_resist` / `control_resist_p` exist in the build sheet but had
    // no db-items columns, so no item could ever grant them. They are first-class stats here.
    { key: 'control_bonus_p',  label: 'Control Bonus',  kind: 'percent', rating: 'control_bonus' },
    { key: 'control_bonus',    label: 'Control Bonus',  kind: 'rating' },
    { key: 'control_resist_p', label: 'Control Resist', kind: 'percent', rating: 'control_resist' },
    { key: 'control_resist',   label: 'Control Resist', kind: 'rating' },

    // ability scores
    { key: 'str', label: 'Strength',     kind: 'flat', ability: true },
    { key: 'con', label: 'Constitution', kind: 'flat', ability: true },
    { key: 'dex', label: 'Dexterity',    kind: 'flat', ability: true },
    { key: 'int', label: 'Intelligence', kind: 'flat', ability: true },
    { key: 'wis', label: 'Wisdom',       kind: 'flat', ability: true },
    { key: 'cha', label: 'Charisma',     kind: 'flat', ability: true },

    // Enemy side. The labels carry the word "Enemy" because they are shown far from the
    // enemy table -- in item cards, bonus payloads and item previews -- where `Accuracy`
    // is indistinguishable from the player's `acc_p`. The stat panel's enemy table strips
    // the prefix back off, since its own heading already says it.
    { key: 'enemy_accuracy',       label: 'Enemy Accuracy',           kind: 'percent', enemy: true },
    { key: 'enemy_ca',             label: 'Enemy Combat Advantage',   kind: 'percent', enemy: true },
    { key: 'enemy_strike',         label: 'Enemy Critical Strike',    kind: 'percent', enemy: true },
    { key: 'enemy_severity',       label: 'Enemy Critical Severity',  kind: 'percent', enemy: true },
    { key: 'enemy_incoming_damage', label: 'Enemy Incoming Damage',   kind: 'percent', enemy: true },
    { key: 'enemy_defense',        label: 'Enemy Defense',            kind: 'percent', enemy: true },
    { key: 'enemy_awareness',      label: 'Enemy Awareness',          kind: 'percent', enemy: true },
    { key: 'enemy_crit_avoid',     label: 'Enemy Critical Avoidance', kind: 'percent', enemy: true },
    { key: 'enemy_deflect',        label: 'Enemy Deflect',            kind: 'percent', enemy: true },
    { key: 'enemy_deflect_sev',    label: 'Enemy Deflect Severity',   kind: 'percent', enemy: true },
    { key: 'enemy_incoming_damage_magical',  label: 'Enemy Incoming Magical',  kind: 'percent', enemy: true },
    { key: 'enemy_incoming_damage_physical', label: 'Enemy Incoming Physical', kind: 'percent', enemy: true },
    { key: 'enemy_outgoing_damage',          label: 'Enemy Outgoing Damage',   kind: 'percent', enemy: true },

    // currency
    { key: 'gold',  label: 'Gold',  kind: 'percent' },
    { key: 'glory', label: 'Glory', kind: 'percent' }
  ];
  // NOTE the sheet's `dmg_enchant` column is absent -- FIX #4: it mapped to no db-items column
  // and always resolved to 0.

  // --- rating -> percent conversion (pipeline rows 241-243, caps row 251) ----------------
  // pct += capPct - max(IL + allowedOver - ratingTotal, 0) / 100000
  // ratingCap = IL + allowedOver
  var RATING_CONVERSION = [
    { percent: 'power_p',         rating: 'power',        capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'acc_p',           rating: 'acc',          capPct: 0.50, allowedOver: 0,     pctCap: 0.90 },
    { percent: 'ca_p',            rating: 'ca',           capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'strike_p',        rating: 'strike',       capPct: 0.50, allowedOver: 0,     pctCap: 0.90 },
    { percent: 'sev_p',           rating: 'severity',     capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'forte_p',         rating: 'forte',        capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'defense_p',       rating: 'defense',      capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'awareness_p',     rating: 'awareness',    capPct: 0.50, allowedOver: 0,     pctCap: 0.90 },
    { percent: 'crit_avoid_p',    rating: 'crit_avoid',   capPct: 0.50, allowedOver: 0,     pctCap: 0.90 },
    { percent: 'deflect_p',       rating: 'deflect',      capPct: 0.50, allowedOver: 0,     pctCap: 0.90 },
    { percent: 'deflect_sev_p',   rating: 'deflect_sev',  capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'inc_healing_p',   rating: 'inc_healing',  capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'out_healing_p',   rating: 'out_healing',  capPct: 0.60, allowedOver: 10000, pctCap: 1.20 },
    { percent: 'control_bonus_p', rating: 'control_bonus', capPct: 0.50, allowedOver: 0,    pctCap: 0.90 },
    { percent: 'control_resist_p', rating: 'control_resist', capPct: 0.50, allowedOver: 0,  pctCap: 0.90 }
  ];

  // --- ability score contributions (pipeline row 245) ------------------------------------
  // `divisor` is the sheet's literal divisor. FIX #5: `mult_hit_points` was merged with an
  // algebraic hack because the row was additive; here con/200 is simply another `mult` factor.
  var ABILITY_CONTRIBUTIONS = [
    { ability: 'dex', stat: 'sev_p',                divisor: 200 },
    { ability: 'cha', stat: 'forte_p',              divisor: 200 },
    { ability: 'int', stat: 'magical_damage_boost', divisor: 400 },
    { ability: 'str', stat: 'physical_damage_boost', divisor: 400 },
    { ability: 'wis', stat: 'out_healing_p',        divisor: 400 },
    { ability: 'con', stat: 'ap_gain',              divisor: 400 },
    { ability: 'cha', stat: 'recharge',             divisor: 400 },
    { ability: 'dex', stat: 'movement',             divisor: 400 },
    { ability: 'str', stat: 'stamina_regen',        divisor: 200 },
    { ability: 'int', stat: 'control_bonus_p',      divisor: 200 },
    { ability: 'wis', stat: 'control_resist_p',     divisor: 200 },
    { ability: 'con', stat: 'mult_hit_points',      divisor: 200 }
  ];

  // --- forte redistribution (pipeline rows 247-249) --------------------------------------
  // The chosen primary forte stat receives forte_p/2; each secondary receives forte_p/4.
  var FORTE_SPLIT = { primary: 2, secondaryA: 4, secondaryB: 4 };

  // --- role ------------------------------------------------------------------------------
  var ROLES = {
    dps:    { label: 'DPS',    hpBonus: 1.0, damageBonus: 1.2 },
    healer: { label: 'Healer', hpBonus: 1.1, damageBonus: 1.1 },
    tank:   { label: 'Tank',   hpBonus: 1.2, damageBonus: 1.0 }
  };

  // --- build context ---------------------------------------------------------------------
  // These replace the sheet's pseudo-item option rows entirely (plan §2.1).
  var CONTEXT = {
    classes: ['barbarian', 'bard', 'cleric', 'fighter', 'paladin', 'ranger', 'rogue',
              'warlock', 'wizard'],
    roles: ['dps', 'healer', 'tank'],
    combatTypes: ['single', 'aoe', 'mixed'],
    locations: ['generic', 'thay', 'wildspace'],
    damageTypes: ['magical', 'physical'],
    toggles: ['combat', 'party', 'consumables', 'procs', 'artifactCall'],
    // Duration is a free number of seconds (plan §2.1). These are only UI presets.
    durationPresets: [0, 10, 30, 60],
    defaults: {
      class: 'warlock', role: 'dps', combatType: 'single', duration: 60,
      location: 'generic', damageType: 'magical', magnitude: 4332, m32Forte: true,
      toggles: { combat: true, party: true, consumables: true, procs: true, artifactCall: true }
    }
  };

  // --- derived indexes -------------------------------------------------------------------
  var byKey = {};
  STATS.forEach(function (s) { byKey[s.key] = s; });

  return {
    stats: STATS,
    statByKey: byKey,
    statKeys: STATS.map(function (s) { return s.key; }),
    multiplicativeStats: STATS.filter(function (s) { return s.kind === 'mult'; })
                              .map(function (s) { return s.key; }),
    ratingStats: STATS.filter(function (s) { return s.kind === 'rating'; })
                      .map(function (s) { return s.key; }),
    abilityStats: STATS.filter(function (s) { return s.ability; })
                       .map(function (s) { return s.key; }),
    ratingConversion: RATING_CONVERSION,
    abilityContributions: ABILITY_CONTRIBUTIONS,
    forteSplit: FORTE_SPLIT,
    roles: ROLES,
    context: CONTEXT
  };
})();
