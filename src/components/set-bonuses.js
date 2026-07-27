// "Set bonuses on this item" -- the sets the open item belongs to, editable in place.
//
// Set bonuses used to live behind their own tab, which meant editing a two-piece set was a
// context switch away from the item that grants it. They are edited here instead, next to the
// item, using the same bonus editor as the item's own inline bonuses.
//
// Each set saves independently of the item: a set is shared by every item that references it,
// so folding its Save into the item's would imply an ownership that does not exist.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.SetBonuses = (() => {
  'use strict';

  const draft = () => window.NW.bonusDraft;

  const slugify = (text) => String(text).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  return {
    name: 'SetBonuses',

    components: { BonusRows: window.NW.components.BonusRows },

    props: {
      /** Set ids the item currently declares. */
      setIds: { type: Array, default: () => [] },
      db: { type: Object, required: true },
      allSetIds: { type: Array, default: () => [] },
      tags: { type: Array, default: () => [] },
      bonusIds: { type: Array, default: () => [] },
    },

    emits: ['save-set', 'delete-set', 'attach-set'],

    data: () => ({ drafts: {}, errors: {} }),

    computed: {
      /**
       * One card per declared set, whether or not a definition exists for it yet. Cards
       * without a draft are skipped rather than rendered half-built: the watcher creates the
       * draft, and a render that raced it used to throw on `drafts[id].name`.
       */
      cards() {
        return this.setIds
          .filter((id) => this.drafts[id])
          .map((id) => {
            const set = this.db.bonusSetById.get(id) ?? null;
            return { id, set, defined: Boolean(set) };
          });
      },
    },

    watch: {
      // `deep` as well as `immediate`: callers should hand us a fresh array, but a single
      // in-place mutation anywhere would otherwise leave a card with no draft behind it.
      setIds: { immediate: true, deep: true, handler() { this.sync(); } },
      db() { this.sync(); },
    },

    methods: {
      /**
       * Rebuild drafts for sets we are not already editing. Existing drafts are left alone so
       * an in-progress edit survives an unrelated change elsewhere in the form.
       */
      sync() {
        for (const id of this.setIds) {
          if (this.drafts[id]) continue;
          const set = this.db.bonusSetById.get(id);
          this.drafts[id] = {
            name: set?.name ?? id,
            effects: (set?.effects ?? []).map((effect) => draft().toDraft(effect)),
          };
        }
      },

      /** Discard a draft so it is rebuilt from the saved data on the next sync. */
      reset(id) {
        delete this.drafts[id];
        this.errors[id] = '';
        this.sync();
      },

      save(id) {
        const local = this.drafts[id];
        if (!local) return;
        let effects;
        try {
          effects = local.effects.map((effect) => draft().toBonus(effect));
        } catch (error) {
          this.errors[id] = `An effect has invalid JSON: ${error.message}`;
          return;
        }
        const missing = effects.findIndex((effect) => !effect.id);
        if (missing !== -1) {
          this.errors[id] = `Effect ${missing + 1} needs an id.`;
          return;
        }
        this.errors[id] = '';
        this.$emit('save-set', { id, set: { id, name: local.name || id, effects } });
      },

      remove(id) {
        delete this.drafts[id];
        this.$emit('delete-set', id);
      },

      addEffect(id) {
        // A brand-new effect on a set almost always means "when N pieces are equipped", so it
        // starts with that condition already pointed at this set.
        this.drafts[id].effects.push(draft().toDraft({
          id: `${id}-bonus`,
          when: { pieces: { set: id, atLeast: 2 } },
          stats: {},
        }));
      },

      /** Create a set and attach it to the item in one step. */
      createSet() {
        const base = slugify(this.newName || 'new-set') || 'new-set';
        let id = base;
        let n = 2;
        while (this.allSetIds.includes(id)) { id = `${base}-${n}`; n += 1; }
        this.$emit('attach-set', id);
      },
    },

    template: `
      <div>
        <div class="form-section">
          Set bonuses on this item
          <button type="button" class="link" @click="createSet">+ new set</button>
        </div>

        <p v-if="!cards.length" class="hint">
          This item is not part of any set. Add a set above, or create one here — set bonuses
          are shared by every item that lists the same set id.
        </p>

        <div v-for="card in cards" :key="card.id" class="setcard">
          <div class="setcard-head">
            <label class="field"><span class="field-label">Set name</span>
              <input class="setcard-name" type="text" v-model="drafts[card.id].name"></label>
            <code class="setcard-id">{{ card.id }}</code>
            <span v-if="!card.defined" class="badge badge--warn">not defined yet</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--primary" @click="save(card.id)">Save set</button>
            <button type="button" class="btn" @click="reset(card.id)">Reset</button>
            <button v-if="card.defined" type="button" class="btn"
                    @click="remove(card.id)">Delete set</button>
          </div>

          <p v-if="errors[card.id]" class="drawer-error">{{ errors[card.id] }}</p>

          <p class="hint">
            Granted to every item listing <code>{{ card.id }}</code>.
            Currently
            <strong>{{ (db.setMembers.get(card.id) ?? []).length }}</strong> item(s) —
            {{ (db.setMembers.get(card.id) ?? []).join(', ') || 'none yet' }}.
          </p>

          <div class="sub-section">
            Effects
            <button type="button" class="link" @click="addEffect(card.id)">+ add effect</button>
            <span v-if="!drafts[card.id].effects.length" class="hint">none yet</span>
          </div>

          <BonusRows
            :rows="drafts[card.id].effects"
            :set-ids="allSetIds"
            :tags="tags"
            :bonus-ids="bonusIds"
            id-placeholder="effect id"
            @error="errors[card.id] = $event" />
        </div>
      </div>
    `,
  };
})();
