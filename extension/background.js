// The event page. It owns the spaces in storage.local, renders them, checks
// outgoing messages against never-share terms and keeps the trail of
// injections. Firefox unloads it when idle; all state is in storage, so a
// wake is safe (X1).
//
// Two kinds of sender, checked on every message (A5):
// - this extension's own pages: the spaces and sync pages, the popup, and
//   the picker and guard frames that the content script puts in a chat page;
// - the content script, in the top frame of a supported chat site. It may
//   only ask for a guard check and report a send; it never gets a space.
import { IdbStore, Log, idbKey } from "foxtrail";
import { FoxspaceError, INJECT_LIMIT, createGuard, createSpaces, parseImport, parsePaste, providerForHost, renderForSync, renderSpace, siteForHost, storageAreaStore } from "../src/index.ts";

export const spaces = createSpaces({ store: storageAreaStore(browser.storage.local) });

// The trail: one foxtrail entry per injection, in IndexedDB, kept in this browser.
let trail;
const openTrail = () => (trail ??= (async () => new Log({ store: await IdbStore.open("foxspace-trail"), key: await idbKey("foxspace-trail") }))());
async function record(entry) {
  try {
    await (await openTrail()).append({ actor: "user", ...entry });
    await browser.storage.local.set({ trailError: null });
  } catch (error) {
    // X3: the insert stands; the spaces page shows that the trail failed.
    await browser.storage.local.set({ trailError: String(error instanceof Error ? error.message : error) });
  }
}

const tabSite = (tab) => {
  try {
    return siteForHost(new URL(tab?.url ?? "").host);
  } catch {
    return undefined;
  }
};

/** What the picker frame may show: no private item text, ever. */
const forPicker = (s) => ({ id: s.id, name: s.name, items: s.items.filter((i) => i.sensitivity !== "private").map(({ id, kind, text, sensitivity }) => ({ id, kind, text, sensitivity })), privateCount: s.items.filter((i) => i.sensitivity === "private").length });

const held = browser.storage.session;
const tokenOf = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
const toTop = (tabId, message) => browser.tabs.sendMessage(tabId, message, { frameId: 0 });

// A short private item guards itself: typing it into a chat stops the send too.
const PRIVATE_TERM_CHARS = 80;
const termsOf = (all) =>
  all.flatMap((s) => [
    ...s.neverShare.map((term) => ({ term, from: s.name })),
    ...s.items.filter((i) => i.sensitivity === "private" && i.text.length <= PRIVATE_TERM_CHARS).map((i) => ({ term: i.text.replace(/[.\s]+$/, ""), from: `${s.name}, private item` })),
  ]);

/** The block for a pick, and the never-share terms in it: an item can hold one (G10). */
async function block(id, ticked) {
  const [space, all] = await Promise.all([spaces.get(id), spaces.list()]);
  const render = renderSpace(space, { ticked, limit: INJECT_LIMIT });
  return { space, render, stops: createGuard(termsOf(all))(render.text).matches };
}

async function importInto({ text, into }) {
  const result = parseImport(text);
  if (result.format === "foxspace/v1") return { format: result.format, spaces: (await spaces.addSpaces(result.spaces)).map((s) => s.name) };
  const name = `Imported from ${result.format.split("/")[0]}`;
  const { space, added, skipped } = await spaces.importInto(into || name, result.items, result.neverShare, { create: !into });
  return { format: result.format, space: space.name, added: added.length, skipped, terms: result.neverShare.length, ignored: result.ignored };
}

