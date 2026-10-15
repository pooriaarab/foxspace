// G1-G7 in docs/failure-modes.md: the guard is hard to slip past and never matches everything.
import { describe, expect, it } from "vitest";
import { FoxspaceError, MAX_GUARD_CHARS, checkTerm, createGuard, normalizeForGuard } from "../src/index.js";

const guard = createGuard([
  { term: "passport", from: "Trip to Japan" },
  { term: "Acme Corp", from: "Work" },
  { term: "604 555 0199", from: "foxprefs" },
  { term: "Ann", from: "Work" },
]);
const code = (t: string) => {
  try {
    return checkTerm(t, "Term 1");
  } catch (error) {
    return error instanceof FoxspaceError ? `${error.code}: ${error.message}` : String(error);
  }
};
const hits = (text: string) => guard(text).matches.map((m) => m.term);

describe("guard", () => {
  it("passes a clean message", () => {
    expect(guard("Plan a week in Kyoto by train.")).toEqual({ ok: true, matches: [], tooLong: false });
  });

  it("G1 matches through zero-width characters, the soft hyphen, the word joiner and bidi marks", () => {
    for (const text of ["my pass\u200bport", "my pass\u00adport", "my pass\u2060port", "my pass\u200dport", "my \u202epassport\u202c", "my pas\ufe0fsport"]) {
      expect(hits(text), JSON.stringify(text)).toEqual(["passport"]);
    }
  });

  it("G2 matches through lookalikes: Cyrillic, Greek, fullwidth and math letters", () => {
    expect(hits("my pаsspоrt")).toEqual(["passport"]); // Cyrillic a and o
    expect(hits("Асmе Corp")).toEqual(["Acme Corp"]); // Cyrillic A, c, e
    expect(hits("Ρassport")).toEqual(["passport"]); // Greek Rho
    expect(hits("ｐａｓｓｐｏｒｔ")).toEqual(["passport"]); // fullwidth
    expect(hits("𝐩𝐚𝐬𝐬𝐩𝐨𝐫𝐭")).toEqual(["passport"]); // math bold
    expect(hits("pàsspört")).toEqual(["passport"]); // accents
  });

  it("G3 matches through case and spacing", () => {
    expect(hits("ACME  CORP")).toEqual(["Acme Corp"]);
    expect(hits("acme\ncorp")).toEqual(["Acme Corp"]);
    expect(hits("acme-corp.")).toEqual(["Acme Corp"]);
    const street = createGuard([{ term: "Hauptstraße", from: "Home" }]);
    expect([street("HAUPTSTRASSE 5").ok, street("hauptstrasse 5").ok]).toEqual([false, false]);
  });

  it("G4 matches a number with other separators, and not inside a longer number", () => {
    expect(hits("call 604-555-0199")).toEqual(["604 555 0199"]);
    expect(hits("call (604) 555.0199")).toEqual(["604 555 0199"]);
    expect(hits("call 6045550199")).toEqual(["604 555 0199"]);
    expect(hits("call ６０４５５５０１９９")).toEqual(["604 555 0199"]);
    expect(hits("id 16045550199")).toEqual([]);
  });

  it("G4 matches a long one-word term with spaces put in it", () => {
    const ids = createGuard([{ term: "AB123456", from: "Trip" }]);
    expect(ids("passport AB 1234 56").ok).toBe(false);
    expect(ids("passport a b 1 2 3 4 5 6").ok).toBe(false);
    expect(ids("passport XAB123456").ok).toBe(true);
  });

  it("G5 matches whole words only", () => {
    expect(hits("a banner for Anna")).toEqual([]);
    expect(hits("ask Ann.")).toEqual(["Ann"]);
  });

  it("G6 stops a text too long to check", () => {
    expect(guard("x".repeat(MAX_GUARD_CHARS + 1))).toEqual({ ok: false, matches: [], tooLong: true });
  });

  it("G7 refuses a term that would match nothing or everything", () => {
    expect(code("---")).toBe("bad-space: Term 1 must have at least two letters or digits.");
    expect(code("x")).toBe("bad-space: Term 1 must have at least two letters or digits.");
    expect(code(" AB123456 ")).toBe("AB123456");
    expect(createGuard([{ term: "!!", from: "x" }])("anything").ok).toBe(true);
  });

  it("normalizes both sides the same way", () => {
    expect(normalizeForGuard("  Ｈéllo,\u200b WORLD!! ")).toBe("hello world");
  });
});
