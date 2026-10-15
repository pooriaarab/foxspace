// I1-I8 in docs/failure-modes.md: an import adds what the file says, or nothing.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FoxspaceError, MAX_IMPORT_BYTES, createSpaces, memoryStore, parseImport, parsePaste } from "../src/index.js";

const archive = readFileSync(new URL("fixtures/foxcache-archive.json", import.meta.url), "utf8");
const errorOf = (fn: () => unknown) => {
  try {
    fn();
    return "no error";
  } catch (error) {
    return error instanceof FoxspaceError ? `${error.code}: ${error.message}` : `other: ${String(error)}`;
  }
};

describe("import", () => {
  it("reads a foxcache archive: memories and preferences, with the site and sensitivity", () => {
    const r = parseImport(archive);
    expect(r.format).toBe("foxcache/v1");
    expect(r.items.map((i) => [i.kind, i.sensitivity, i.source])).toEqual([
      ["memory", "public", "foxcache:chatgpt.com"],
      ["memory", "ask", "foxcache:claude.ai"],
      ["memory", "private", "foxcache:chatgpt.com"],
      ["memory", "ask", "foxcache:gemini.google.com"],
      ["preference", "public", "foxcache:chatgpt.com"],
    ]);
    expect(r.ignored).toEqual(["chats"]);
  });

  it("reads a foxcache memory list, bare or tagged, and a foxpack file", () => {
    expect(parseImport(JSON.stringify(["I live in Vancouver.", { text: "I have a cat.", site: "claude.ai" }])).items).toEqual([
      { kind: "memory", text: "I live in Vancouver.", sensitivity: "ask", source: "foxcache" },
      { kind: "memory", text: "I have a cat.", sensitivity: "ask", source: "foxcache:claude.ai" },
    ]);
    expect(parseImport(JSON.stringify({ format: "foxcache/v1", kind: "memories", memories: ["x y"] })).format).toBe("foxcache/v1 memories");
    expect(parseImport(JSON.stringify({ format: "foxpack/v1", memories: [{ text: "Allergic to peanuts.", sensitivity: "private" }] })).items).toEqual([{ kind: "memory", text: "Allergic to peanuts.", sensitivity: "private", source: "foxpack" }]);
  });

  it("I1 refuses a file over 1 MB before it parses it", () => {
    expect(errorOf(() => parseImport(`"${"x".repeat(MAX_IMPORT_BYTES)}"`))).toBe("too-large: The import is larger than 1024 KB.");
  });

  it("I2 refuses __proto__, constructor and prototype keys, and changes no prototype", () => {
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const text = `{"format":"foxpack/v1","memories":[{"text":"hi","${key}":{"polluted":true}}]}`;
      expect(errorOf(() => parseImport(text))).toBe(`bad-import: The import is not valid: it holds the key "${key}".`);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("I3 keeps HTML as plain text", () => {
    expect(parseImport(archive).items[3]!.text).toBe("<img src=x onerror=\"document.title='pwned'\"> I like quiet hotels.");
  });

  it("I4 names the formats it reads, and guesses nothing", () => {
    const formats = "foxspace/v1, foxcache/v1 (an archive or its memory list), foxpack/v1, foxprefs/v1 and foxprefs/rules-v1";
    expect(errorOf(() => parseImport('{"format":"chatgpt"}'))).toBe(`bad-import: The import is not valid: it is not one of ${formats}.`);
    expect(errorOf(() => parseImport("not json"))).toBe("bad-import: The import is not valid: it is not JSON.");
    expect(errorOf(() => parseImport('"text"'))).toBe(`bad-import: The import is not valid: it is not one of ${formats}.`);
  });

  it("I5 keeps the foxprefs level, else the foxprefs default, else private, and I8 makes never-share rules guard terms", () => {
    const prefs = {
      format: "foxprefs/v1",
      values: { "shopping.size.top": "M", "food.allergies": ["peanuts"], "travel.loyalty": ["Aeroplan 123456789"], "budget.perPurchase": { value: 8000, currency: "USD" }, "food.diet": "vegetarian", "pets.kind": "cat", "rules.neverShare": ["home address", "604 555 0199"] },
      // As foxprefs writes it: a level only where the user changed the default.
      sensitivity: { "shopping.size.top": "ask", "food.allergies": "public" },
      updatedAt: "2026-10-15T00:00:00.000Z",
    };
    const r = parseImport(JSON.stringify(prefs));
    expect(r.items.map((i) => [i.text, i.sensitivity])).toEqual([
      ["Shopping size top: M", "ask"],
      ["Food allergies: peanuts", "public"],
      ["Travel loyalty: Aeroplan 123456789", "private"],
      ["Budget per purchase: 80.00 USD", "ask"],
      ["Food diet: vegetarian", "public"],
      ["Pets kind: cat", "private"],
    ]);
    expect(r.neverShare).toEqual(["home address", "604 555 0199"]);
    expect(parseImport(JSON.stringify({ format: "foxprefs/rules-v1", neverShare: ["AB123456"], userRules: [] })).neverShare).toEqual(["AB123456"]);
  });

  it("I6 fails the whole import on one bad item, and names it", () => {
    const text = JSON.stringify({ format: "foxpack/v1", memories: ["fine", "bad\u200bzero-width", "fine too"] });
    expect(errorOf(() => parseImport(text))).toBe("bad-import: foxpack memory 2 text holds the hidden character U+200B.");
    expect(errorOf(() => parseImport(JSON.stringify({ format: "foxpack/v1", memories: [{ text: "x", sensitivity: "secret" }] })))).toBe('bad-import: foxpack memory 1 has the sensitivity "secret"; use public, ask or private.');
  });

  it("reads a foxspace/v1 file into new spaces with new ids", async () => {
    const spaces = createSpaces({ store: memoryStore() });
    const trip = await spaces.create("Trip");
    await spaces.addItems(trip.id, [{ kind: "memory", text: "One", sensitivity: "private" }]);
    const file = JSON.stringify(await spaces.export());
    const added = await spaces.addSpaces(parseImport(file).spaces);
    expect(added.map((s) => s.name)).toEqual(["Trip (2)"]);
    expect(added[0]!.id).not.toBe(trip.id);
    expect(added[0]!.items[0]).toMatchObject({ text: "One", sensitivity: "private" });
  });

  it("I9 never makes an imported space agent-readable", async () => {
    const spaces = createSpaces({ store: memoryStore() });
    const theirs = createSpaces({ store: memoryStore() });
    await theirs.create("Shared", { agentReadable: true });
    const [added] = await spaces.addSpaces(parseImport(JSON.stringify(await theirs.export())).spaces);
    expect(added!.agentReadable).toBe(false);
  });

  it("splits a paste into one item per paragraph", () => {
    expect(parsePaste("I like trains.\n\n  I wake up early.\n", "memory")).toEqual([
      { kind: "memory", text: "I like trains.", sensitivity: "ask", source: "paste" },
      { kind: "memory", text: "I wake up early.", sensitivity: "ask", source: "paste" },
    ]);
    expect(parsePaste("Be brief.\n\nUse metric.", "instructions", "public")).toHaveLength(1);
  });
});
