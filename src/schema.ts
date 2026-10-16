// The foxspace/v1 record: spaces of context items. Every check copies the
// known fields only, so a stored or imported object never carries extra keys.
import { FoxspaceError, type FoxspaceErrorCode } from "./errors.js";
import { termProblem } from "./guard.js";
import { textProblem } from "./text.js";

export const FORMAT = "foxspace/v1";

/** SCENT v0.1: who may read an item. "private" never leaves the browser. */
export type Sensitivity = "public" | "ask" | "private";
export const SENSITIVITIES: readonly Sensitivity[] = ["public", "ask", "private"];
/** An item with no sensitivity is "ask": the user ticks it before it goes out. */
export const DEFAULT_SENSITIVITY: Sensitivity = "ask";

export type ItemKind = "instructions" | "memory" | "preference" | "snippet";
export const KINDS: readonly ItemKind[] = ["instructions", "memory", "preference", "snippet"];

export const LIMITS = Object.freeze({ spaces: 100, name: 80, items: 300, item: 4000, terms: 100, term: 100, source: 80 });

export interface SpaceItem {
  id: string;
  kind: ItemKind;
  text: string;
  sensitivity: Sensitivity;
  /** Where the item came from, for example "foxcache:chatgpt.com". */
  source?: string;
}

export interface Space {
  id: string;
  name: string;
  items: SpaceItem[];
  /** Terms that the guard stops in an outgoing message. Never rendered. */
  neverShare: string[];
  /** The MCP server gives this space, public items only, when this is true. */
  agentReadable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SpacesState {
  format: typeof FORMAT;
  spaces: Space[];
  updatedAt: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEYS = { item: new Set(["id", "kind", "text", "sensitivity", "source"]), space: new Set(["id", "name", "items", "neverShare", "agentReadable", "createdAt", "updatedAt"]) };

/** A new random id, 10 lowercase hex characters. */
export function newId(): string {
  return [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function fail(code: FoxspaceErrorCode, where: string, why: string): never {
  throw new FoxspaceError(code, `${where} ${why}.`);
}

function onlyKeys(raw: Record<string, unknown>, keys: Set<string>, where: string, code: FoxspaceErrorCode) {
  for (const key of Object.keys(raw)) if (!keys.has(key)) fail(code, where, `has the unknown key ${JSON.stringify(key)}`);
}

function text(raw: unknown, max: number, where: string, code: FoxspaceErrorCode, multiline = false): string {
  const why = textProblem(raw, max, { multiline });
  if (why) fail(code, where, why);
  return raw as string;
}

export function checkSensitivity(raw: unknown, where: string, code: FoxspaceErrorCode = "bad-space"): Sensitivity {
  if (raw === undefined) return DEFAULT_SENSITIVITY;
  if (!SENSITIVITIES.includes(raw as Sensitivity)) fail(code, where, `has the sensitivity ${JSON.stringify(raw)}; use public, ask or private`);
  return raw as Sensitivity;
}

export function checkItem(raw: unknown, where: string, code: FoxspaceErrorCode = "bad-space"): SpaceItem {
  if (!isObject(raw)) fail(code, where, "must be an object");
  onlyKeys(raw, KEYS.item, where, code);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) fail(code, where, "needs an id of lowercase letters, digits and dashes");
  if (!KINDS.includes(raw.kind as ItemKind)) fail(code, where, `has the kind ${JSON.stringify(raw.kind)}; use ${KINDS.join(", ")}`);
  const item: SpaceItem = { id: raw.id, kind: raw.kind as ItemKind, text: text(raw.text, LIMITS.item, `${where} text`, code, true), sensitivity: checkSensitivity(raw.sensitivity, where, code) };
  if (raw.source !== undefined) item.source = text(raw.source, LIMITS.source, `${where} source`, code);
  return item;
}

export function checkTerm(raw: unknown, where: string, code: FoxspaceErrorCode = "bad-space"): string {
  const term = text(raw, LIMITS.term, where, code).trim();
  const why = termProblem(term);
  if (why) fail(code, where, why);
  return term;
}

const time = (raw: unknown, where: string, code: FoxspaceErrorCode) => {
  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) fail(code, where, "must be an ISO date");
  return raw;
};

export function checkSpace(raw: unknown, code: FoxspaceErrorCode = "bad-space"): Space {
  if (!isObject(raw)) fail(code, "A space", "must be an object");
  const where = typeof raw.name === "string" ? `Space "${raw.name.slice(0, LIMITS.name)}"` : "A space";
  onlyKeys(raw, KEYS.space, where, code);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) fail(code, where, "needs an id of lowercase letters, digits and dashes");
  const name = text(raw.name, LIMITS.name, `${where} name`, code).trim();
  if (!Array.isArray(raw.items)) fail(code, where, "needs a list of items");
  if (raw.items.length > LIMITS.items) fail(code, where, `has ${raw.items.length} items; the limit is ${LIMITS.items}`);
  const items = raw.items.map((item, i) => checkItem(item, `${where} item ${i + 1}`, code));
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) fail(code, where, `has two items with the id ${item.id}`);
    ids.add(item.id);
  }
  if (!Array.isArray(raw.neverShare)) fail(code, where, "needs a list of never-share terms");
  if (raw.neverShare.length > LIMITS.terms) fail(code, where, `has ${raw.neverShare.length} never-share terms; the limit is ${LIMITS.terms}`);
  const neverShare = raw.neverShare.map((t, i) => checkTerm(t, `${where} never-share term ${i + 1}`, code));
  if (typeof raw.agentReadable !== "boolean") fail(code, where, "agentReadable must be true or false");
  return { id: raw.id, name, items, neverShare, agentReadable: raw.agentReadable, createdAt: time(raw.createdAt, `${where} createdAt`, code), updatedAt: time(raw.updatedAt, `${where} updatedAt`, code) };
}

/** Check a whole record. code is "bad-store" for the store and "bad-import" for a file. */
export function checkState(raw: unknown, code: FoxspaceErrorCode): SpacesState {
  if (!isObject(raw) || raw.format !== FORMAT) fail(code, "The record", `is not ${FORMAT}`);
  onlyKeys(raw, new Set(["format", "spaces", "updatedAt"]), "The record", code);
  if (!Array.isArray(raw.spaces)) fail(code, "The record", "needs a list of spaces");
  if (raw.spaces.length > LIMITS.spaces) fail(code, "The record", `has ${raw.spaces.length} spaces; the limit is ${LIMITS.spaces}`);
  const spaces = raw.spaces.map((s) => checkSpace(s, code));
  const ids = new Set<string>();
  for (const s of spaces) {
    if (ids.has(s.id)) fail(code, "The record", `has two spaces with the id ${s.id}`);
    ids.add(s.id);
  }
  return { format: FORMAT, spaces, updatedAt: time(raw.updatedAt, "The record updatedAt", code) };
}
