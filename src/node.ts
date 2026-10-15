// foxspace/node: the file store that the CLI and the MCP server use.
// The file is $FOXSPACE_HOME/spaces.json, default ~/.foxspace/spaces.json.
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { FoxspaceError } from "./errors.js";
import { MAX_IMPORT_BYTES } from "./import.js";
import { createSpaces, type Spaces } from "./spaces.js";
import type { SpaceStore } from "./store.js";

/** The directory that holds spaces.json. */
export function spacesHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.FOXSPACE_HOME || join(homedir(), ".foxspace");
}

/** The path of the store file. */
export const spacesPath = (env: NodeJS.ProcessEnv = process.env) => join(spacesHome(env), "spaces.json");

/**
 * A store in one JSON file. A write goes to a temp file first and then
 * replaces the old file, so a crash never leaves half a file. A directory
 * that foxspace makes is 0700; it never changes the mode of one that exists.
 * The file is 0600. A file that is not JSON fails loudly; foxspace never
 * writes over it.
 */
export function fileStore(path: string): SpaceStore {
  return {
    async read() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      if (text.length > MAX_IMPORT_BYTES * 8) throw new FoxspaceError("bad-store", `${path} is too large to be a foxspace store.`);
      try {
        return JSON.parse(text);
      } catch {
        throw new FoxspaceError("bad-store", `${path} is not valid JSON. foxspace did not change it. Fix it or move it away.`);
      }
    },
    async write(state) {
      // mkdir gives the first directory it made, or undefined when all exist.
      if (await mkdir(dirname(path), { recursive: true, mode: 0o700 })) await chmod(dirname(path), 0o700);
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
  };
}

/** createSpaces on the file store at $FOXSPACE_HOME/spaces.json. */
export function openSpaces(options: { env?: NodeJS.ProcessEnv } = {}): Spaces {
  return createSpaces({ store: fileStore(spacesPath(options.env)) });
}
