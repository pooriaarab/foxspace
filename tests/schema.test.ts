// S1-S5 in docs/failure-modes.md: the foxspace/v1 record refuses what it cannot trust.
import { describe, expect, it } from "vitest";
import { FORMAT, FoxspaceError, checkItem, checkSpace, checkState, newId } from "../src/index.js";

const NOW = "2026-10-15T12:00:00.000Z";
const item = (over: Record<string, unknown> = {}) => ({ id: "i1", kind: "memory", text: "I live in Vancouver.", sensitivity: "public", ...over });
const space = (over: Record<string, unknown> = {}) => ({ id: "s1", name: "Trip to Japan", items: [item()], neverShare: [], agentReadable: false, createdAt: NOW, updatedAt: NOW, ...over });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof FoxspaceError ? `${error.code}: ${error.message}` : `other: ${String(error)}`;
  }
  return "no error";
};

describe("space items", () => {
  it("S1 refuses an item with no text, text that is not a string, or an unknown kind", () => {
    expect(code(() => checkItem(item({ text: "  " }), "Item 1"))).toBe("bad-space: Item 1 text must not be empty.");
    expect(code(() => checkItem(item({ text: 42 }), "Item 1"))).toBe("bad-space: Item 1 text must be text.");
    expect(code(() => checkItem(item({ kind: "file" }), "Item 1"))).toBe('bad-space: Item 1 has the kind "file"; use instructions, memory, preference, snippet.');
    expect(code(() => checkItem(item({ extra: 1 }), "Item 1"))).toBe('bad-space: Item 1 has the unknown key "extra".');
  });

  it("S2 refuses a huge item, too many items and too many terms", () => {
    expect(code(() => checkItem(item({ text: "x".repeat(4001) }), "Item 1"))).toBe("bad-space: Item 1 text is 4001 characters; the limit is 4000.");
    const items = Array.from({ length: 301 }, (_, i) => item({ id: `i${i}` }));
    expect(code(() => checkSpace(space({ items })))).toBe('bad-space: Space "Trip to Japan" has 301 items; the limit is 300.');
    expect(code(() => checkSpace(space({ neverShare: Array(101).fill("x") })))).toBe('bad-space: Space "Trip to Japan" has 101 never-share terms; the limit is 100.');
    expect(code(() => checkSpace(space({ name: "n".repeat(81) })))).toMatch(/name is 81 characters; the limit is 80/);
  });

  it("S3 refuses control characters, bidi controls and the zero-width space, but keeps the joiners", () => {
    expect(code(() => checkItem(item({ text: "a\u0007b" }), "Item 1"))).toBe("bad-space: Item 1 text holds the hidden character U+0007.");
    expect(code(() => checkItem(item({ text: "pay \u202eevil" }), "Item 1"))).toBe("bad-space: Item 1 text holds the hidden character U+202E.");
    expect(code(() => checkItem(item({ text: "pass\u200bport" }), "Item 1"))).toBe("bad-space: Item 1 text holds the hidden character U+200B.");
    expect(code(() => checkItem(item({ text: "\ufeffhi" }), "Item 1"))).toBe("bad-space: Item 1 text holds the hidden character U+FEFF.");
    expect(code(() => checkItem(item({ text: "hi\u{E0049}\u{E0047}" }), "Item 1"))).toBe("bad-space: Item 1 text holds the hidden character U+E0049.");
    expect(code(() => checkItem(item({ text: "pass\u00adport" }), "Item 1"))).toBe("bad-space: Item 1 text holds the hidden character U+00AD.");
    expect(checkItem(item({ text: "Line one\n\tLine two" }), "Item 1").text).toBe("Line one\n\tLine two");
    expect(checkItem(item({ text: "Tea \u2615\ufe0f" }), "Item 1").text).toContain("\ufe0f");
    expect(checkItem(item({ text: "می\u200cخواهم 👨\u200d👩\u200d👧" }), "Item 1").text).toContain("\u200c");
    expect(code(() => checkSpace(space({ neverShare: ["two\nlines"] })))).toBe('bad-space: Space "Trip to Japan" never-share term 1 must be one line.');
  });

  it("S4 makes a missing sensitivity ask, and refuses an unknown one", () => {
    const { sensitivity, ...bare } = item();
    expect(sensitivity).toBe("public");
    expect(checkItem(bare, "Item 1").sensitivity).toBe("ask");
    expect(code(() => checkItem(item({ sensitivity: "secret" }), "Item 1"))).toBe('bad-space: Item 1 has the sensitivity "secret"; use public, ask or private.');
  });

  it("S5 refuses two items or two spaces with one id", () => {
    expect(code(() => checkSpace(space({ items: [item(), item()] })))).toBe('bad-space: Space "Trip to Japan" has two items with the id i1.');
    const state = { format: FORMAT, spaces: [space(), space()], updatedAt: NOW };
    expect(code(() => checkState(state, "bad-store"))).toBe("bad-store: The record has two spaces with the id s1.");
  });

  it("checks the record format and copies only known fields", () => {
    expect(code(() => checkState({ format: "foxspace/v0", spaces: [], updatedAt: NOW }, "bad-import"))).toBe("bad-import: The record is not foxspace/v1.");
    const checked = checkState({ format: FORMAT, spaces: [space()], updatedAt: NOW }, "bad-store");
    expect(checked.spaces[0]).toEqual(space());
    expect(newId()).toMatch(/^[0-9a-f]{10}$/);
  });
});
