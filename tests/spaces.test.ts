// S6-S10 and I7 in docs/failure-modes.md: the spaces object and its stores.
import { describe, expect, it } from "vitest";
import { FORMAT, FoxspaceError, createSpaces, memoryStore, storageAreaStore, type SpaceStore } from "../src/index.js";

const errorOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    return error instanceof FoxspaceError ? `${error.code}: ${error.message}` : `other: ${String(error)}`;
  }
  return "no error";
};

async function trip() {
  const store = memoryStore();
  const spaces = createSpaces({ store, now: () => Date.parse("2026-10-15T12:00:00Z") });
  const space = await spaces.create("Trip to Japan");
  return { store, spaces, space };
}

describe("spaces", () => {
  it("creates, finds by id or name, renames and removes", async () => {
    const { spaces, space } = await trip();
    expect(space).toMatchObject({ name: "Trip to Japan", items: [], neverShare: [], agentReadable: false, createdAt: "2026-10-15T12:00:00.000Z" });
    expect((await spaces.get("trip to japan")).id).toBe(space.id);
    expect(await errorOf(spaces.create(" trip to JAPAN "))).toBe('bad-space: A space named "trip to JAPAN" exists already.');
    await spaces.rename(space.id, "Japan, May");
    expect((await spaces.get(space.id)).name).toBe("Japan, May");
    await spaces.remove(space.id);
    expect(await spaces.list()).toEqual([]);
  });

  it("S9 names a space or an item that does not exist", async () => {
    const { spaces, space } = await trip();
    expect(await errorOf(spaces.get("Work"))).toBe('not-found: There is no space "Work".');
    expect(await errorOf(spaces.removeItem(space.id, "nope"))).toBe('not-found: Space "Trip to Japan" has no item "nope".');
  });

  it("adds items with ask by default, and I7 skips one the space has", async () => {
    const { spaces, space } = await trip();
    const first = await spaces.addItems(space.id, [{ kind: "memory", text: "I am vegetarian." }, { kind: "instructions", text: "Plan by train.", sensitivity: "public" }]);
    expect(first.added.map((i) => [i.kind, i.sensitivity])).toEqual([["memory", "ask"], ["instructions", "public"]]);
    const again = await spaces.addItems(space.id, [{ kind: "memory", text: " I am vegetarian. " }, { kind: "snippet", text: "I am vegetarian." }]);
    expect([again.added.length, again.skipped]).toEqual([1, 1]);
    expect((await spaces.get(space.id)).items).toHaveLength(3);
  });

  it("updates an item and checks the change", async () => {
    const { spaces, space } = await trip();
    const { added } = await spaces.addItems(space.id, [{ kind: "memory", text: "Passport ends 2031." }]);
    const id = added[0]!.id;
    expect((await spaces.updateItem(space.id, id, { sensitivity: "private" })).sensitivity).toBe("private");
    expect(await errorOf(spaces.updateItem(space.id, id, { sensitivity: "secret" as never }))).toBe('bad-space: Item ' + id + ' has the sensitivity "secret"; use public, ask or private.');
    expect(await errorOf(spaces.updateItem(space.id, id, { text: "" }))).toMatch(/^bad-space: Item .* text must not be empty\.$/);
    expect((await spaces.get(space.id)).items[0]).toMatchObject({ text: "Passport ends 2031.", sensitivity: "private" });
  });

  it("keeps never-share terms trimmed and unique", async () => {
    const { spaces, space } = await trip();
    await spaces.setNeverShare(space.id, [" AB123456 ", "ab123456", "Acme Corp"]);
    expect((await spaces.addNeverShare(space.id, ["acme corp", "604 555 0199"])).neverShare).toEqual(["AB123456", "Acme Corp", "604 555 0199"]);
  });

  it("S6 fails on a corrupt store and never writes over it", async () => {
    let writes = 0;
    const store: SpaceStore = { read: async () => ({ format: FORMAT, spaces: [{ id: "x" }], updatedAt: "2026-01-01" }), write: async () => void writes++ };
    const spaces = createSpaces({ store });
    expect(await errorOf(spaces.list())).toBe("bad-store: A space name must be text.");
    expect(await errorOf(spaces.create("New"))).toMatch(/^bad-store: /);
    expect(writes).toBe(0);
  });

  it("S7 runs two changes at the same time without losing one", async () => {
    const { spaces, space } = await trip();
    await Promise.all([spaces.addItems(space.id, [{ kind: "memory", text: "One" }]), spaces.addItems(space.id, [{ kind: "memory", text: "Two" }]), spaces.create("Work")]);
    expect((await spaces.get(space.id)).items.map((i) => i.text)).toEqual(["One", "Two"]);
    expect(await spaces.list()).toHaveLength(2);
  });

  it("S8 gives copies, so changing a result changes nothing stored", async () => {
    const { spaces, space } = await trip();
    space.name = "Hacked";
    const got = await spaces.get(space.id);
    got.items.push({ id: "zz", kind: "memory", text: "x", sensitivity: "public" });
    expect(await spaces.get(space.id)).toMatchObject({ name: "Trip to Japan", items: [] });
  });

  it("S10 rejects when the write fails, and keeps the old state", async () => {
    const inner = memoryStore();
    let fail = false;
    const store: SpaceStore = { read: inner.read, write: async (s) => (fail ? Promise.reject(new Error("disk full")) : inner.write(s)) };
    const spaces = createSpaces({ store });
    await spaces.create("Trip");
    fail = true;
    expect(await errorOf(spaces.create("Work"))).toBe("other: Error: disk full");
    fail = false;
    expect((await spaces.list()).map((s) => s.name)).toEqual(["Trip"]);
  });

  it("stores in a WebExtension storage area under one key", async () => {
    const data: Record<string, unknown> = {};
    const area = { get: async (k: string) => ({ [k]: data[k] }), set: async (items: Record<string, unknown>) => void Object.assign(data, items) };
    const spaces = createSpaces({ store: storageAreaStore(area) });
    await spaces.create("Trip");
    expect(Object.keys(data)).toEqual(["foxspace"]);
    expect((data.foxspace as { format: string }).format).toBe(FORMAT);
  });
});
