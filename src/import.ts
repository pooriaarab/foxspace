// Read an export file into items for a space. The formats are in
// docs/formats.md. Every item is checked before anything is added, so one
// bad item fails the whole import (I6), and nothing is guessed (I4).
import { FoxspaceError } from "./errors.js";
import { checkItem, checkSensitivity, checkState, checkTerm, type Sensitivity, type Space } from "./schema.js";
import type { NewItem } from "./spaces.js";

export const MAX_IMPORT_BYTES = 1024 * 1024;

export type ImportFormat = "foxspace/v1" | "foxcache/v1" | "foxcache/v1 memories" | "foxpack/v1" | "foxprefs/v1" | "foxprefs/rules-v1";

export interface ImportResult {
  format: ImportFormat;
  /** Spaces from a foxspace/v1 file. Empty for the other formats. */
  spaces: Space[];
  items: NewItem[];
  neverShare: string[];
  /** Sections of the file that foxspace does not read, for example chats. */
  ignored: string[];
}

const FORMATS = "foxspace/v1, foxcache/v1 (an archive or its memory list), foxpack/v1, foxprefs/v1 and foxprefs/rules-v1";
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function bad(why: string): never {
  throw new FoxspaceError("bad-import", `The import is not valid: ${why}.`);
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON.parse with a size cap (I1) that refuses prototype keys (I2). */
export function parseJson(text: string): unknown {
  if (typeof text !== "string") bad("it is not text");
  // UTF-8 has at least one byte per UTF-16 unit, so a long text fails before it is encoded.
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new FoxspaceError("too-large", `The import is larger than ${MAX_IMPORT_BYTES / 1024} KB.`);
  let key = "";
  try {
    return JSON.parse(text, function (k, v) {
      if (BAD_KEYS.has(k)) {
        key = k;
        throw new Error(k);
      }
      return v;
    });
  } catch {
    return bad(key ? `it holds the key "${key}"` : "it is not JSON");
  }
}

/** One item, checked now so a bad one fails the import with its place in the file. */
function item(kind: NewItem["kind"], text: unknown, sensitivity: unknown, source: string, where: string): NewItem {
  const checked = checkItem({ id: "check", kind, text: typeof text === "string" ? text.trim() : text, sensitivity: checkSensitivity(sensitivity, where, "bad-import"), source }, where, "bad-import");
  return { kind, text: checked.text, sensitivity: checked.sensitivity, source };
}

/** A foxcache or foxpack entry: a string, or an object with text and maybe site and sensitivity. */
function entries(list: unknown, kind: NewItem["kind"], label: string, source: (e: Record<string, unknown>) => string): NewItem[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) bad(`${label} must be a list`);
  return list.map((e, i) => {
    const where = `${label} ${i + 1}`;
    if (typeof e === "string") return item(kind, e, undefined, source({}), where);
    if (!isObject(e)) return bad(`${where} must be text or an object with text`);
    return item(kind, e.text, e.sensitivity, source(e), where);
  });
}

const siteOf = (prefix: string) => (e: Record<string, unknown>) => (typeof e.site === "string" && /^[a-z0-9.-]{1,60}$/.test(e.site) ? `${prefix}:${e.site}` : prefix);

/** A foxprefs value as text, as foxprefs shows it. */
function prefText(value: unknown, where: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.join(", ");
  if (isObject(value) && Number.isInteger(value.value) && typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency)) {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: value.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return `${((value.value as number) / 10 ** digits).toFixed(digits)} ${value.currency}`;
  }
  return bad(`${where} has a value foxspace cannot read`);
}

/**
 * The default levels of the foxprefs 0.1 schema. A foxprefs export holds a
 * level only where the user changed it, so a missing one is this default.
 * A field that foxprefs does not have is private: foxspace never guesses a
 * weaker level (I5).
 */
const FOXPREFS_DEFAULTS: Readonly<Record<string, Sensitivity>> = Object.freeze({
  "identity.name": "ask", "identity.pronouns": "public", "identity.language": "public", "identity.timeZone": "public",
  "shopping.size.top": "public", "shopping.size.bottom": "public", "shopping.size.shoe": "public", "shopping.brands.avoid": "public", "shopping.materials.avoid": "public",
  "food.diet": "public", "food.allergies": "ask", "food.dislikes": "public",
  "travel.seat": "public", "travel.airlines.prefer": "public", "travel.redeye": "public", "travel.loyalty": "private",
  "budget.perPurchase": "ask", "budget.monthly": "ask",
  "communication.tone": "public", "communication.length": "public", "communication.format": "public",
  "accessibility.textSize": "public", "accessibility.reducedMotion": "public", "accessibility.captions": "public",
  "rules.maxPurchase": "public", "rules.sites.block": "public", "rules.sites.ask": "public",
});

