<script setup lang="ts">
// A checkbox + its label as one clickable unit. `inline` marks it as text-muted.
// (App.vue's compare toggles, BonusInspector's near-miss filter). State is `v-model` only --
// `model-value`/`update:model-value`, spelled out where a caller needs to route the change
// through a named store action instead of a plain ref -- never a parallel `checked`/`change`
// prop pair, which drove the input's checked state out of sync with callers that don't also
// bind `v-model` (Vue's checkbox `v-model` is a directive that sets `el.checked` itself,
// stomping a plain `:checked` prop on every mount).
withDefaults(
  defineProps<{
    disabled?: boolean;
    inline?: boolean;
    value?: string;
    /** The checkbox's own DOM id. The wrapping `<label>` below already associates the two, so
     *  this exists for an *additional* label an ancestor writes -- BuildSlot's row label, which
     *  sits in its own column outside this component and would otherwise point at nothing. */
    inputId?: string;
  }>(),
  {
    disabled: false,
    inline: false,
    value: "",
    inputId: undefined,
  },
);

// boolean for a standalone toggle; string[] for a checkbox-group bound to one array with each
// checkbox's own `value` prop deciding what it adds/removes (ItemForm's "restricted to classes").
const model = defineModel<boolean | string[]>({ required: true });
</script>

<template>
  <label
    class="flex cursor-pointer items-center gap-1 select-none"
    :class="inline && 'text-muted'"
  >
    <input
      :id="inputId"
      v-model="model"
      type="checkbox"
      :value="value"
      :disabled="disabled"
    />
    <span><slot /></span>
  </label>
</template>
