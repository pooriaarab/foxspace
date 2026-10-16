// Where the spaces live. A store reads and writes one JSON record;
// createSpaces checks the record, so a store needs no logic of its own.
import type { SpacesState } from "./schema.js";

export interface SpaceStore {
  /** The stored record as plain JSON data, or undefined when there is none yet. */
  read(): Promise<unknown>;
  write(state: SpacesState): Promise<void>;
  /** Run fn while no other process changes the record. A change reads and writes inside it. */
  lock<T>(fn: () => Promise<T>): Promise<T>;
}

/** A store in memory, for tests and short-lived agents. */
export function memoryStore(initial?: SpacesState): SpaceStore {
  let state: string | undefined = initial && JSON.stringify(initial);
  return {
    read: async () => (state === undefined ? undefined : JSON.parse(state)),
    write: async (next) => {
      state = JSON.stringify(next);
    },
    lock: (fn) => fn(),
  };
}

/** The part of browser.storage.local that the store uses. */
export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** A store in a WebExtension storage area, under one key. Only the event page changes it, so the lock is the spaces queue. */
export function storageAreaStore(area: StorageAreaLike, key = "foxspace"): SpaceStore {
  return {
    read: async () => (await area.get(key))[key],
    write: (state) => area.set({ [key]: structuredClone(state) }),
    lock: (fn) => fn(),
  };
}
