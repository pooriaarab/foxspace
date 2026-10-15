// Find the composer of a chat site, read its text, and put a block in it.
// This file runs in the content script.
//
// The insert method is the one foxpaw (src/page/act.ts, typeText) and
// foxpilot's PII Guard (apps/pii-guard/src/content/content.ts) use, MIT,
// by Pooria Arab: document.execCommand("insertText") inserts like typing,
// so the site's editor (React, ProseMirror, Lexical, Quill) gets the
// beforeinput and input events it listens for. foxspace does not set
// value or innerHTML: an editor would not see that text, and the user
// would send without it. It reads the composer back instead (A3).
import type { SiteAdapter } from "./sites.js";

export type Composer = HTMLTextAreaElement | HTMLElement;

export type Found = { ok: true; element: Composer; selector: string } | { ok: false; error: string };

/** A box with a size on screen, not hidden by CSS. */
export function shown(el: Element): boolean {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}

const editable = (el: Element): el is Composer =>
  el instanceof HTMLTextAreaElement ? !el.disabled && !el.readOnly : el instanceof HTMLElement && el.isContentEditable;

/** The first shown, editable match of the adapter's selectors, in order (A1, A2). */
export function findComposer(root: ParentNode, site: SiteAdapter, isShown: (el: Element) => boolean = shown): Found {
  for (const selector of site.composer) {
    for (const el of root.querySelectorAll(selector)) {
      if (editable(el) && isShown(el)) return { ok: true, element: el, selector };
    }
  }
  return { ok: false, error: `foxspace cannot find the message box on ${site.host}. The page may still be loading, or the site changed its layout.` };
}

/** The text the user would send. */
export function composerText(el: Composer): string {
  return el instanceof HTMLTextAreaElement ? el.value : (el.innerText ?? el.textContent ?? "");
}

const lines = (s: string) => s.split("\n").map((line) => line.trim()).filter(Boolean);

/**
 * Does the composer hold the block, line for line? Blank lines may differ:
 * editors turn each line into a paragraph. A block whose lines run
 * together, or into the user's text, is not held.
 */
export function holds(el: Composer, block: string): boolean {
  const have = lines(composerText(el));
  const want = lines(block);
  for (let at = 0; at + want.length <= have.length; at++) if (want.every((line, i) => have[at + i] === line)) return true;
  return false;
}

/**
 * Put the block at the start of the composer, before what the user typed,
 * then read it back after the editor's update. Resolves false when the
 * site's editor did not take it.
 */
export async function insertBlock(el: Composer, block: string): Promise<boolean> {
  el.focus();
  const text = composerText(el).trim() ? `${block}\n\n` : block;
  if (el instanceof HTMLTextAreaElement) el.setSelectionRange(0, 0);
  else {
    // The start of the first block in the editor, where the caret goes on a click at the top.
    let first: Node = el;
    while (first.firstChild && first.firstChild.nodeType === Node.ELEMENT_NODE && (first.firstChild as Element).tagName !== "BR") first = first.firstChild;
    const range = document.createRange();
    range.setStart(first, 0);
    range.collapse(true);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  document.execCommand("insertText", false, text);
  // Editors render their model after the event that changed it.
  await new Promise((done) => setTimeout(done, 0));
  return holds(el, block);
}
