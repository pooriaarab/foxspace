// C1-C3 in docs/failure-modes.md: the foxspace command.
import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { openSpaces } from "../src/node.js";

const ARCHIVE = fileURLToPath(new URL("fixtures/foxcache-archive.json", import.meta.url));

async function setup() {
  const env = { FOXSPACE_HOME: await mkdtemp(join(tmpdir(), "fsp-cli-")) };
  const run = async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await runCli(argv, { env, out: (t) => (out += t), err: (t) => (err += t), stdin: async () => "plan a quiet week" });
    return { code, out, err };
  };
  return { env, run };
}

describe("foxspace command", () => {
  it("C1 exits 2 with the usage on bad usage", async () => {
    const { run } = await setup();
    for (const argv of [[], ["fly"], ["show"], ["list", "--for", "chatgpt"], ["render", "Trip", "--box", "x"], ["list", "--nope"]]) {
      const r = await run(...argv);
      expect([r.code, r.err.includes("Usage: foxspace")], argv.join(" ")).toEqual([2, true]);
    }
    expect((await run("--help")).code).toBe(0);
  });

  it("imports a foxcache archive into a named space and lists it", async () => {
    const { run } = await setup();
    expect(await run("import", ARCHIVE, "--into", "Trip to Japan")).toEqual({ code: 0, out: 'Added 5 items to "Trip to Japan". Not read: chats.\n', err: "" });
    expect((await run("import", ARCHIVE, "--into", "Trip to Japan")).out).toBe('Added 0 items to "Trip to Japan" (5 already there). Not read: chats.\n');
    expect((await run("list")).out).toMatch(/^[0-9a-f]{10} {2}Trip to Japan {2}\(5 items\)\n$/);
  });

  it("C2 masks private text in show", async () => {
    const { run } = await setup();
    await run("import", ARCHIVE, "--into", "Trip");
    const r = await run("show", "trip");
    expect(r.out).toContain("(private, 31 characters)");
    expect(r.out).not.toContain("AB123456");
    expect(r.out).toContain("I am vegetarian and I do not drink alcohol.");
  });

  it("renders for a composer and for a provider box, with ticks", async () => {
    const { env, run } = await setup();
    await run("import", ARCHIVE, "--into", "Trip");
    const space = await openSpaces({ env }).get("Trip");
    const budget = space.items.find((i) => i.text.includes("3000"))!;
    const plain = await run("render", "Trip");
    expect(plain.out).toContain("- I am vegetarian");
    expect(plain.out).not.toMatch(/3000|AB123456/);
    expect(plain.err).toBe("Left out: 1 private, 2 not ticked.\n");
    expect((await run("render", "Trip", "--tick", budget.id)).out).toContain("3000 CAD");
    const sync = await run("render", "Trip", "--for", "chatgpt", "--box", "more-about-you", "--markdown");
    expect(sync.out).toMatch(/^## Context: Trip\n/);
    expect((await run("render", "Trip", "--for", "chatgpt")).code).toBe(1);
    expect((await run("render", "Trip", "--for", "deepseek")).err).toBe("foxspace: DeepSeek has no settings box to sync to.\n");
  });

  it("C3 guard exits 3 with the term, and 0 when clean", async () => {
    const { env, run } = await setup();
    const spaces = openSpaces({ env });
    const s = await spaces.create("Trip");
    await spaces.setNeverShare(s.id, ["AB123456"]);
    expect(await run("guard", "plan", "a", "trip")).toEqual({ code: 0, out: "Clean: no never-share term.\n", err: "" });
    expect(await run("guard", "pass:", "AB123456")).toEqual({ code: 3, out: 'Stop: "AB123456" (never share, from Trip).\n', err: "" });
    expect((await run("guard", "-")).code).toBe(0);
  });

  it("fails with exit 1 and the reason on a bad file", async () => {
    const { env, run } = await setup();
    const bad = join(env.FOXSPACE_HOME, "bad.json");
    await writeFile(bad, '{"format":"nope"}');
    const r = await run("import", bad);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^foxspace: The import is not valid: it is not one of /);
    expect((await run("show", "Nope")).err).toBe('foxspace: There is no space "Nope".\n');
  });

  it("I1 refuses a huge file by its size, before it reads it", async () => {
    const { env, run } = await setup();
    const huge = join(env.FOXSPACE_HOME, "huge.json");
    await writeFile(huge, "");
    await truncate(huge, 3 * 1024 ** 3); // sparse: no disk used
    expect(await run("import", huge)).toEqual({ code: 1, out: "", err: "foxspace: The import is larger than 1024 KB.\n" });
  });

  it("I10 adds nothing when an import breaks a space limit", async () => {
    const { env, run } = await setup();
    const prefs = join(env.FOXSPACE_HOME, "prefs.json");
    const terms = Array.from({ length: 101 }, (_, i) => `secret ${i}`);
    await writeFile(prefs, JSON.stringify({ format: "foxprefs/v1", values: { "food.diet": "vegetarian", "rules.neverShare": terms }, sensitivity: {} }));
    await run("import", ARCHIVE, "--into", "Trip");
    const r = await run("import", prefs, "--into", "Trip");
    expect([r.code, r.err]).toEqual([1, 'foxspace: Space "Trip" has 101 never-share terms; the limit is 100.\n']);
    expect((await run("list")).out).toMatch(/ {2}Trip {2}\(5 items\)\n$/);
    const pack = join(env.FOXSPACE_HOME, "pack.json");
    await writeFile(pack, JSON.stringify({ format: "foxpack/v1", memories: Array.from({ length: 301 }, (_, i) => `Memory ${i}`) }));
    expect((await run("import", pack)).code).toBe(1);
    expect((await run("list")).out).not.toContain("Imported from foxpack");
  });
});
