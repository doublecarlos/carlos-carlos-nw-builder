// The stacking layer of the enclosing overlay. A surface teleported out of it (ComboBoxMenu)
// takes the same layer and, mounted later in <body>, paints on top.
import { inject, provide, type InjectionKey } from "vue";

/** A `--z-index-*` utility from base.css. */
export type OverlayLayer = "z-menu" | "z-drawer" | "z-modal" | "z-popover";

const OVERLAY_LAYER: InjectionKey<() => OverlayLayer> = Symbol("overlay-layer");

export function provideOverlayLayer(layer: () => OverlayLayer) {
  provide(OVERLAY_LAYER, layer);
}

/** The enclosing overlay's layer, or the page's menu layer outside any overlay. */
export function useOverlayLayer(): () => OverlayLayer {
  return inject(OVERLAY_LAYER, () => "z-menu");
}
