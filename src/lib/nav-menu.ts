// The row menu entries the sidebar hands to NavContextMenu.
import type { Component } from "vue";

export interface NavMenuItem {
  action: string;
  label: string;
  /** Lucide component rendered left of the label. */
  icon?: Component;
  danger?: boolean;
  disabled?: boolean;
  /** Tree depth below the list's own level, for an entry listed inside a hierarchy. */
  indent?: number;
  /** Opens a second list in the same menu instead of acting, with a way back. */
  submenu?: { title: string; items: NavMenuItem[] };
}
