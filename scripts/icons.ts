// Serves `virtual:icon/<name>.vue` as a Vapor SFC built from Lucide's icon data.
//
// `@lucide/vue` ships VDOM components (`h()` inside), which Vapor can only mount through
// interop. Its per-icon modules still export the raw `__iconNode`, so each icon is rendered
// here as a plain template and compiled by @vitejs/plugin-vue like any other SFC.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { Plugin } from "vite";

const PREFIX = "virtual:icon/";
const SUFFIX = ".vue";

type IconNode = [tag: string, attrs: Record<string, string | number>][];

const require_ = createRequire(import.meta.url);

const iconDir = () =>
  path.join(
    path.dirname(require_.resolve("@lucide/vue/package.json")),
    "dist/esm/icons",
  );

const readIconNode = async (name: string): Promise<IconNode> => {
  let source: string;
  try {
    source = await readFile(path.join(iconDir(), `${name}.mjs`), "utf8");
  } catch {
    throw new Error(`Unknown Lucide icon "${name}" (virtual:icon/${name}.vue)`);
  }
  const literal = /const __iconNode = (\[[\s\S]*?\]);\s*const /.exec(
    source,
  )?.[1];
  if (!literal) throw new Error(`No icon data found for "${name}"`);
  return new Function(`return ${literal}`)() as IconNode;
};

const renderIcon = (name: string, nodes: IconNode): string => {
  const children = nodes
    .map(([tag, { key: _key, ...attrs }]) => {
      const list = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `    <${tag} ${list} />`;
    })
    .join("\n");
  return `<template>
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-${name}">
${children}
  </svg>
</template>
`;
};

export const iconPlugin = (): Plugin => ({
  name: "virtual-icons",
  enforce: "pre",
  resolveId(id) {
    // No `\0` prefix: @vitejs/plugin-vue only transforms ids that look like `.vue` files.
    if (id.startsWith(PREFIX) && id.endsWith(SUFFIX)) return id;
  },
  async load(id) {
    if (!id.startsWith(PREFIX) || !id.endsWith(SUFFIX)) return;
    const name = id.slice(PREFIX.length, -SUFFIX.length);
    return renderIcon(name, await readIconNode(name));
  },
});
