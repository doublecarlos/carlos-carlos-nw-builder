// Shared icon-button: a `button.link` whose content is a 24x24 lucide glyph plus an inline
// `<title>` for the native hover tooltip (and the accessible name, since the svg is the
// button's only content). `window.NW.icons` is the shared glyph registry so condition-rows.js,
// bonus-rows.js and bonus-groups.js draw from the same set instead of each inlining SVG markup.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.icons = {
  'arrow-up': '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  'arrow-down': '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>'
    + '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'circle-plus': '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  ampersand: '<path d="M16 12h3"/>'
    + '<path d="M17.5 12a8 8 0 0 1-8 8A4.5 4.5 0 0 1 5 15.5c0-6 8-4 8-8.5a3 3 0 1 0-6 0c0 3 2.5 8.5 12 13"/>',
  split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/>'
    + '<line x1="12" x2="12.01" y1="16" y2="16"/>',
  trash: '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/>'
    + '<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
};

window.NW.components.IconButton = {
  name: 'IconButton',

  props: {
    icon: { type: String, required: true },
    title: { type: String, required: true },
    disabled: { type: Boolean, default: false },
  },

  emits: ['click'],

  computed: {
    // `<title>` inside the svg drives both the hover tooltip and the button's accessible name.
    markup() { return `${window.NW.icons[this.icon] ?? ''}<title>${this.title}</title>`; },
  },

  template: `
    <button type="button" class="link icon-btn" :disabled="disabled" @click="$emit('click')">
      <svg role="img" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" class="lucide" v-html="markup"></svg>
    </button>
  `,
};
