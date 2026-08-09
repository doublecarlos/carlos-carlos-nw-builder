// demo-format.ts's parser: the generic node tree built from the Cryptic "demo record" text
// format, before any game-domain meaning is layered on top (that's demo-snapshot.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseDemo,
  child,
  childrenOf,
  scalar,
  DemoParseError,
} from "../../src/lib/demo-format";

const fixture = readFileSync(
  join(__dirname, "fixtures/build-export.demo.txt"),
  "utf-8",
);

function captureError(fn: () => void): DemoParseError {
  try {
    fn();
  } catch (err) {
    return err as DemoParseError;
  }
  throw new Error("expected function to throw");
}

describe("parseDemo: line forms", () => {
  it("parses a key + scalar", () => {
    const root = parseDemo("{\nVersion 2\n}\n");
    expect(scalar(root, "Version")).toBe("2");
  });

  it("parses a key + quoted scalar, stripping the quotes", () => {
    const root = parseDemo('{\nLoadoutname "2. Heal"\n}\n');
    expect(scalar(root, "Loadoutname")).toBe("2. Heal");
  });

  it("parses a key + unquoted scalar containing spaces", () => {
    const root = parseDemo("{\nNotes some free text value\n}\n");
    expect(scalar(root, "Notes")).toBe("some free text value");
  });

  it("parses a key + list into trimmed values", () => {
    const root = parseDemo("{\nBusedye  1, 1, 1, 0\n}\n");
    expect(child(root, "Busedye")?.values).toEqual(["1", "1", "1", "0"]);
    expect(child(root, "Busedye")?.value).toBeUndefined();
  });

  it("parses a bare key with no body as a value-less, childless leaf", () => {
    const root = parseDemo("{\nEapowerdefrefs\n}\n");
    const node = child(root, "Eapowerdefrefs")!;
    expect(node.value).toBeUndefined();
    expect(node.values).toBeUndefined();
    expect(node.children).toEqual([]);
  });

  it("parses a block key's children", () => {
    const root = parseDemo("{\nPploadoutitems\n{\nHitem Foo\n}\n}\n");
    const node = child(root, "Pploadoutitems")!;
    expect(scalar(node, "Hitem")).toBe("Foo");
  });

  it("resolves a bare key immediately followed by another bare key as two leaves", () => {
    const root = parseDemo("{\nEapowerdefrefs\nPuipowerids\n}\n");
    expect(child(root, "Eapowerdefrefs")?.children).toEqual([]);
    expect(child(root, "Puipowerids")?.children).toEqual([]);
  });

  it("ignores blank lines between siblings", () => {
    const root = parseDemo("{\nVersion 2\n\n\nFovy 1\n}\n");
    expect(root.children).toHaveLength(2);
  });

  it("accepts a trailing top-level scalar after a sibling block closes", () => {
    const root = parseDemo("{\nPackets\n{\nFoo 1\n}\nFovy 100.000000\n}\n");
    expect(scalar(root, "Fovy")).toBe("100.000000");
  });
});

describe("parseDemo: duplicate keys", () => {
  it("preserves duplicate sibling keys as separate ordered entries", () => {
    const root = parseDemo(
      "{\nPploadoutitems\n{\nHitem A\n}\nPploadoutitems\n{\nHitem B\n}\n}\n",
    );
    const items = childrenOf(root, "Pploadoutitems");
    expect(items).toHaveLength(2);
    expect(scalar(items[0], "Hitem")).toBe("A");
    expect(scalar(items[1], "Hitem")).toBe("B");
  });
});

describe("parseDemo: big integers", () => {
  it("keeps a 64-bit id as an exact string, not a lossy JS number", () => {
    const root = parseDemo("{\nIitemid 2218087575996873968\n}\n");
    expect(scalar(root, "Iitemid")).toBe("2218087575996873968");
  });
});

describe("parseDemo: CRLF/LF", () => {
  it("accepts CRLF line endings the same as LF", () => {
    const root = parseDemo("{\r\nVersion 2\r\n}\r\n");
    expect(scalar(root, "Version")).toBe("2");
  });
});

describe("parseDemo: errors", () => {
  it("throws DemoParseError with the right line number for an unclosed block", () => {
    const err = captureError(() =>
      parseDemo("{\nPploadoutitems\n{\nHitem A\n}\n"),
    );
    expect(err).toBeInstanceOf(DemoParseError);
    expect(err.line).toBe(1);
  });

  it("throws DemoParseError for content after the root block closes", () => {
    const err = captureError(() => parseDemo("{\nVersion 2\n}\nGarbage 1\n"));
    expect(err).toBeInstanceOf(DemoParseError);
    expect(err.line).toBe(4);
  });

  it("throws DemoParseError when the document does not open with a root brace", () => {
    expect(() => parseDemo("Version 2\n}\n")).toThrow(DemoParseError);
  });
});

describe("parseDemo: unknown keys", () => {
  it("preserves keys it doesn't recognise verbatim", () => {
    const root = parseDemo("{\nTotallyMadeUpKey 42\n}\n");
    expect(scalar(root, "TotallyMadeUpKey")).toBe("42");
  });
});

describe("child / childrenOf / scalar helpers", () => {
  it("child returns null for a missing key", () => {
    const root = parseDemo("{\nVersion 2\n}\n");
    expect(child(root, "Nope")).toBeNull();
  });

  it("childrenOf returns an empty array for a missing key", () => {
    const root = parseDemo("{\nVersion 2\n}\n");
    expect(childrenOf(root, "Nope")).toEqual([]);
  });

  it("scalar returns null for a missing key or a value-less bare key", () => {
    const root = parseDemo("{\nEapowerdefrefs\n}\n");
    expect(scalar(root, "Nope")).toBeNull();
    expect(scalar(root, "Eapowerdefrefs")).toBeNull();
  });
});

describe("parseDemo: fixture", () => {
  it("parses the trimmed sample file end to end", () => {
    const root = parseDemo(fixture);
    expect(scalar(root, "Version")).toBe("2");
    expect(scalar(root, "Fovy")).toBe("100.000000");

    const packets = child(root, "Packets")!;
    const createdents = child(packets, "Createdents")!;
    const entityAttach = child(createdents, "EntityAttach")!;
    expect(scalar(entityAttach, "Savedname")).toBe("Carlos o Bardo");

    const loadouts = childrenOf(
      child(entityAttach, "Pentityloadouts")!,
      "Ppentityloadouts",
    );
    expect(loadouts).toHaveLength(2);
    expect(scalar(loadouts[0], "Loadoutname")).toBe("1. DPS ST");
    expect(scalar(loadouts[1], "Loadoutname")).toBe("aaaaaa");

    const items = childrenOf(loadouts[0], "Pploadoutitems");
    expect(items).toHaveLength(4);
    // The empty FashionAccessory slot has no Hitem.
    expect(scalar(items[2], "Ebagid")).toBe("FashionAccessory");
    expect(scalar(items[2], "Hitem")).toBeNull();
    // The mount item carries its insignia as nested Pploadoutgems, in order.
    const gems = childrenOf(items[3], "Pploadoutgems");
    expect(gems.map((g) => scalar(g, "Hslotteditem"))).toEqual([
      "Insignia_Barbed_Power_R6",
      "Insignia_Bile_Power_R5",
    ]);
  });
});
