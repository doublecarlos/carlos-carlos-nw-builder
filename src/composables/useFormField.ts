// FormField's label association. FormField provides a context; the first ui control set up
// inside it claims the field, and the label's `for` names that control's id. A control that is
// not labelable by `for` (SegmentedControl's buttons) reads `labelId` instead and names itself
// with `aria-labelledby`. The claiming control is also described by the field's hint.
import {
  computed,
  inject,
  onBeforeUnmount,
  provide,
  shallowRef,
  useId,
  type ComputedRef,
  type InjectionKey,
} from "vue";

interface FormFieldContext {
  /** The label element's id, or undefined when the field shows no label. */
  labelId: ComputedRef<string | undefined>;
  /** The hint element's id, or undefined when the field shows no hint. */
  hintId: ComputedRef<string | undefined>;
  /** Registers the field's control; returns a release callback, or undefined when another
   *  control already holds the field. */
  claim(controlId: () => string | undefined): (() => void) | undefined;
}

const formFieldKey: InjectionKey<FormFieldContext | null> = Symbol("formField");

/** Sets up one FormField: its label and hint ids, and the claimed control's id. */
export function provideFormField(
  hasLabel: () => boolean,
  hasHint: () => boolean,
) {
  const ownLabelId = useId();
  const ownHintId = useId();
  const claimant = shallowRef<(() => string | undefined) | null>(null);
  const labelId = computed(() => (hasLabel() ? ownLabelId : undefined));
  const hintId = computed(() => (hasHint() ? ownHintId : undefined));

  provide(formFieldKey, {
    labelId,
    hintId,
    claim(controlId) {
      if (claimant.value) return undefined;
      claimant.value = controlId;
      return () => {
        if (claimant.value === controlId) claimant.value = null;
      };
    },
  });

  return {
    labelId,
    hintId,
    controlId: computed(() => claimant.value?.()),
  };
}

/**
 * A labelable control's id and description. Inside a FormField with no control yet, the
 * control claims the field: the label points at its id, and `describedBy` names the field's
 * hint. `explicitId` (a caller's own `inputId`) wins over the generated id. Outside a field the
 * id is just `explicitId`.
 */
export function useFormFieldControl(
  explicitId: () => string | undefined = () => undefined,
): {
  id: ComputedRef<string | undefined>;
  describedBy: ComputedRef<string | undefined>;
} {
  const field = inject(formFieldKey, null);
  const ownId = useId();
  const release = field?.claim(() => explicitId() ?? ownId);
  if (release) onBeforeUnmount(release);
  return {
    id: computed(() => explicitId() ?? (release ? ownId : undefined)),
    describedBy: computed(() => (release ? field?.hintId.value : undefined)),
  };
}

/** The enclosing FormField's label id, for a control named by `aria-labelledby`. */
export function useFormFieldLabelId(): ComputedRef<string | undefined> {
  const field = inject(formFieldKey, null);
  return computed(() => field?.labelId.value);
}
