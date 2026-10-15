// N1 and N2 in docs/failure-modes.md: the file store at FOXSPACE_HOME.
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FoxspaceError } from "../src/index.js";
import { fileStore, openSpaces, spacesHome, spacesPath } from "../src/node.js";

const home = async () => join(await mkdtemp(join(tmpdir(), "fsp-")), "home");

describe("file store", () => {
  it("uses FOXSPACE_HOME, else ~/.foxspace", () => {
    expect(spacesPath({ FOXSPACE_HOME: "/x" })).toBe("/x/spaces.json");
    expect(spacesHome({})).toMatch(/\.foxspace$/);
  });

  it("writes the record with a 0700 directory and a 0600 file", async () => {
    const env = { FOXSPACE_HOME: await home() };
    await openSpaces({ env }).create("Trip");
    expect((await stat(env.FOXSPACE_HOME)).mode & 0o777).toBe(0o700);
    expect((await stat(spacesPath(env))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(spacesPath(env), "utf8")).spaces[0].name).toBe("Trip");
    expect((await openSpaces({ env }).list()).map((s) => s.name)).toEqual(["Trip"]);
  });

  it("N1 fails on a file that is not JSON and leaves it as it is", async () => {
    const env = { FOXSPACE_HOME: await home() };
    await mkdir(env.FOXSPACE_HOME, { recursive: true });
    await writeFile(spacesPath(env), "{ not json");
    const error = await openSpaces({ env }).create("Trip").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FoxspaceError);
    expect((error as FoxspaceError).message).toBe(`${spacesPath(env)} is not valid JSON. foxspace did not change it. Fix it or move it away.`);
    expect(await readFile(spacesPath(env), "utf8")).toBe("{ not json");
  });

  it("N2 removes the temp file when the rename fails", async () => {
    const dir = await home();
    await mkdir(join(dir, "spaces.json"), { recursive: true }); // a directory where the file goes: rename fails
    const store = fileStore(join(dir, "spaces.json"));
    await expect(store.write({ format: "foxspace/v1", spaces: [], updatedAt: "2026-10-15T00:00:00.000Z" })).rejects.toThrow();
    expect((await readdir(dir)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
