// The spaces object: read and change the user's spaces. Calls run one at a
// time, every change is checked as a whole before it is written, and every
// value that leaves is a copy.
import { FoxspaceError } from "./errors.js";
import { FORMAT, LIMITS, checkItem, checkSensitivity, checkState, checkTerm, newId } from "./schema.js";
import type { ItemKind, Sensitivity, Space, SpaceItem, SpacesState } from "./schema.js";
import type { SpaceStore } from "./store.js";

export interface NewItem {
  kind: ItemKind;
  text: string;
  sensitivity?: Sensitivity;
  source?: string;
}

export interface ItemPatch {
  kind?: ItemKind;
  text?: string;
  sensitivity?: Sensitivity;
}

export interface SpacesOptions {
  store: SpaceStore;
  now?: () => number;
}

export interface Spaces {
  list(): Promise<Space[]>;
  /** A space by its id, or by its name (any case). */
  get(idOrName: string): Promise<Space>;
  create(name: string, opts?: { agentReadable?: boolean }): Promise<Space>;
  rename(id: string, name: string): Promise<Space>;
  setAgentReadable(id: string, agentReadable: boolean): Promise<Space>;
  remove(id: string): Promise<void>;
  /** Add items. An item with the same kind and text as one in the space is skipped. */
  addItems(id: string, items: NewItem[]): Promise<{ added: SpaceItem[]; skipped: number }>;
  updateItem(id: string, itemId: string, patch: ItemPatch): Promise<SpaceItem>;
  removeItem(id: string, itemId: string): Promise<void>;
  /** Replace the never-share terms. */
  setNeverShare(id: string, terms: string[]): Promise<Space>;
  /** Add never-share terms that the space does not have yet. */
  addNeverShare(id: string, terms: string[]): Promise<Space>;
  /**
   * Add spaces from a foxspace/v1 file as new spaces, with new ids. A taken
   * name gets " (2)". An added space is never agent-readable: the user opts
   * in again (I9).
   */
  addSpaces(spaces: Space[]): Promise<Space[]>;
  /** The whole record, which is also the export format. */
  export(): Promise<SpacesState>;
}

const empty = (now: number): SpacesState => ({ format: FORMAT, spaces: [], updatedAt: new Date(now).toISOString() });
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const find = (state: SpacesState, idOrName: string): Space => {
  const space = state.spaces.find((s) => s.id === idOrName) ?? state.spaces.find((s) => same(s.name, idOrName));
  if (!space) throw new FoxspaceError("not-found", `There is no space ${JSON.stringify(idOrName)}.`);
  return space;
};
const findItem = (space: Space, itemId: string): SpaceItem => {
  const item = space.items.find((i) => i.id === itemId);
  if (!item) throw new FoxspaceError("not-found", `Space "${space.name}" has no item ${JSON.stringify(itemId)}.`);
  return item;
};
const touch = (space: Space, stamp: string) => {
  space.updatedAt = stamp;
  return space;
};

