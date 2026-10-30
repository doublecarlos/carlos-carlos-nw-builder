// Tests for lib/download.ts: the object URL outlives the click and is revoked afterwards.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadJson, downloadText } from "../../src/lib/download";

interface FakeLink {
  href: string;
  download: string;
  click: () => void;
}

let created: Blob[];
let revoked: string[];
let links: FakeLink[];
let revokedAtClick: boolean[];

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  revoked = [];
  links = [];
  revokedAtClick = [];
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return `blob:test-${created.length}`;
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  vi.stubGlobal("document", {
    createElement: (): FakeLink => {
      const link: FakeLink = {
        href: "",
        download: "",
        click: () => revokedAtClick.push(revoked.includes(link.href)),
      };
      links.push(link);
      return link;
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("downloadJson", () => {
  it("clicks a link to the blob and revokes its URL on a later task", async () => {
    downloadJson("build.json", '{"a":1}');
    expect(links).toHaveLength(1);
    expect(links[0]?.download).toBe("build.json");
    expect(links[0]?.href).toBe("blob:test-1");
    expect(revokedAtClick).toEqual([false]);
    expect(revoked).toEqual([]);
    expect(created[0]?.type).toBe("application/json");
    expect(await created[0]?.text()).toBe('{"a":1}');

    vi.runAllTimers();
    expect(revoked).toEqual(["blob:test-1"]);
  });
});

describe("downloadText", () => {
  it("uses the given media type", () => {
    downloadText("layer.txt", "x", "text/plain");
    expect(created[0]?.type).toBe("text/plain");
    vi.runAllTimers();
    expect(revoked).toEqual(["blob:test-1"]);
  });
});
