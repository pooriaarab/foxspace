// The guard matcher: does an outgoing message hold a never-share term?
// Both the text and the terms go through one normalization, so a term that
// is hidden with zero-width characters, Unicode lookalikes, accents, case or
// other spacing still matches. A term matches whole words only.

/** Text longer than this is not checked; it counts as a match (G6). */
export const MAX_GUARD_CHARS = 100_000;
/** A term of this many digits or more matches by its digits alone (G4). */
export const DIGIT_TERM = 6;
/** A one-word term of this many characters or more also matches with spaces in it. */
export const SPLIT_TERM = 6;

/**
 * Lookalikes that NFKC keeps apart from Latin: Cyrillic and Greek letters
 * that read as a Latin letter, upper and lower case. A small map of the
 * common ones, not the whole Unicode confusables table.
 */
const LOOKALIKES: Record<string, string> = Object.freeze({
  // Cyrillic
  "\u0410": "A", "\u0412": "B", "\u0415": "E", "\u041A": "K", "\u041C": "M", "\u041D": "H", "\u041E": "O", "\u0420": "P", "\u0421": "C", "\u0422": "T", "\u0425": "X", "\u0423": "Y", "\u0405": "S", "\u0406": "I", "\u0408": "J", "\u051A": "Q", "\u051C": "W",
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0455": "s", "\u0456": "i", "\u0458": "j", "\u0501": "d", "\u04BB": "h", "\u04CF": "l", "\u051B": "q", "\u051D": "w", "\u044C": "b",
  // Greek
  "\u0391": "A", "\u0392": "B", "\u0395": "E", "\u0396": "Z", "\u0397": "H", "\u0399": "I", "\u039A": "K", "\u039C": "M", "\u039D": "N", "\u039F": "O", "\u03A1": "P", "\u03A4": "T", "\u03A5": "Y", "\u03A7": "X",
  "\u03B1": "a", "\u03BF": "o", "\u03C1": "p", "\u03BD": "v", "\u03B9": "i", "\u03BA": "k", "\u03C7": "x", "\u03C5": "u", "\u03B5": "e", "\u03C4": "t",
  // Latin letters that read as others
  "\u0131": "i", "\u0237": "j", "\u0261": "g", "\u2113": "l",
});
const LOOKALIKE = new RegExp(`[${Object.keys(LOOKALIKES).join("")}]`, "gu");

/**
 * The form both sides are compared in: NFKC (fullwidth and math letters to
 * plain ones), lookalikes to Latin, accents and format characters (zero-width,
 * bidi, soft hyphen, variation selectors) removed, case folded, and every run
 * of other characters made one space.
 */
export function normalizeForGuard(text: string): string {
  return text
    .normalize("NFKC")
    .replace(LOOKALIKE, (ch) => LOOKALIKES[ch]!)
    .normalize("NFKD")
    .replace(/[\p{M}\p{Cf}\u034F\u115F\u1160\u3164\uFFA0]/gu, "")
    // Upper then lower case folds more than lower case alone: "ß" -> "SS" -> "ss".
    .toUpperCase()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Why a term cannot guard anything (G7), or undefined. */
export function termProblem(term: string): string | undefined {
  const norm = normalizeForGuard(term);
  if (norm.length < 2) return "must have at least two letters or digits";
  return undefined;
}

export interface GuardTerm {
  term: string;
  /** Where the term comes from, for the dialog: a space name or "foxprefs". */
  from: string;
}

export interface GuardResult {
  ok: boolean;
  matches: GuardTerm[];
  /** The text was longer than MAX_GUARD_CHARS, so it was not checked. */
  tooLong: boolean;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pattern(term: string): RegExp | undefined {
  const norm = normalizeForGuard(term);
  if (norm.length < 2) return undefined;
  const digits = norm.replace(/\D/g, "");
  // A number with spaces, dashes, dots or brackets between its digits.
  if (digits.length >= DIGIT_TERM && /^[\d ]+$/.test(norm)) return new RegExp(`(?<!\\d)${[...digits].join(" ?")}(?!\\d)`, "u");
  // A long one-word term, also with spaces put in it ("AB 1234 56").
  const body = !norm.includes(" ") && norm.length >= SPLIT_TERM ? [...norm].map(escape).join(" ?") : escape(norm);
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "u");
}

/** Secrets the guard stops with no term set: API keys and private keys, matched on the raw text. */
const SECRETS: { re: RegExp; term: string }[] = [
  { re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}/, term: "an API key (sk-...)" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, term: "an AWS access key" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{30,}/, term: "a GitHub token" },
  { re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/, term: "a Slack token" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, term: "a Google API key" },
  { re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, term: "a private key" },
];

/** A guard for a list of terms. Call it with each outgoing message. */
export function createGuard(terms: GuardTerm[]): (text: string) => GuardResult {
  const compiled = terms.flatMap((t) => {
    const re = pattern(t.term);
    return re ? [{ t, re }] : [];
  });
  return (text) => {
    if (text.length > MAX_GUARD_CHARS) return { ok: false, matches: [], tooLong: true };
    const norm = normalizeForGuard(text);
    const matches = compiled.filter(({ re }) => re.test(norm)).map(({ t }) => ({ term: t.term, from: t.from }));
    for (const secret of SECRETS) if (secret.re.test(text)) matches.push({ term: secret.term, from: "foxspace" });
    return { ok: matches.length === 0, matches, tooLong: false };
  };
}
