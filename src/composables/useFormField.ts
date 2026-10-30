// FormField's label association. FormField provides a context; the first ui control set up
// inside it claims the field, and the label's `for` names that control's id. A control that is
// not labelable by `for` (SegmentedControl's buttons) reads `labelId` instead and names itself
// with `aria-labelledby`.
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
  /** Registers the field's control; returns a release callback, or undefined when another
   *  control already holds the field. */
  claim(controlId: () => string | undefined): (() => void) | undefined;
}

const formFieldKey: InjectionKey<FormFieldContext | null> = Symbol("formField");
const formGridKey: InjectionKey<boolean> = Symbol("formGrid");

/** Marks the following FormFields as direct FormGrid cells. */
export function provideFormGrid() {
  provide(formGridKey, true);
  // A field's own context replaces this one, so nested fields never read as grid cells.
  provide(formFieldKey, null);
}

/** Sets up one FormField: its label id, the claimed control's id, and whether it is a grid
 *  cell. Descendant fields get their own context, and only see `inGrid` through a FormGrid. */
export function provideFormField(hasLabel: () => boolean) {
  const inGrid = inject(formGridKey, false);
  const ownLabelId = useId();
  const claimant = shallowRef<(() => string | undefined) | null>(null);
  const labelId = computed(() => (hasLabel() ? ownLabelId : undefined));

  provide(formFieldKey, {
    labelId,
    claim(controlId) {
      if (claimant.value) return undefined;
      claimant.value = controlId;
      return () => {
        if (claimant.value === controlId) claimant.value = null;
      };
    },
  });
  provide(formGridKey, false);

  return {
    inGrid,
    labelId,
    controlId: computed(() => claimant.value?.()),
  };
}

/**
 * A labelable control's id. Inside a FormField with no control yet, the control claims the
 * field and gets an id the label points at; `explicitId` (a caller's own `inputId`) wins over
 * the generated one. Outside a field the id is just `explicitId`.
 */
export function useFormFieldControl(
  explicitId: () => string | undefined = () => undefined,
): ComputedRef<string | undefined> {
  const field = inject(formFieldKey, null);
  const ownId = useId();
  const release = field?.claim(() => explicitId() ?? ownId);
  if (release) onBeforeUnmount(release);
  return computed(() => explicitId() ?? (release ? ownId : undefined));
}

/** The enclosing FormField's label id, for a control named by `aria-labelledby`. */
export function useFormFieldLabelId(): ComputedRef<string | undefined> {
  const field = inject(formFieldKey, null);
  return computed(() => field?.labelId.value);
}
