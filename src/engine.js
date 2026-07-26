// The calculation pipeline (plan §1.3) and derived outputs (§1.4).
//
// Every intermediate stage is kept, which is what makes the "why is my Power that number?"
// inspector possible -- something the spreadsheet cannot do.
//
// Deviations from the sheet are marked `FIX #n` and justified in plan Part 3. None changes a
// number on current data except where the sheet was demonstrably wrong.

window.NW = window.NW ?? {};
window.NW.engine = (() => {
  'use strict';

  const zeros = (keys) => {
    const out = {};
    for (const key of keys) out[key] = 0;
    return out;
  };

  const addVectors = (a, b, keys) => {
    const out = {};
    for (const key of keys) out[key] = (a[key] ?? 0) + (b[key] ?? 0);
    return out;
  };

  const averageByChance = (multiplier, chance) => chance * multiplier + (1 - chance);

  /**
   * Per-slot stat vectors: the item's own stats plus the bonuses attributed to that slot.
   * Kept as rows because multiplicative stats combine per row, not per source.
   */
  function rowVectors(resolved, keys) {
    return resolved.rows.map((row) => {
      const stats = zeros(keys);
      if (row.item) {
        for (const key of keys) {
          if (row.item[key]) stats[key] = row.item[key];
        }
      }
      const bonusStats = resolved.bonusStatsBySlot.get(row.slotId);
      if (bonusStats) {
        for (const [key, value] of bonusStats) stats[key] = (stats[key] ?? 0) + value;
      }
      return { slotId: row.slotId, choice: row.choice, item: row.item, stats };
    });
  }

  function run(db, build, resolved) {
    const { schema } = db;
    const keys = schema.statKeys;
    const context = build.context ?? {};
    const multiplicative = new Set(schema.multiplicativeStats);
    const rows = rowVectors(resolved, keys);

    // --- stage 1: initial sums -----------------------------------------------------------
    const sums = zeros(keys);
    const products = new Map(schema.multiplicativeStats.map((key) => [key, 1]));

    for (const row of rows) {
      for (const key of keys) {
        const value = row.stats[key] ?? 0;
        if (multiplicative.has(key)) products.set(key, products.get(key) * (1 + value));
        else sums[key] += value;
      }
    }
    for (const [key, product] of products) sums[key] = product - 1;

    // --- stage 2: dynamic weapon modification --------------------------------------------
    // FIX #6: the sheet matched the target stat by searching the item's *display name*. The
    // item now declares `dynamicStat` outright, so renaming one cannot silently move the value.
    const weaponMods = zeros(keys);
    for (const row of rows) {
      const stat = row.item?.dynamicStat;
      if (!stat) continue;
      const typed = build.values?.[row.slotId];
      if (typed == null || typed === '') continue;
      let value = Number(typed) || 0;
      if (row.item.dynamicMin != null) value = Math.max(value, row.item.dynamicMin);
      if (row.item.dynamicMax != null) value = Math.min(value, row.item.dynamicMax);
      weaponMods[stat] += value;
    }
    const afterWeaponMods = addVectors(sums, weaponMods, keys);

    // --- stage 3: combined rating --------------------------------------------------------
    const afterCombinedRating = { ...afterWeaponMods };
    for (const key of schema.ratingStats) {
      afterCombinedRating[key] += sums.combined_rating;
    }

    // --- stage 4: rating -> percent ------------------------------------------------------
    const itemLevel = afterCombinedRating.il;
    const ratingPct = zeros(keys);
    for (const rule of schema.ratingConversion) {
      const shortfall = Math.max(
        itemLevel + rule.allowedOver - afterCombinedRating[rule.rating], 0,
      );
      ratingPct[rule.percent] = rule.capPct - shortfall / 100000;
    }
    const afterRatingPct = addVectors(afterCombinedRating, ratingPct, keys);

    // --- stage 5: ability scores ---------------------------------------------------------
    // FIX #5: `mult_hit_points` is a multiplicative stat, so con/200 is simply another factor
    // rather than the sheet's `(1+cur)*(1+con/200)-1-cur` hack. Algebraically identical.
    const abilities = zeros(keys);
    for (const rule of schema.abilityContributions) {
      abilities[rule.stat] += afterRatingPct[rule.ability] / rule.divisor;
    }
    const afterAbilityScores = {};
    for (const key of keys) {
      afterAbilityScores[key] = multiplicative.has(key)
        ? (1 + afterRatingPct[key]) * (1 + abilities[key]) - 1
        : afterRatingPct[key] + abilities[key];
    }

    // --- stage 6: forte redistribution ---------------------------------------------------
    const forte = zeros(keys);
    const fortePool = afterAbilityScores.forte_p;
    const picks = context.forte ?? {};
    for (const [slot, divisor] of Object.entries(schema.forteSplit)) {
      const stat = picks[slot];
      if (stat && forte[stat] !== undefined) forte[stat] += fortePool / divisor;
    }
    if (context.m32Forte) {
      for (const stat of Object.keys(forte)) {
        forte[stat] = Math.round(forte[stat] * 100) / 100;
      }
    }
    const totals = addVectors(afterAbilityScores, forte, keys);

    // --- stage 7: caps -------------------------------------------------------------------
    // FIX #2: `overcap` is now non-negative and `headroom` is its own field, instead of the
    // sheet's single signed number that meant two different things depending on its sign.
    const caps = zeros(keys);
    for (const rule of schema.ratingConversion) {
      caps[rule.rating] = totals.il + rule.allowedOver;
      caps[rule.percent] = rule.pctCap;
    }
    const capped = zeros(keys);
    const overcap = zeros(keys);
    const headroom = zeros(keys);
    for (const key of keys) {
      const cap = caps[key];
      if (cap > 0) {
        capped[key] = Math.min(totals[key], cap);
        overcap[key] = Math.max(totals[key] - cap, 0);
        headroom[key] = Math.max(cap - totals[key], 0);
      } else {
        capped[key] = totals[key];
      }
    }

    return {
      rows,
      stages: {
        sums, weaponMods, afterWeaponMods, afterCombinedRating, ratingPct,
        afterRatingPct, abilities, afterAbilityScores, forte,
        afterForte: totals, totals, caps, capped, overcap, headroom,
      },
    };
  }

  // --- derived outputs (plan §1.4) --------------------------------------------------------

  function derive(db, build, stages) {
    const { schema } = db;
    const context = build.context ?? {};
    const { capped, totals } = stages;
    const role = schema.roles[context.role] ?? schema.roles.dps;
    const magnitude = Number(context.magnitude) || 0;
    const magical = context.damageType !== 'physical';

    const itemLevel = totals.il;
    const hp = (itemLevel * 10 + capped.hit_points)
      * role.hpBonus
      * (1 + capped.hit_points_p)
      * (1 + capped.mult_hit_points);

    // FIX #1: reads the capped stage like every other derived value. `flat_damage` has no cap
    // and no later stage touches it, so this is a no-op today -- but it removes a trap where a
    // future bonus feeding `flat_damage` through a later stage would be silently dropped.
    const baseDamage = capped.flat_damage + (itemLevel / 10) * role.damageBonus;

    const effMagPhys = magical ? capped.magical_damage_boost : capped.physical_damage_boost;
    const enemyEff = magical
      ? capped.enemy_incoming_damage_magical
      : capped.enemy_incoming_damage_physical;
    const overallOgh = capped.out_healing_p + capped.overall_healing;

    const damage = (critChance, deflectChance) => {
      const critMult = 1 + capped.sev_p - capped.enemy_crit_avoid;
      const deflectMult = 1 / (1 + capped.enemy_deflect_sev - capped.acc_p);
      const other = (1 + effMagPhys) * (1 + enemyEff)
        * (1 + capped.outgoing_damage)
        * (1 + capped.enemy_incoming_damage)
        * (1 + capped.mult_damage);
      const value = baseDamage
        * (magnitude / 100)
        * (1 + capped.power_p)
        * averageByChance(critMult, critChance)
        * (1 + capped.ca_p - capped.enemy_awareness)
        * (1 / (1 + capped.enemy_defense))
        * averageByChance(deflectMult, deflectChance)
        * other;
      return value * (1 / (1 - capped.overall_damage));
    };

    const healing = (critChance) => baseDamage
      * (magnitude / 100)
      * (1 + capped.power_p)
      * averageByChance(1 + capped.sev_p / 2, critChance)
      * (1 + overallOgh);

    const ehp = (critChance, deflectChance) => {
      const critMult = 1 + capped.enemy_severity - capped.crit_avoid_p;
      const deflectMult = 1 / (1 + capped.deflect_sev_p - capped.enemy_accuracy);
      const finalMult = (1 / (1 + capped.defense_p))
        * (1 + capped.enemy_ca - capped.awareness_p)
        * averageByChance(critMult, critChance)
        * averageByChance(deflectMult, deflectChance)
        * (1 + capped.enemy_outgoing_damage)
        * (1 + capped.incoming_damage);
      return hp / finalMult;
    };

    return {
      itemLevel,
      hp,
      baseDamage,
      effectiveMagPhys: effMagPhys,
      overallHealing: overallOgh,
      damage: {
        average: damage(capped.strike_p, capped.enemy_deflect),
        critNoDeflect: damage(1, 0),
        critDeflect: damage(1, 1),
        noCritNoDeflect: damage(0, 0),
        noCritDeflect: damage(0, 1),
      },
      healing: {
        average: healing(capped.strike_p),
        crit: healing(1),
        noCrit: healing(0),
      },
      ehp: {
        average: ehp(capped.enemy_strike, capped.deflect_p),
        critNoDeflect: ehp(1, 0),
      },
    };
  }

  // --- validation (plan §1.6) -------------------------------------------------------------

  function findErrors(db, build, resolved) {
    const errors = [];
    const context = build.context ?? {};
    const counts = new Map();

    for (const row of resolved.rows) {
      if (row.item) counts.set(row.item.name, (counts.get(row.item.name) ?? 0) + 1);
    }

    for (const row of resolved.rows) {
      if (!row.item) continue;
      const allowed = row.item.allowedClass;
      if (allowed && !allowed.includes(context.class)) {
        errors.push({
          slotId: row.slotId, kind: 'class', choice: row.item.name,
          message: `${row.item.name} requires ${allowed.join(' or ')}`,
        });
      }
      const max = db.maxCopies(row.item);
      const used = counts.get(row.item.name);
      if (max && used > max) {
        errors.push({
          slotId: row.slotId, kind: 'maxCopies', choice: row.item.name,
          message: `${row.item.name} is equipped ${used} times, maximum ${max}`,
        });
      }
    }
    return errors;
  }

  // --- entry point --------------------------------------------------------------------------

  function resolveBuild(db, build, options) {
    const resolved = window.NW.bonus.resolve(db, build, options);
    const { rows, stages } = run(db, build, resolved);
    return {
      context: resolved.ctx,
      rows,
      bonuses: resolved.bonuses,
      stages,
      derived: derive(db, build, stages),
      errors: findErrors(db, build, resolved),
    };
  }

  return { resolveBuild, averageByChance };
})();
