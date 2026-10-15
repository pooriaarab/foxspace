// @vitest-environment happy-dom
// A13 in docs/failure-modes.md: the read-back after an insert. The E2E checks it against real editors.
import { describe, expect, it } from "vitest";
import { holds } from "../src/composer.js";

const BLOCK = 'Context for this chat, from my foxspace "Trip":\n\nAbout me:\n- Plan by train.\n- 3000 CAD budget';
const box = (value: string) => Object.assign(document.createElement("textarea"), { value });

describe("holds", () => {
  it("holds a block whose lines are there, before the user's text", () => {
    expect(holds(box(`${BLOCK}\n\nhello world`), BLOCK)).toBe(true);
  });

  it("holds a block when the editor spaces its paragraphs out", () => {
    expect(holds(box(BLOCK.replaceAll("\n", "\n\n")), BLOCK)).toBe(true);
  });

  it("does not hold a block whose lines ran together", () => {
    expect(holds(box(BLOCK.replaceAll("\n", "")), BLOCK)).toBe(false);
  });

  it("does not hold a block glued to the user's text", () => {
    expect(holds(box(`${BLOCK}hello world`), BLOCK)).toBe(false);
  });

  it("does not hold a block that lost a line", () => {
    expect(holds(box(BLOCK.replace("- Plan by train.\n", "")), BLOCK)).toBe(false);
  });
});
