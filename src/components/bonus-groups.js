// "Bonuses" -- every bonus group the open item belongs to, editable in place.
//
// There is no separate "bonuses on this item" section any more: a bonus that only this item
// grants is just a group with one member, which this component already renders correctly with
// no special-casing (a card's "Currently 1 item(s)" line falls out of `db.setMembers` for
// free). Bonuses used to live behind their own tab; they moved here so editing one is not a
// context switch away from the item that grants it.
//
// Each group saves independently of the item: a shared group is referenced by every item that
// lists its id, so folding its Save into the item's would imply an ownership that does not
// exist.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.BonusGroups = (() => {
  'use strict';

  const draft = () => window.NW.bonusDraft;

  const slugify = (text) => String(text).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  return {
    name: 'BonusGroups',

    components: {
      BonusRows: window.NW.components.BonusRows,
      ComboBox: window.NW.components.ComboBox,
    },

    props: {
      /** Bonus group ids the item currently declares. */
      setIds: { type: Array, default: () => [] },
      /** Seeds the id of a brand-new private bonus. */
      itemName: { type: String, default: '' },
      db: { type: Object, required: true },
      allSetIds: { type: Array, default: () => [] },
      tags: { type: Array, default: () => [] },
      bonusIds: { type: Array, default: () => [] },
    },

    emits: ['save-set', 'delete-set', 'attach-set'],

    data: () => ({ drafts: {}, errors: {} }),

    computed: {
      /**
       * One card per declared group, whether or not a definition exists for it yet. Cards
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

      /** Existing groups not already attached, for "attach an existing bonus". */
      attachable() {
        const attached = new Set(this.setIds);
        return this.allSetIds
          .filter((id) => !attached.has(id))
          .map((id) => ({ value: id, label: this.db.bonusSetById.get(id)?.name ?? id }));
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
       * Rebuild drafts for groups we are not already editing. Existing drafts are left alone
       * so an in-progress edit survives an unrelated change elsewhere in the form.
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

      /** A brand-new effect is unconditional by default -- the common case now that most
       * bonuses are private to one item, not a multi-piece set requirement. */
      addEffect(id) {
        this.drafts[id].effects.push(draft().toDraft({ id: `${id}-bonus`, when: {}, stats: {} }));
      },

      /** Create a bonus group and attach it to the item in one step, seeded from the item's
       * own name -- the common case is a bonus that is only this item's business. */
      addBonus() {
        const base = slugify(this.itemName || 'new-bonus') || 'new-bonus';
        let id = base;
        let n = 2;
        while (this.allSetIds.includes(id)) { id = `${base}-${n}`; n += 1; }
        this.$emit('attach-set', id);
      },

      attachExisting(id) {
        if (!id) return;
        this.$emit('attach-set', id);
      },
    },

    template: `
      <div>
        <div class="form-section">
          Bonuses
          <button type="button" class="link" @click="addBonus">+ add bonus</button>
          <span v-if="attachable.length" class="bonus-attach">
            or
            <ComboBox class="bonus-attach-combo" model-value="" :options="attachable"
                      placeholder="attach an existing one…" @update:model-value="attachExisting" />
          </span>
        </div>

        <p v-if="!cards.length" class="hint">
          This item has no bonuses yet. Add one above -- most are private to a single item;
          attaching an existing bonus id shares it with whatever else already lists it.
        </p>

        <div v-for="card in cards" :key="card.id" class="setcard">
          <div class="setcard-head">
            <label class="field"><span class="field-label">Group name</span>
              <input class="setcard-name" type="text" v-model="drafts[card.id].name"></label>
            <code class="setcard-id">{{ card.id }}</code>
            <span v-if="!card.defined" class="badge badge--warn">not defined yet</span>
            <span class="spacer"></span>
            <button type="button" class="btn btn--primary" @click="save(card.id)">Save</button>
            <button type="button" class="btn" @click="reset(card.id)">Reset</button>
            <button v-if="card.defined" type="button" class="btn"
                    @click="remove(card.id)">Delete</button>
          </div>

          <p v-if="errors[card.id]" class="drawer-error">{{ errors[card.id] }}</p>

          <p class="hint">
            <template v-if="(db.setMembers.get(card.id) ?? []).length > 1">
              Shared by <strong>{{ (db.setMembers.get(card.id) ?? []).length }}</strong> items —
              {{ (db.setMembers.get(card.id) ?? []).join(', ') }}.
            </template>
            <template v-else>Only on this item.</template>
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
