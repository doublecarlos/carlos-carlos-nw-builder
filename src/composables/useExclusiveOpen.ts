import { ref } from "vue";

/** One open id shared across every instance from the same call. Call once per component module
 *  (a non-`setup` `<script>` block), so each component type gets its own shared state. */
export function useExclusiveOpen<T>() {
  const openId = ref<T | null>(null);

  return {
    isOpen: (id: T) => openId.value === id,
    open: (id: T) => {
      openId.value = id;
    },
    close: () => {
      openId.value = null;
    },
  };
}
