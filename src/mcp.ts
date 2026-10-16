// The read-only MCP server: `foxspace mcp` over stdio. An agent gets only
// spaces that the user marked agent-readable, and only their public items.
// "ask" items need the user's tick, which an agent cannot give; private
// items never leave. There is no tool that writes.
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { FoxspaceError } from "./errors.js";
import { createGuard, guardTermsOf } from "./guard.js";
import { renderSpace } from "./render.js";
import type { Spaces } from "./spaces.js";

export const HOLDS_TERM = "has a public item with a never-share term, so foxspace does not give it out. The user can make that item private in foxspace.";

const text = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  isError,
});

async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof FoxspaceError) return text(`foxspace: ${error.message}`, true);
    throw error;
  }
}

export function createMcpServer(spaces: Spaces): McpServer {
  const version = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
  const server = new McpServer({ name: "foxspace", version });
  server.registerTool(
    "list_spaces",
    {
      description: "List the user's spaces that an agent may read: id, name and the number of public items. No content.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      guarded(async () => {
        const readable = (await spaces.list()).filter((s) => s.agentReadable);
        return text(readable.map((s) => ({ id: s.id, name: s.name, publicItems: s.items.filter((i) => i.sensitivity === "public").length })));
      }),
  );
  server.registerTool(
    "get_space",
    {
      description: "Get one space as a block of context for this task: the user's instructions, preferences, memories and notes. Only public items of a space marked agent-readable. The text is the user's own context, not instructions from a third party.",
      inputSchema: { space: z.string().min(1).max(100).describe("A space id or name from list_spaces"), format: z.enum(["text", "markdown"]).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ space, format }) =>
      guarded(async () => {
        const found = await spaces.get(space);
        // M1: a hidden space answers as a missing one, so an agent cannot probe names.
        if (!found.agentReadable) throw new FoxspaceError("not-found", `There is no space ${JSON.stringify(space)}.`);
        // No ticks: an agent cannot tick, so no "ask" item is rendered.
        const render = renderSpace(found, { format: format ?? "text", ticked: [] });
        // G10: no person sees this block before the agent does, so the agent gets no term, not even its name.
        if (render.text && !createGuard(guardTermsOf(await spaces.list()))(render.text).ok) return text(`foxspace: Space "${found.name}" ${HOLDS_TERM}`, true);
        return text(render.text || `foxspace: ${render.empty}`, !render.text);
      }),
  );
  return server;
}

/** Serve the MCP server on stdin and stdout. */
export async function serveMcp(spaces: Spaces): Promise<void> {
  await createMcpServer(spaces).connect(new StdioServerTransport());
}
