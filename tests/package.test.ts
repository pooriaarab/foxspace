// K1 in docs/failure-modes.md: each runtime dependency is loaded by the npm package.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
const src = new URL("../src/", import.meta.url);
const code = readdirSync(src)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => readFileSync(new URL(f, src), "utf8"))
  .join("\n");

describe("package", () => {
  it("K1 has only runtime dependencies that src/ imports", () => {
    const unused = Object.keys(pkg.dependencies).filter((name) => !code.includes(`from "${name}`));
    expect(unused).toEqual([]);
  });
});