export function createSpaces(options: SpacesOptions): Spaces {
  const { store } = options;
  const now = options.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function load(): Promise<SpacesState> {
    const raw = await store.read();
    return raw === undefined ? empty(now()) : checkState(raw, "bad-store");
  }


  /** Load, change a copy, check the whole result, write it. fn returns what the call gives back. */
  const change = <T>(fn: (state: SpacesState, stamp: string) => T): Promise<T> =>
    serial(async () => {
      const next = structuredClone(await load());
      const stamp = new Date(now()).toISOString();
      const result = fn(next, stamp);
      next.updatedAt = stamp;
      const checked = checkState(next, "bad-space");
      await store.write(checked);
      return structuredClone(result);
    });

  const spaces: Spaces = {
    list: () => serial(async () => (await load()).spaces),
    get: (idOrName) => serial(async () => find(await load(), idOrName)),
    create: (name, opts = {}) =>
      change((state, stamp) => {
        if (state.spaces.length >= LIMITS.spaces) throw new FoxspaceError("bad-space", `You have ${LIMITS.spaces} spaces; that is the limit.`);
        const clean = typeof name === "string" ? name.trim() : name;
        if (state.spaces.some((s) => typeof clean === "string" && same(s.name, clean))) throw new FoxspaceError("bad-space", `A space named "${clean}" exists already.`);
        const space: Space = { id: newId(), name: clean, items: [], neverShare: [], agentReadable: opts.agentReadable === true, createdAt: stamp, updatedAt: stamp };
        state.spaces.push(space);
        return space;
      }),
    rename: (id, name) =>
      change((state, stamp) => {
        const space = find(state, id);
        if (state.spaces.some((s) => s !== space && typeof name === "string" && same(s.name, name))) throw new FoxspaceError("bad-space", `A space named "${name.trim()}" exists already.`);
        space.name = typeof name === "string" ? name.trim() : name;
        return touch(space, stamp);
      }),
    setAgentReadable: (id, agentReadable) =>
      change((state, stamp) => {
        const space = find(state, id);
        space.agentReadable = agentReadable;
        return touch(space, stamp);
      }),
    remove: (id) =>
      change((state) => {
        const space = find(state, id);
        state.spaces = state.spaces.filter((s) => s !== space);
      }),
    addItems: (id, items) =>
      change((state, stamp) => {
        const space = find(state, id);
        if (!Array.isArray(items)) throw new FoxspaceError("bad-space", "Items must be a list.");
        const added: SpaceItem[] = [];
        let skipped = 0;
        for (const [i, raw] of items.entries()) {
          const item = checkItem({ ...raw, id: newId() }, `New item ${i + 1}`);
          if ([...space.items, ...added].some((x) => x.kind === item.kind && x.text.trim() === item.text.trim())) skipped++;
          else added.push(item);
        }
        space.items.push(...added);
        touch(space, stamp);
        return { added, skipped };
      }),
    updateItem: (id, itemId, patch) =>
      change((state, stamp) => {
        const space = find(state, id);
        const item = findItem(space, itemId);
        if (patch.sensitivity !== undefined) checkSensitivity(patch.sensitivity, `Item ${itemId}`);
        const next = checkItem({ ...item, ...patch }, `Item ${itemId}`);
        space.items[space.items.indexOf(item)] = next;
        touch(space, stamp);
        return next;
      }),
    removeItem: (id, itemId) =>
      change((state, stamp) => {
        const space = find(state, id);
        const item = findItem(space, itemId);
        space.items = space.items.filter((i) => i !== item);
        touch(space, stamp);
      }),
    setNeverShare: (id, terms) =>
      change((state, stamp) => {
        const space = find(state, id);
        if (!Array.isArray(terms)) throw new FoxspaceError("bad-space", "Never-share terms must be a list.");
        space.neverShare = unique(terms.map((t, i) => checkTerm(t, `Never-share term ${i + 1}`)));
        return touch(space, stamp);
      }),
    addNeverShare: (id, terms) =>
      change((state, stamp) => {
        const space = find(state, id);
        if (!Array.isArray(terms)) throw new FoxspaceError("bad-space", "Never-share terms must be a list.");
        space.neverShare = unique([...space.neverShare, ...terms.map((t, i) => checkTerm(t, `Never-share term ${i + 1}`))]);
        return touch(space, stamp);
      }),
    addSpaces: (incoming) =>
      change((state, stamp) => {
        if (state.spaces.length + incoming.length > LIMITS.spaces) throw new FoxspaceError("bad-space", `That would make more than ${LIMITS.spaces} spaces.`);
        const added = incoming.map((s) => {
          let name = s.name;
          for (let n = 2; state.spaces.some((x) => same(x.name, name)); n++) name = `${s.name.slice(0, LIMITS.name - 5)} (${n})`;
          const space: Space = { ...structuredClone(s), id: newId(), name, items: s.items.map((i) => ({ ...i, id: newId() })), agentReadable: false, createdAt: stamp, updatedAt: stamp };
          state.spaces.push(space);
          return space;
        });
        return added;
      }),
    export: () => serial(load),
  };
  return Object.freeze(spaces);
}

/** Keep the first of terms that differ only in case. */
function unique(terms: string[]): string[] {
  const seen = new Set<string>();
  return terms.filter((t) => !seen.has(t.toLowerCase()) && Boolean(seen.add(t.toLowerCase())));
}