/** "shopping.size.top" -> "Shopping size top". */
const prefLabel = (name: string) => name.replace(/[._]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function terms(list: unknown, label: string): string[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) bad(`${label} must be a list`);
  return list.map((t, i) => checkTerm(t, `${label} ${i + 1}`, "bad-import"));
}

function fromFoxprefs(raw: Record<string, unknown>): ImportResult {
  if (!isObject(raw.values) || !isObject(raw.sensitivity)) bad("a foxprefs/v1 file needs values and sensitivity");
  const values = raw.values as Record<string, unknown>;
  const levels = raw.sensitivity as Record<string, unknown>;
  const items: NewItem[] = [];
  let neverShare: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const where = `foxprefs field ${name}`;
    if (!/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/.test(name)) bad(`${where} is not a field name`);
    // I8: never-share rules guard the space; they are never rendered.
    if (name === "rules.neverShare") neverShare = terms(value, "foxprefs never-share term");
    else {
      // I5: the level that the user chose in foxprefs, else the foxprefs default, else private.
      const level: Sensitivity = Object.hasOwn(levels, name) ? checkSensitivity(levels[name], where, "bad-import") : (Object.hasOwn(FOXPREFS_DEFAULTS, name) ? FOXPREFS_DEFAULTS[name]! : "private");
      items.push(item("preference", `${prefLabel(name)}: ${prefText(value, where)}`, level, "foxprefs", where));
    }
  }
  return { format: "foxprefs/v1", spaces: [], items, neverShare, ignored: [] };
}

/** Read an export file. Throws bad-import or too-large, and adds nothing. */
export function parseImport(text: string): ImportResult {
  const raw = parseJson(text);
  const empty = { spaces: [], items: [], neverShare: [], ignored: [] };
  if (Array.isArray(raw)) return { ...empty, format: "foxcache/v1 memories", items: entries(raw, "memory", "foxcache memory", siteOf("foxcache")) };
  if (!isObject(raw)) return bad(`it is not one of ${FORMATS}`);
  switch (raw.format) {
    case "foxspace/v1":
      return { ...empty, format: "foxspace/v1", spaces: checkState(raw, "bad-import").spaces };
    case "foxcache/v1": {
      if (raw.kind === "memories") return { ...empty, format: "foxcache/v1 memories", items: entries(raw.memories, "memory", "foxcache memory", siteOf("foxcache")) };
      const items = [...entries(raw.memories, "memory", "foxcache memory", siteOf("foxcache")), ...entries(raw.preferences, "preference", "foxcache preference", siteOf("foxcache"))];
      const ignored = Object.keys(raw).filter((k) => !["format", "exportedAt", "kind", "memories", "preferences"].includes(k)).toSorted();
      return { ...empty, format: "foxcache/v1", items, ignored };
    }
    case "foxpack/v1":
      return { ...empty, format: "foxpack/v1", items: entries(raw.memories, "memory", "foxpack memory", () => "foxpack") };
    case "foxprefs/v1":
      return fromFoxprefs(raw);
    case "foxprefs/rules-v1":
      return { ...empty, format: "foxprefs/rules-v1", neverShare: terms(raw.neverShare, "foxprefs never-share term") };
    default:
      return bad(`it is not one of ${FORMATS}`);
  }
}

/** Pasted plain text: one item per paragraph (text between blank lines). */
export function parsePaste(text: string, kind: NewItem["kind"], sensitivity?: Sensitivity): NewItem[] {
  if (typeof text !== "string") bad("it is not text");
  if (text.length > MAX_IMPORT_BYTES) throw new FoxspaceError("too-large", `The paste is larger than ${MAX_IMPORT_BYTES / 1024} KB.`);
  const parts = kind === "instructions" ? [text.trim()] : text.split(/\n\s*\n/).map((p) => p.trim());
  return parts.filter(Boolean).map((p, i) => item(kind, p, sensitivity, "paste", `Pasted item ${i + 1}`));
}
