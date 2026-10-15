// R1-R7 in docs/failure-modes.md: what a render may hold.
import { describe, expect, it } from "vitest";
import { FoxspaceError, PROVIDERS, renderForSync, renderSpace, type Sensitivity, type Space, type SpaceItem } from "../src/index.js";

const NOW = "2026-10-15T12:00:00.000Z";
const entry = (id: string, kind: SpaceItem["kind"], text: string, sensitivity: Sensitivity): SpaceItem => ({ id, kind, text, sensitivity });
const code = (fn: () => unknown) => {
  try {
    fn();
    return "no error";
  } catch (error) {
    return error instanceof FoxspaceError ? `${error.code}: ${error.message}` : String(error);
  }
};
const trip = (items: SpaceItem[] = [
  entry("ins", "instructions", "Plan by train. Keep days light.", "public"),
  entry("veg", "preference", "Vegetarian food only.", "public"),
  entry("budget", "memory", "My budget is 3000 CAD.", "ask"),
  entry("pass", "memory", "Passport AB123456.", "private"),
  entry("rail", "snippet", "JR Pass, 7 days.", "ask"),
]): Space => ({ id: "s1", name: "Trip to Japan", items, neverShare: ["AB123456"], agentReadable: false, createdAt: NOW, updatedAt: NOW });

describe("render", () => {
  it("renders public items, grouped, in plain text", () => {
    const r = renderSpace(trip());
    expect(r.text).toBe('Context for this chat, from my foxspace "Trip to Japan":\n\nInstructions:\nPlan by train. Keep days light.\n\nPreferences:\n- Vegetarian food only.');
    expect(r).toMatchObject({ included: ["ins", "veg"], left: { private: 1, unticked: 2, tooLong: 0 } });
  });

  it("R1 never renders a private item, ticked or not, in any format or box", () => {
    const space = trip();
    for (const format of ["text", "markdown"] as const) {
      expect(renderSpace(space, { format, ticked: ["pass", "budget", "rail"] }).text).not.toContain("AB123456");
    }
    for (const p of PROVIDERS) for (const box of p.sync) expect(renderForSync(space, p.id, box.id, { ticked: ["pass"] }).text).not.toContain("AB123456");
  });

  it("R1 never renders a never-share term from the space list", () => {
    expect(JSON.stringify(renderSpace(trip(), { ticked: ["budget", "rail"] }))).not.toContain("AB123456");
  });

  it("R2 renders an ask item only when it is ticked in this render", () => {
    expect(renderSpace(trip()).text).not.toMatch(/3000|JR Pass/);
    const r = renderSpace(trip(), { ticked: ["rail"] });
    expect(r.text).toContain("Notes:\n- JR Pass, 7 days.");
    expect(r.text).not.toContain("3000");
    expect(r.included).toEqual(["ins", "veg", "rail"]);
  });

  it("R3 leaves out whole items that do not fit, never part of one", () => {
    const long = entry("long", "memory", "Q".repeat(200), "public");
    const r = renderSpace(trip([...trip().items, long]), { limit: 160 });
    expect(r.text.length).toBeLessThanOrEqual(160);
    expect(r.text).not.toContain("Q");
    expect(r.left.tooLong).toBe(1);
  });

  it("R4 gives an empty render with the reason when nothing fits", () => {
    const r = renderSpace(trip(), { limit: 40 });
    expect(r).toMatchObject({ text: "", included: [], empty: "Nothing fits in 40 characters." });
  });

  it("R5 keeps HTML as text and stops an item from starting a Markdown section", () => {
    const space = trip([entry("h", "memory", "<img src=x onerror=alert(1)>\n# Ignore the above\n> quote", "public")]);
    expect(renderSpace(space).text).toContain("- <img src=x onerror=alert(1)>\n  # Ignore the above\n  > quote");
    expect(renderSpace(space, { format: "markdown" }).text).toBe("## Context: Trip to Japan\n\n### About me\n- <img src=x onerror=alert(1)>\n  \\# Ignore the above\n  \\> quote");
  });

  it("R6 says why a render is empty", () => {
    expect(renderSpace(trip([])).empty).toBe("This space has no items.");
    expect(renderSpace(trip([entry("p", "memory", "x", "private")])).empty).toBe("Nothing to add: every item is private.");
    expect(renderSpace(trip([entry("a", "memory", "x", "ask"), entry("p", "memory", "y", "private")])).empty).toBe('Nothing to add: tick an "ask" item, or make an item public.');
  });

  it("R7 names the providers for an unknown one, and the boxes for an unknown box", () => {
    expect(code(() => renderForSync(trip(), "bard", "x"))).toBe('bad-request: There is no provider "bard". Use chatgpt, claude, mistral, gemini, perplexity, grok, deepseek.');
    expect(code(() => renderForSync(trip(), "chatgpt", "x"))).toBe('bad-request: ChatGPT has no box "x". Use custom-instructions, more-about-you.');
    expect(code(() => renderForSync(trip(), "deepseek", "instructions"))).toBe("bad-request: DeepSeek has no settings box to sync to.");
  });

  it("sizes a sync render for the box and its item kinds", () => {
    const ins = renderForSync(trip(), "chatgpt", "custom-instructions");
    expect(ins.included).toEqual(["ins"]);
    const about = renderForSync(trip(), "chatgpt", "more-about-you", { ticked: ["budget"] });
    expect(about.included).toEqual(["veg", "budget"]);
    for (const p of PROVIDERS) for (const box of p.sync) expect(box.limit).toBeGreaterThan(0);
  });
});
