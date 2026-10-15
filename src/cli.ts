// The foxspace command. runCli takes the arguments and the output streams,
// so tests run it in process. Exit codes: 0 done, 1 a foxspace error,
// 2 bad usage, 3 the guard found a never-share term.
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { FoxspaceError } from "./errors.js";
import { createGuard } from "./guard.js";
import { MAX_IMPORT_BYTES, parseImport } from "./import.js";
import { openSpaces } from "./node.js";
import { providerById } from "./providers.js";
import { renderForSync, renderSpace } from "./render.js";
import type { Space } from "./schema.js";
import type { Spaces } from "./spaces.js";

export const USAGE = `Usage: foxspace <command>

  list                          Print each space: id, name, items, agent-readable
  show <space>                  Print the items of a space (private text is masked)
  render <space> [--markdown] [--tick <item>...]
                                Print the block the picker inserts into a composer
  render <space> --for <provider> [--box <box>] [--markdown] [--tick <item>...]
                                Print the text for a provider settings box (Sync)
  import <file> [--into <space>]
                                Add a foxspace, foxcache, foxpack or foxprefs export
  guard <text...>               Check text against every never-share term; - reads stdin
  mcp                           Serve the read-only MCP server on stdio

<space> is a space id or name. "ask" items go in only with --tick <item id>.
Providers: chatgpt, claude, mistral, gemini, perplexity, grok, deepseek.
The store is $FOXSPACE_HOME/spaces.json (default ~/.foxspace/spaces.json).
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env?: NodeJS.ProcessEnv;
  stdin?: () => Promise<string>;
}

class UsageError extends Error {}

const need = (args: string[], min: number, max = min) => {
  if (args.length < min || args.length > max) throw new UsageError("wrong number of arguments");
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function show(space: Space): string {
  const lines = [`${space.name} (${space.id})${space.agentReadable ? ", agent-readable" : ""}`];
  for (const i of space.items) {
    const text = i.sensitivity === "private" ? `(private, ${i.text.length} characters)` : i.text.replace(/\n/g, "\n                              ");
    lines.push(`  ${i.id}  ${i.kind.padEnd(12)} ${i.sensitivity.padEnd(7)}  ${text}`);
  }
  if (space.items.length === 0) lines.push("  (no items)");
  lines.push(`  Never-share terms: ${space.neverShare.length} (not shown)`);
  return `${lines.join("\n")}\n`;
}

async function importFile(spaces: Spaces, file: string, into: string | undefined): Promise<string> {
  let text: string;
  try {
    await using handle = await open(file);
    // I1: the size decides before a byte is read.
    if ((await handle.stat()).size > MAX_IMPORT_BYTES) throw new FoxspaceError("too-large", `The import is larger than ${MAX_IMPORT_BYTES / 1024} KB.`);
    text = await handle.readFile("utf8");
  } catch (error) {
    if (error instanceof FoxspaceError) throw error;
    throw new FoxspaceError("bad-import", `Cannot read ${file}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`);
  }
  const result = parseImport(text);
  if (result.format === "foxspace/v1") {
    if (into) throw new UsageError("--into does not apply to a foxspace/v1 file; it adds whole spaces");
    const added = await spaces.addSpaces(result.spaces);
    return `Added ${added.length} space${added.length === 1 ? "" : "s"}: ${added.map((s) => s.name).join(", ") || "none"}.\n`;
  }
  const name = into ?? `Imported from ${result.format.split("/")[0]}`;
  const { space, added, skipped } = await spaces.importInto(name, result.items, result.neverShare, { create: true });
  const notes = [`Added ${added.length} item${added.length === 1 ? "" : "s"} to "${space.name}"${skipped ? ` (${skipped} already there)` : ""}.`];
  if (result.neverShare.length) notes.push(`Added ${result.neverShare.length} never-share term${result.neverShare.length === 1 ? "" : "s"}.`);
  if (result.ignored.length) notes.push(`Not read: ${result.ignored.join(", ")}.`);
  return `${notes.join(" ")}\n`;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: { for: { type: "string" }, box: { type: "string" }, markdown: { type: "boolean" }, tick: { type: "string", multiple: true }, into: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (error) {
    io.err(`foxspace: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const [command, ...args] = parsed.positionals;
  const flags = parsed.values;
  if (flags.help || command === "help" || !command) {
    (command || flags.help ? io.out : io.err)(USAGE);
    return command || flags.help ? 0 : 2;
  }
  const spaces = openSpaces({ env: io.env });
  try {
    const renderFlags = flags.for !== undefined || flags.box !== undefined || flags.markdown || flags.tick;
    if (renderFlags && command !== "render") throw new UsageError(`that flag does not apply to ${command}`);
    if (flags.into !== undefined && command !== "import") throw new UsageError(`--into does not apply to ${command}`);
    if (flags.box !== undefined && flags.for === undefined) throw new UsageError("--box needs --for <provider>");
    switch (command) {
      case "list":
        need(args, 0);
        for (const s of await spaces.list()) io.out(`${s.id}  ${s.name}  (${s.items.length} item${s.items.length === 1 ? "" : "s"}${s.agentReadable ? ", agent-readable" : ""})\n`);
        return 0;
      case "show":
        need(args, 1);
        io.out(show(await spaces.get(args[0]!)));
        return 0;
      case "render": {
        need(args, 1);
        const space = await spaces.get(args[0]!);
        const opts = { ticked: flags.tick ?? [], format: flags.markdown ? ("markdown" as const) : ("text" as const) };
        let render;
        if (flags.for === undefined) render = renderSpace(space, opts);
        else {
          const box = flags.box ?? providerById(flags.for)?.sync[0]?.id ?? "";
          render = renderForSync(space, flags.for, box, opts);
        }
        if (!render.text) throw new FoxspaceError("bad-request", render.empty ?? "Nothing to render.");
        io.out(`${render.text}\n`);
        const left = render.left;
        const notes = [left.private && `${left.private} private`, left.unticked && `${left.unticked} not ticked`, left.tooLong && `${left.tooLong} too long`].filter(Boolean);
        if (notes.length) io.err(`Left out: ${notes.join(", ")}.\n`);
        return 0;
      }
      case "import":
        need(args, 1);
        io.out(await importFile(spaces, args[0]!, flags.into));
        return 0;
      case "guard": {
        if (args.length === 0) throw new UsageError("guard needs text, or - to read stdin");
        const text = args.length === 1 && args[0] === "-" ? await (io.stdin ?? readStdin)() : args.join(" ");
        const terms = (await spaces.list()).flatMap((s) => s.neverShare.map((term) => ({ term, from: s.name })));
        const result = createGuard(terms)(text);
        if (result.ok) {
          io.out("Clean: no never-share term.\n");
          return 0;
        }
        if (result.tooLong) io.out("Stop: the text is too long to check.\n");
        for (const m of result.matches) io.out(`Stop: "${m.term}" (never share, from ${m.from}).\n`);
        return 3;
      }
      case "mcp": {
        need(args, 0);
        const { serveMcp } = await import("./mcp.js");
        await serveMcp(spaces);
        return 0;
      }
      default:
        throw new UsageError(`unknown command ${JSON.stringify(command)}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`foxspace: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof FoxspaceError) {
      io.err(`foxspace: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
