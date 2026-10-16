// A fake `browser` for the extension scripts: storage in memory, and the
// listeners each script adds, so a test can call them as Firefox would.
type Listener = (...args: never[]) => unknown;

function area() {
  const data: Record<string, unknown> = {};
  return {
    get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async (key: string) => void delete data[key],
  };
}

export function fakeBrowser() {
  const listeners: Record<string, Listener[]> = {};
  const event = (name: string) => ({ addListener: (fn: Listener) => void (listeners[name] ??= []).push(fn) });
  const browser = {
    storage: { local: area(), session: area() },
    runtime: {
      id: "foxspace@pooriaarab",
      getURL: (path: string) => `moz-extension://fox/${path}`,
      sendMessage: async (_message: unknown): Promise<unknown> => undefined,
      onMessage: event("runtime.onMessage"),
      onInstalled: event("runtime.onInstalled"),
    },
    tabs: { query: async () => [], sendMessage: async (..._args: unknown[]): Promise<unknown> => undefined },
    commands: { onCommand: event("commands.onCommand") },
  };
  return { browser, listeners };
}

/** The sender of a message from one of the extension's own pages. */
export const ownPage = (path: string, tab?: { id: number; url: string }) => ({ id: "foxspace@pooriaarab", url: `moz-extension://fox/${path}`, tab });
