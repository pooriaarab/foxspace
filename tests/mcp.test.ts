// M1 and M2 in docs/failure-modes.md: the MCP server reads public items of agent-readable spaces only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp.js";
import { createSpaces, memoryStore } from "../src/index.js";

async function connect() {
  const spaces = createSpaces({ store: memoryStore() });
  const trip = await spaces.create("Trip to Japan", { agentReadable: true });
  await spaces.addItems(trip.id, [
    { kind: "instructions", text: "Plan by train.", sensitivity: "public" },
    { kind: "memory", text: "Budget 3000 CAD.", sensitivity: "ask" },
    { kind: "memory", text: "Passport AB123456.", sensitivity: "private" },
  ]);
  await spaces.setNeverShare(trip.id, ["AB123456"]);
  const work = await spaces.create("Work");
  await spaces.addItems(work.id, [{ kind: "memory", text: "Q4 plan is secret.", sensitivity: "public" }]);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer(spaces).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: Boolean(r.isError) };
  };
  return { client, call, trip };
}

describe("foxspace MCP server", () => {
  it("M2 has two read-only tools and no write tool", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).toSorted()).toEqual(["get_space", "list_spaces"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("M1 lists only agent-readable spaces, with no content", async () => {
    const { call, trip } = await connect();
    const r = await call("list_spaces");
    expect(JSON.parse(r.text)).toEqual([{ id: trip.id, name: "Trip to Japan", publicItems: 1 }]);
  });

  it("M1 gives public items only, and refuses a space that is not agent-readable", async () => {
    const { call } = await connect();
    const r = await call("get_space", { space: "trip to japan" });
    expect(r).toEqual({ text: 'Context for this chat, from my foxspace "Trip to Japan":\n\nInstructions:\nPlan by train.', isError: false });
    expect(await call("get_space", { space: "Work" })).toEqual({ text: 'foxspace: Space "Work" is not agent-readable. The user can mark it agent-readable in foxspace.', isError: true });
    expect(await call("get_space", { space: "Nope" })).toEqual({ text: 'foxspace: There is no space "Nope".', isError: true });
  });
});
