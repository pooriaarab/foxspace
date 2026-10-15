// Render a space as one block of text, for a composer or a settings box.
// A private item is never rendered. An "ask" item is rendered only when its
// id is in this render's ticks. Items that do not fit are left out whole.
import { FoxspaceError } from "./errors.js";
import { INJECT_LIMIT, PROVIDERS, providerById } from "./providers.js";
import type { ItemKind, Space, SpaceItem } from "./schema.js";

export type RenderFormat = "text" | "markdown";

export interface RenderOptions {
  /** Ids of the "ask" items that the user ticked for this render. */
  ticked?: Iterable<string>;
  format?: RenderFormat;
  /** The longest text in characters. Default: INJECT_LIMIT. */
  limit?: number;
  /** The item kinds to render. Default: all. */
  kinds?: readonly ItemKind[];
}

export interface Render {
  text: string;
  /** Ids of the items in the text. */
  included: string[];
  left: { private: number; unticked: number; tooLong: number };
  /** Why the text is empty, when it is. */
  empty?: string;
}

const ORDER: ItemKind[] = ["instructions", "preference", "memory", "snippet"];
const HEADINGS: Record<ItemKind, string> = { instructions: "Instructions", preference: "Preferences", memory: "About me", snippet: "Notes" };

/** In Markdown, a line that would start a heading, quote, list or rule starts with a backslash. */
const quoteLine = (line: string) => line.replace(/^(\s*)([#>*+-]|\d+[.)])/, "$1\\$2");

function itemText(item: SpaceItem, format: RenderFormat): string {
  const lines = item.text.trim().split("\n");
  const body = format === "markdown" ? lines.map(quoteLine) : lines;
  if (item.kind === "instructions") return body.join("\n");
  return `- ${body.join("\n  ")}`;
}

function compose(space: Space, groups: Map<ItemKind, SpaceItem[]>, format: RenderFormat): string {
  const head = format === "markdown" ? `## Context: ${space.name}` : `Context for this chat, from my foxspace "${space.name}":`;
  const parts = [head];
  for (const kind of ORDER) {
    const items = groups.get(kind);
    if (!items?.length) continue;
    const title = format === "markdown" ? `### ${HEADINGS[kind]}` : `${HEADINGS[kind]}:`;
    parts.push(`${title}\n${items.map((i) => itemText(i, format)).join(kind === "instructions" ? "\n\n" : "\n")}`);
  }
  return parts.join("\n\n");
}

export function renderSpace(space: Space, opts: RenderOptions = {}): Render {
  const format = opts.format ?? "text";
  if (format !== "text" && format !== "markdown") throw new FoxspaceError("bad-request", `The format must be text or markdown, not ${JSON.stringify(format)}.`);
  const limit = opts.limit ?? INJECT_LIMIT;
  const ticked = new Set(opts.ticked ?? []);
  const kinds = new Set(opts.kinds ?? ORDER);
  const left = { private: 0, unticked: 0, tooLong: 0 };
  const groups = new Map<ItemKind, SpaceItem[]>();
  let text = "";
  const included: string[] = [];
  const wanted = space.items.filter((i) => kinds.has(i.kind)).toSorted((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  for (const item of wanted) {
    if (item.sensitivity === "private") left.private++;
    else if (item.sensitivity === "ask" && !ticked.has(item.id)) left.unticked++;
    else {
      const group = groups.get(item.kind) ?? [];
      groups.set(item.kind, [...group, item]);
      const next = compose(space, groups, format);
      if (next.length > limit) {
        groups.set(item.kind, group);
        left.tooLong++;
      } else {
        text = next;
        included.push(item.id);
      }
    }
  }
  if (included.length > 0) return { text, included, left };
  let empty = "This space has no items.";
  if (left.tooLong > 0) empty = `Nothing fits in ${limit} characters.`;
  else if (left.unticked > 0) empty = 'Nothing to add: tick an "ask" item, or make an item public.';
  else if (left.private > 0) empty = "Nothing to add: every item is private.";
  else if (wanted.length === 0 && space.items.length > 0) empty = "No item of the kinds for this box.";
  return { text: "", included, left, empty };
}

/** Render a space for one settings box of a provider, at the box's limit. */
export function renderForSync(space: Space, providerId: string, boxId: string, opts: Pick<RenderOptions, "ticked" | "format"> = {}): Render {
  const provider = providerById(providerId);
  if (!provider) throw new FoxspaceError("bad-request", `There is no provider ${JSON.stringify(providerId)}. Use ${PROVIDERS.map((p) => p.id).join(", ")}.`);
  const box = provider.sync.find((b) => b.id === boxId);
  if (!box) throw new FoxspaceError("bad-request", provider.sync.length ? `${provider.label} has no box ${JSON.stringify(boxId)}. Use ${provider.sync.map((b) => b.id).join(", ")}.` : `${provider.label} has no settings box to sync to.`);
  return renderSpace(space, { ...opts, limit: box.limit, kinds: box.kinds });
}
