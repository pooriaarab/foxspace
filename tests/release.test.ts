// P1 in docs/failure-modes.md: the release jobs that hold a write or OIDC
// token run no dependency code, and no checkout keeps a token.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const [top, body = ""] = workflow.split(/^jobs:\n/m);
const jobs = Object.fromEntries(body.split(/^(?= {2}[a-z][a-z-]*:\n)/m).map((text) => [text.match(/^ {2}([a-z-]+):/)![1]!, text]));
const runsDependencies = (text: string) => /pnpm (install|exec|ci:local|build|test)|npx /.test(text);

describe("release workflow", () => {
  it("P1 grants nothing by default", () => {
    expect(top).toMatch(/^permissions: \{\}$/m);
  });

  it("P1 keeps no token in any checkout", () => {
    const checkouts = workflow.split(/(?=- uses: actions\/checkout@)/).slice(1);
    for (const step of checkouts) expect(step).toMatch(/^- uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+persist-credentials: false\n/);
  });

  it("P1 gives write and OIDC tokens only to jobs that run no dependency", () => {
    const writers = Object.entries(jobs).filter(([, text]) => /: write/.test(text));
    expect(writers.map(([name, text]) => [name, text.match(/\w[\w-]*: write/g)])).toEqual([
      ["npm", ["id-token: write"]],
      ["github-release", ["contents: write"]],
    ]);
    for (const [name, text] of writers) expect(runsDependencies(text), name).toBe(false);
    expect(runsDependencies(jobs.build!)).toBe(true);
  });
});
