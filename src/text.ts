// Text checks shared by the space record, the importers and the guard.

/**
 * Characters that change how text reads in a prompt: C0 and C1 controls but
 * tab and newline, the soft hyphen, the Mongolian vowel separator, bidi marks
 * and overrides, the zero-width space, the word joiner, invisible operators,
 * the BOM, interlinear annotation marks, and the Unicode tag characters, which
 * a model reads and a person does not see ("ASCII smuggling"). The zero-width
 * joiner and non-joiner and the variation selectors are not here: emoji and
 * scripts such as Persian need them.
 */
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
export const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/u;

/** A short name for a character, for an error message. */
export function describeChar(ch: string): string {
  return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Why the text is bad, or undefined when it is good. */
export function textProblem(text: unknown, max: number, opts: { multiline: boolean }): string | undefined {
  if (typeof text !== "string") return "must be text";
  if (text.trim() === "") return "must not be empty";
  if (text.length > max) return `is ${text.length} characters; the limit is ${max}`;
  if (!opts.multiline && /[\n\t]/.test(text)) return "must be one line";
  const hidden = HIDDEN.exec(text);
  if (hidden) return `holds the hidden character ${describeChar(hidden[0])}`;
  return undefined;
}