/** The messages that the extension's own pages send. */
export const pageHandlers = {
  "spaces:list": () => spaces.list(),
  "spaces:create": ({ name }) => spaces.create(name),
  "spaces:rename": ({ id, name }) => spaces.rename(id, name),
  "spaces:agent": ({ id, agentReadable }) => spaces.setAgentReadable(id, agentReadable === true),
  "spaces:remove": ({ id }) => spaces.remove(id),
  "spaces:add": ({ id, items }) => spaces.addItems(id, items),
  "spaces:paste": ({ id, text, kind, sensitivity }) => spaces.addItems(id, parsePaste(text, kind, sensitivity)),
  "spaces:item": ({ id, itemId, patch }) => spaces.updateItem(id, itemId, patch),
  "spaces:remove-item": ({ id, itemId }) => spaces.removeItem(id, itemId),
  "spaces:never-share": ({ id, terms }) => spaces.setNeverShare(id, terms),
  "spaces:import": importInto,
  "spaces:export": () => spaces.export(),
  "sync:render": async ({ id, provider, box, ticked, format }) => renderForSync(await spaces.get(id), provider, box, { ticked, format }),
  "trail:list": async () => {
    const log = await openTrail();
    const [entries, check, { trailError }] = await Promise.all([log.entries(), log.verify(), browser.storage.local.get("trailError")]);
    return { entries: entries.slice(-20).toReversed().map((e) => ({ ts: e.ts, kind: e.kind, data: e.data })), ok: check.ok, error: trailError ?? null };
  },
  // The picker frame lives in a chat tab; sender.tab is that tab.
  "picker:state": async (_, sender) => {
    const site = tabSite(sender.tab);
    if (!site) throw new FoxspaceError("bad-request", "Open a supported chat site to add a space.");
    return { site: site.host, label: providerForHost(site.host)?.label ?? site.host, spaces: (await spaces.list()).map(forPicker) };
  },
  // What the user has typed in the composer, so the picker can offer it as a new item.
  "picker:draft": async (_, sender) => (await toTop(sender.tab.id, { type: "foxspace:read-composer" }).catch(() => undefined))?.text ?? "",
  // The picker frame gets the never-share terms that the block holds (G10); the page never does.
  "picker:render": async ({ id, ticked }) => {
    const { render, stops } = await block(id, ticked);
    return { ...render, stops };
  },
  "picker:insert": async ({ id, ticked }, sender) => {
    const site = tabSite(sender.tab);
    if (!site) throw new FoxspaceError("bad-request", "Open a supported chat site to add a space.");
    const { space, render, stops } = await block(id, ticked);
    if (!render.text) throw new FoxspaceError("bad-request", render.empty);
    if (stops.length) throw new FoxspaceError("bad-request", `This block holds a never-share term: ${stops.map((m) => `"${m.term}"`).join(", ")}. Untick that item, or make it private.`);
    const result = await toTop(sender.tab.id, { type: "foxspace:insert", text: render.text });
    if (result?.ok && result.landed) await record({ kind: "space.inject", data: { space: space.name, site: site.host, items: render.included.length } });
    return { ...result, items: render.included.length };
  },
  // The popup and the shortcut open the picker on the active tab.
  "popup:open-picker": () => openPicker(),
  "picker:close": (_, sender) => toTop(sender.tab.id, { type: "foxspace:close-picker" }),
  "guard:matches": async ({ token }) => (await held.get(token))[token] ?? null,
  "guard:decide": async ({ token, choice }, sender) => {
    if (choice !== "send" && choice !== "edit") throw new FoxspaceError("bad-request", "The choice must be send or edit.");
    await held.remove(token);
    return toTop(sender.tab.id, { type: "foxspace:guard-decision", token, choice });
  },
};

async function openPicker() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  // Without a content script in the tab, sendMessage fails: not a chat site.
  return toTop(tab.id, { type: "foxspace:open-picker" }).catch(() => {
    throw new FoxspaceError("bad-request", "Open a supported chat site to add a space.");
  });
}
browser.commands.onCommand.addListener((name) => {
  if (name === "open-picker") openPicker().catch(() => {});
});

/** The messages that the content script sends. It gets a yes or a token, never a term (G8). */
export const contentHandlers = {
  "content:guard": async ({ text }) => {
    if (typeof text !== "string") throw new FoxspaceError("bad-request", "The text must be a string.");
    const result = createGuard(termsOf(await spaces.list()))(text);
    if (result.ok) return { ok: true };
    const token = tokenOf();
    await held.set({ [token]: { matches: result.matches, tooLong: result.tooLong } });
    return { ok: false, token };
  },
};

const own = browser.runtime.getURL("");
/** One of this extension's pages, in a tab or in a frame (A5). */
export const fromOwnPage = (sender) => sender?.id === browser.runtime.id && typeof sender.url === "string" && sender.url.startsWith(own);
/** The content script in the top frame of a supported chat site (A5). */
export const fromContent = (sender) => sender?.id === browser.runtime.id && sender.frameId === 0 && Boolean(tabSite(sender.tab)) && typeof sender.url === "string" && !sender.url.startsWith(own);

browser.runtime.onMessage.addListener((message, sender) => {
  const type = message?.type;
  const handler = fromOwnPage(sender) && Object.hasOwn(pageHandlers, type) ? pageHandlers[type] : fromContent(sender) && Object.hasOwn(contentHandlers, type) ? contentHandlers[type] : undefined;
  if (!handler) return undefined;
  return Promise.resolve()
    .then(() => handler(message, sender))
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, code: error instanceof FoxspaceError ? error.code : "error", error: error instanceof Error ? error.message : String(error) }),
    );
});

// A first run gets two example spaces, so the picker has something to show.
const EXAMPLES = [
  { name: "Trip to Japan", items: [
    { kind: "instructions", text: "Plan for 2 adults on a mid budget. Prefer trains over flights.", sensitivity: "public" },
    { kind: "memory", text: "We are a couple living in Vancouver.", sensitivity: "public" },
    { kind: "preference", text: "Vegetarian food only.", sensitivity: "ask" },
    { kind: "memory", text: "Passport number X1234567.", sensitivity: "private" },
  ], neverShare: ["X1234567"] },
  { name: "Work: Acme launch", items: [
    { kind: "instructions", text: "Write in short, plain sentences for a developer audience.", sensitivity: "public" },
    { kind: "snippet", text: "Launch date: the first Tuesday of next month.", sensitivity: "ask" },
    { kind: "memory", text: "Q3 revenue target is 4.2M.", sensitivity: "private" },
  ], neverShare: ["Project Zephyr"] },
];
async function seedExamples() {
  if ((await browser.storage.local.get("seeded")).seeded) return;
  const names = new Set((await spaces.list()).map((s) => s.name));
  for (const example of EXAMPLES) {
    if (names.has(example.name)) continue;
    const space = await spaces.create(example.name);
    await spaces.addItems(space.id, example.items);
    await spaces.setNeverShare(space.id, example.neverShare);
  }
  await browser.storage.local.set({ seeded: true });
}
browser.runtime.onInstalled.addListener(() => {
  seedExamples().catch(() => {});
});
