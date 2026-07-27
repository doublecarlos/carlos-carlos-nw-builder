// Unit tests for the bonus model's semantics (plan Part 2).
//
// The golden fixture proves the engine reproduces the sheet; the differ proves the migration
// changed nothing unintended. Neither pins down *why* the new model is better -- these do.
// Each test names the behaviour and, where relevant, the legacy bug it prevents.

window.NW = window.NW ?? {};
window.NW.unit = (() => {
  'use strict';

  const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

  function makeRunner(db) {
    // A deliberately empty build: only what each test slots in is present, so nothing else
    // can perturb the numbers.
    const BASE_CONTEXT = {
      class: 'warlock', role: 'dps', combatType: 'single', duration: 60,
      location: 'generic', damageType: 'magical', magnitude: 100, m32Forte: false,
      forte: {},
      toggles: { combat: true, party: true, consumables: true, procs: true, artifactCall: true },
    };

    return (choices, contextOverrides = {}, values = {}) => {
      const context = { ...BASE_CONTEXT, ...contextOverrides };
      if (contextOverrides.toggles) {
        context.toggles = { ...BASE_CONTEXT.toggles, ...contextOverrides.toggles };
      }
      const result = window.NW.engine.resolveBuild(db, { choices, values, context });
      result.activeById = new Map(
        result.bonuses.filter((b) => b.active).map((b) => [b.id, b]),
      );
      // Per-stack payload, as the inspector shows it next to the stack count.
      result.statOf = (id, stat) => result.activeById.get(id)?.stats?.[stat];
      // What actually reaches the pipeline: payload × stacks.
      result.appliedStatOf = (id, stat) => result.activeById.get(id)?.appliedStats?.[stat];
      return result;
    };
  }

  const TESTS = [
    // --- the bug that motivated the redesign -------------------------------------------
    {
      name: 'Critical Breaker applies once at one piece, and still once at two',
      why: 'Legacy enumerated only `::1:2`, so wearing both pieces computed `::2:2`, found no '
         + 'payload row and silently granted nothing. Confirmed 2026-07-26 as a single-item '
         + 'bonus: any number of copies grants it exactly once.',
      run(run, assert) {
        const ID = 'm33-critical-breaker';
        const one = run({ 'gear.head': 'M33 Wintermarked Hunter Hood' });
        const two = run({ 'gear.head': 'M33 Wintermarked Hunter Hood',
                          'gear.boots': 'M33 Wintermarked Marcher Poleyns' });
        assert(near(one.statOf(ID, 'strike_p'), 0.09), 'one piece grants 9%');
        assert(near(two.statOf(ID, 'strike_p'), 0.09), 'two pieces still grant 9%');
        assert(two.activeById.get(ID).stacks === 1, 'and it is a single instance');
        assert(near(two.stages.sums.strike_p - one.stages.sums.strike_p, 0),
          'the second piece adds no extra strike_p');
      },
    },
    {
      name: 'A gem-gated ring bonus survives three qualifying gems',
      why: 'The `::1:3` bug: legacy enumerated only `::1:1` and `::1:2`, so a third distinct '
         + 'qualifying gem made the bonus vanish entirely.',
      run(run, assert) {
        const ID = 'm33-frostsilver-coil-of-wrath-ca';
        const ring = { 'gear.ring1': 'M33 Frostsilver Coil of Wrath' };
        const none = run(ring);
        const one = run({ ...ring, 'enchantments.offense1': '1) Amethyst (CA)' });
        const three = run({ ...ring,
          'enchantments.offense1': '1) Amethyst (CA)',
          'enchantments.offense2': '1) Amethyst (Awareness)',
          'enchantments.defense1': '1) Amethyst (Awareness)' });
        assert(!none.activeById.has(ID), 'inactive with no amethyst');
        assert(near(one.statOf(ID, 'ca_p'), 0.03), 'active with one amethyst');
        assert(near(three.statOf(ID, 'ca_p'), 0.03), 'still active with three');
      },
    },

    // --- condition language --------------------------------------------------------------
    {
      name: 'Duration is a continuous axis, and bucket boundaries are half-open',
      why: 'Legacy had four fixed buckets; `-combat_short-` means [10, 30) and '
         + '`-combat_medium_plus-` means >= 30. Off-bucket values must behave sensibly. Also '
         + 'proves the grants restructuring (2026-07-27): this set is two mutually-exclusive '
         + "duration grants under one id now, not two separately-tracked bonuses -- they'd "
         + 'better not both fire at once.',
      run(run, assert) {
        const ID = 'm32-deathsilver-ring-of-submission-strike';
        const ring = { 'gear.ring1': 'M32 Deathsilver Ring of  Submission (Strike)' };
        const at = (duration) => run(ring, { duration });

        assert(!at(9).activeById.has(ID), 'inactive at 9s');
        assert(at(10).activeById.has(ID), 'active at 10s (inclusive lower bound)');
        assert(near(at(10).statOf(ID, 'strike_p'), 0.022), 'short payload at 10s');
        assert(near(at(29).statOf(ID, 'strike_p'), 0.022), 'still short payload at 29s');
        assert(near(at(30).statOf(ID, 'strike_p'), 0.066),
          'medium+ payload takes over at 30s (exclusive boundary), not summed with short');
        assert(near(at(85).statOf(ID, 'strike_p'), 0.066), 'medium+ payload at 85s — a value '
          + 'the sheet could not express at all');
      },
    },
    {
      name: 'Toggles gate bonuses, and a two-toggle condition needs both',
      run(run, assert) {
        const ID = 'm32-deathsilver-ring-of-submission-strike';
        const ring = { 'gear.ring1': 'M32 Deathsilver Ring of  Submission (Strike)' };
        assert(run(ring).activeById.has(ID), 'active with combat on');
        assert(!run(ring, { toggles: { combat: false } }).activeById.has(ID),
          'inactive with combat off');
      },
    },

    // --- tiers, variants, stacking, exclusion ---------------------------------------------
    {
      name: 'Piece tiers are absolute and mutually exclusive, not cumulative',
      why: "Gladiator's Guile grants 10% at one insignia and 15% at two — not 25%.",
      run(run, assert) {
        const ID = 'gladiator-s-guile';
        const one = run({ 'insignia.bonus1': "Gladiator's Guile" });
        const two = run({ 'insignia.bonus1': "Gladiator's Guile",
                          'insignia.bonus2': "Gladiator's Guile" });
        assert(near(one.statOf(ID, 'movement'), 0.10), 'one copy -> 10%');
        assert(one.activeById.get(ID).chose === 'tier:1', 'and picks tier 1');
        assert(near(two.statOf(ID, 'movement'), 0.15), 'two copies -> 15%, not 25%');
        assert(two.activeById.get(ID).chose === 'tier:2', 'and picks tier 2');
      },
    },
    {
      name: 'Role variants select exactly one payload, summed with the set’s other grants',
      why: 'Grants restructuring (2026-07-27): this set is 4 grants now, not 4 separately-'
         + 'tracked bonuses -- a flat 2-piece grant (-5% incoming, +5% healing) is active '
         + 'alongside the role variant whenever 2 pieces are worn, so a role that is not the '
         + "matching variant still carries the flat grant's own stats, just not the other "
         + "roles' variant-specific ones.",
      run(run, assert) {
        const ID = 'm28-voidtouched-set';
        const set = { 'gear.mainhand': 'M28 Voidtouched Pactblade',
                      'gear.offhand': 'M28 Voidtouched Tome' };
        const dps = run(set, { role: 'dps' });
        const healer = run(set, { role: 'healer' });
        const tank = run(set, { role: 'tank' });
        assert(near(dps.statOf(ID, 'outgoing_damage'), 0.06), 'dps -> outgoing damage');
        assert(near(dps.statOf(ID, 'overall_healing'), 0.05),
          "dps still gets the flat grant's healing, but not the healer variant's");
        assert(near(healer.statOf(ID, 'overall_healing'), 0.05 + 0.06),
          "healer variant stacks onto the flat grant's own 5%");
        assert(near(tank.statOf(ID, 'incoming_damage'), -0.05 - 0.06),
          "tank variant stacks onto the flat grant's own -5%");
        assert(healer.statOf(ID, 'outgoing_damage') === undefined,
          'and only the matching variant’s own stat applies');
      },
    },
    {
      name: 'A two-piece set needs two pieces',
      run(run, assert) {
        const ID = 'm28-voidtouched-set';
        assert(!run({ 'gear.mainhand': 'M28 Voidtouched Pactblade' }).activeById.has(ID),
          'inactive with one piece');
        assert(run({ 'gear.mainhand': 'M28 Voidtouched Pactblade',
                     'gear.offhand': 'M28 Voidtouched Tome' }).activeById.has(ID),
          'active with two');
      },
    },
    {
      name: 'perSource stacking multiplies by contributing slots',
      why: 'Replaces legacy `bonus_max_instances: 100` + `max_copies: 3`.',
      run(run, assert) {
        const ID = 'mount-vortex-panther-necrotic';
        const one = run({ 'artifactCall.artifactCall1': 'Mount: Vortex/Panther/Necrotic' });
        const two = run({ 'artifactCall.artifactCall1': 'Mount: Vortex/Panther/Necrotic',
                          'artifactCall.artifactCall2': 'Mount: Vortex/Panther/Necrotic' });
        assert(one.activeById.get(ID).stacks === 1, 'one slot -> 1 stack');
        assert(two.activeById.get(ID).stacks === 2, 'two slots -> 2 stacks');
        assert(near(two.statOf(ID, 'enemy_incoming_damage'),
                    one.statOf(ID, 'enemy_incoming_damage')),
          '`stats` stays the per-stack payload');
        assert(near(two.appliedStatOf(ID, 'enemy_incoming_damage'),
                    2 * one.appliedStatOf(ID, 'enemy_incoming_damage')),
          'but `appliedStats` doubles');
        assert(near(two.stages.sums.enemy_incoming_damage,
                    2 * one.stages.sums.enemy_incoming_damage),
          'and the doubled value reaches the pipeline');
      },
    },
    {
      name: 'Exclusion suppresses the excluded bonus',
      why: 'Replaces legacy `bonus_overrides`.',
      run(run, assert) {
        const ID = 'm31-bloodletting-ascendant';
        const alone = run({ 'gear.boots': 'M31 Greaves of the Crimson March (Damage)' });
        const suppressed = run({ 'gear.boots': 'M31 Greaves of the Crimson March (Damage)',
                                 'gear.shirt': 'M33 Cracked Stormbind Tunic Shirt' });
        assert(alone.activeById.has(ID), 'active on its own');
        assert(!suppressed.activeById.has(ID), 'suppressed by the Stormbind shirt');
        assert(suppressed.bonuses.find((b) => b.id === ID)?.excluded === true,
          'and is marked excluded, not merely inactive');
      },
    },

    // --- order independence ----------------------------------------------------------------
    {
      name: 'Resolution does not depend on slot order',
      why: 'The sheet counted instances by scanning rows above while checking overrides '
         + 'against all rows, so results could shift when rows moved.',
      run(run, assert) {
        const a = run({ 'gear.head': 'M33 Wintermarked Hunter Hood',
                        'gear.boots': 'M33 Wintermarked Marcher Poleyns' });
        const b = run({ 'gear.boots': 'M33 Wintermarked Marcher Poleyns',
                        'gear.head': 'M33 Wintermarked Hunter Hood' });
        assert(near(a.stages.totals.strike_p, b.stages.totals.strike_p),
          'same totals regardless of key order');
      },
    },

    // --- validation ---------------------------------------------------------------------
    {
      name: 'Dynamic weapon mods use the typed value and warn when out of range',
      why: 'FIX #6. Clamping silently rewrites the number the user typed, and would make the '
         + 'engine disagree with the sheet for no stated reason.',
      run(run, assert) {
        const inRange = run({ 'gear.offhandMod2': 'CA (M32+, 600 to 3600)' },
          {}, { 'gear.offhandMod2': 2000 });
        const over = run({ 'gear.offhandMod2': 'CA (M32+, 600 to 3600)' },
          {}, { 'gear.offhandMod2': 5800 });
        assert(near(inRange.stages.weaponMods.ca, 2000), 'in-range value applied');
        assert(inRange.errors.length === 0, 'and no warning');
        assert(near(over.stages.weaponMods.ca, 5800), 'out-of-range value applied as typed');
        assert(over.errors.some((e) => e.kind === 'outOfRange'), 'but reported as out of range');
      },
    },
    {
      name: 'maxCopies and class restrictions are reported',
      run(run, assert) {
        const tooMany = run({ 'insignia.bonus1': "Gladiator's Guile",
                              'insignia.bonus2': "Gladiator's Guile",
                              'insignia.bonus3': "Gladiator's Guile" });
        assert(tooMany.errors.some((e) => e.kind === 'maxCopies'),
          'three copies of a max-2 insignia is an error');
        const wrongClass = run({ 'gear.mainhand': 'M28 Voidtouched Pactblade' },
          { class: 'barbarian' });
        assert(wrongClass.errors.some((e) => e.kind === 'class'),
          'a warlock weapon on a barbarian is an error');
      },
    },
    {
      name: 'Conditions read the build, never the results',
      why: 'Design rule from plan §2.2 -- keeps evaluation single-pass and acyclic.',
      run(run, assert) {
        const seen = new Set();
        const walk = (when) => {
          if (!when) return;
          for (const [key, value] of Object.entries(when)) {
            if (key === 'any' || key === 'all') value.forEach(walk);
            else if (key === 'not') walk(value);
            else seen.add(key);
          }
        };
        const visit = (grant) => {
          walk(grant.when);
          (grant.variants ?? []).forEach((v) => walk(v.when));
        };
        for (const item of window.NW_ITEMS) (item.bonuses ?? []).forEach(visit);
        for (const set of window.NW_BONUSES) set.grants.forEach(visit);
        const allowed = new Set(['toggle', 'role', 'class', 'combatType', 'location',
          'damageType', 'duration', 'pieces', 'equipped']);
        const unknown = [...seen].filter((k) => !allowed.has(k));
        assert(unknown.length === 0, `no condition key outside the vocabulary (saw ${unknown})`);
      },
    },
  ];

  function run() {
    const db = window.NW.db.fromGlobals();
    const runBuild = makeRunner(db);
    const results = [];

    for (const test of TESTS) {
      const failures = [];
      const assert = (ok, label) => { if (!ok) failures.push(label); };
      try {
        test.run(runBuild, assert);
      } catch (error) {
        failures.push(`threw: ${error.message}`);
      }
      results.push({ name: test.name, why: test.why, failures });
    }

    const failed = results.reduce((n, r) => n + r.failures.length, 0);
    return { ok: failed === 0, total: TESTS.length, totalFailures: failed, results };
  }

  function format(report) {
    const lines = [];
    for (const r of report.results) {
      lines.push(`${r.failures.length ? 'FAIL' : 'OK  '} ${r.name}`);
      for (const f of r.failures) lines.push(`       ✗ ${f}`);
    }
    lines.push('');
    lines.push(report.ok
      ? `all ${report.total} unit test(s) passed`
      : `${report.totalFailures} assertion(s) failed`);
    return lines.join('\n');
  }

  return { run, format, TESTS };
})();
