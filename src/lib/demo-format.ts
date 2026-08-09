// Parses the Cryptic "demo record" text format (`/demo_record build_export $$
// demo_record_stop`) into a generic node tree. No game knowledge here -- it does not know
// what a loadout or an item is, only the file's brace/key/value grammar. That is
// demo-snapshot.ts's job.
//
// Grammar, as observed in the sample `build_export.demo`:
// - The whole document is one brace-delimited block (line 1 `{`, last line `}`).
// - Braces are always alone on their own line, and open/close the block belonging to the
//   preceding key line. Indentation (tabs) is cosmetic; nesting comes only from braces.
// - A bare key (no payload) is ambiguous until the next non-blank line is read: it may be a
//   value-less leaf, or the header of a `{` block.
// - Duplicate keys at the same level are normal (`Pploadoutitems` repeats hundreds of times)
//   and must be preserved as separate ordered entries, never collapsed to a `Record`.

export interface DemoNode {
  key: string;
  /** Scalar payload, unquoted. Absent for block nodes and bare keys. */
  value?: string;
  /** Comma-separated payload, split and trimmed. Absent unless the line had commas. */
  values?: string[];
  /** Ordered; duplicate keys are normal and must be preserved as separate entries. */
  children: DemoNode[];
}

export class DemoParseError extends Error {
  line: number;

  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = "DemoParseError";
    this.line = line;
  }
}

// A `build_export` demo is small (~200 KB), but the same command can capture a long
// session -- cap input so a huge paste can't hang the tab.
const MAX_INPUT_LENGTH = 32 * 1024 * 1024;

function parseKeyLine(trimmed: string, line: number): DemoNode {
  const match = trimmed.match(/^(\S+)[ \t]*([\s\S]*)$/);
  if (!match) throw new DemoParseError(`malformed line "${trimmed}"`, line);
  const [, key, payload] = match;

  if (payload === "") return { key, children: [] };

  if (payload.startsWith('"')) {
    const end = payload.indexOf('"', 1);
    const value = end === -1 ? payload.slice(1) : payload.slice(1, end);
    return { key, value, children: [] };
  }

  if (payload.includes(",")) {
    const values = payload.split(",").map((v) => v.trim());
    return { key, values, children: [] };
  }

  return { key, value: payload.trim(), children: [] };
}

export function parseDemo(text: string): DemoNode {
  if (text.length > MAX_INPUT_LENGTH) {
    throw new DemoParseError(
      `input exceeds the ${MAX_INPUT_LENGTH} byte limit`,
      1,
    );
  }

  const lines = text.split(/\r\n|\r|\n/);
  let i = 0;

  const nextNonBlank = (): number => {
    let j = i;
    while (j < lines.length && lines[j].trim() === "") j++;
    return j;
  };

  // Reads block contents until its matching "}", which it consumes. `openLine` is the
  // 1-based line of the opening "{", used to report a missing close at the right spot.
  const parseBlock = (openLine: number): DemoNode[] => {
    const children: DemoNode[] = [];
    for (;;) {
      i = nextNonBlank();
      if (i >= lines.length) {
        throw new DemoParseError(
          `unbalanced braces: block opened here never closes`,
          openLine,
        );
      }
      const trimmed = lines[i].trim();
      if (trimmed === "}") {
        i++;
        return children;
      }
      if (trimmed === "{") {
        throw new DemoParseError(`unexpected "{" with no preceding key`, i + 1);
      }

      const node = parseKeyLine(trimmed, i + 1);
      i++;

      const j = nextNonBlank();
      if (j < lines.length && lines[j].trim() === "{") {
        i = j + 1;
        node.children = parseBlock(j + 1);
      }
      children.push(node);
    }
  };

  i = nextNonBlank();
  if (i >= lines.length || lines[i].trim() !== "{") {
    throw new DemoParseError(
      'expected the document to open with a root "{"',
      i < lines.length ? i + 1 : Math.max(lines.length, 1),
    );
  }
  const openLine = i + 1;
  i++;
  const rootChildren = parseBlock(openLine);

  const rest = nextNonBlank();
  if (rest < lines.length) {
    throw new DemoParseError(
      "unexpected content after the root block closes",
      rest + 1,
    );
  }

  return { key: "", children: rootChildren };
}

export function child(node: DemoNode, key: string): DemoNode | null {
  return node.children.find((c) => c.key === key) ?? null;
}

export function childrenOf(node: DemoNode, key: string): DemoNode[] {
  return node.children.filter((c) => c.key === key);
}

export function scalar(node: DemoNode, key: string): string | null {
  return child(node, key)?.value ?? null;
}
