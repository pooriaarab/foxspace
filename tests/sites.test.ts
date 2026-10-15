// @vitest-environment happy-dom
// A1, A2 and A4 in docs/failure-modes.md: finding the composer on each site, and on a redesigned one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composerText, findComposer } from "../src/composer.js";
import { PROVIDERS, SITE_MATCHES, SITES, siteForHost } from "../src/index.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", "sites", `${name}.html`), "utf8");
// happy-dom has no layout, so "shown" is read from the markup here. The E2E checks real layout.
const isShown = (el: Element) => !el.closest('[hidden], [style*="display:none"], [style*="display: none"]');
const page = (html: string) => {
  document.body.innerHTML = html;
  return document;
};

describe("site adapters", () => {
  it("has one adapter per provider, on https only", () => {
    expect(SITES.map((s) => s.provider)).toEqual(PROVIDERS.map((p) => p.id));
    expect(SITES.map((s) => s.host)).toEqual(PROVIDERS.map((p) => p.host));
    expect(SITE_MATCHES).toContain("https://chatgpt.com/*");
    expect(SITE_MATCHES.every((m) => m.startsWith("https://"))).toBe(true);
  });

  it("A4 matches exact hosts only", () => {
    expect(siteForHost("claude.ai")?.provider).toBe("claude");
    for (const host of ["evil.com", "chatgpt.com.evil.com", "www.chatgpt.com", "perplexity.ai"]) expect(siteForHost(host), host).toBeUndefined();
  });

  for (const site of SITES) {
    it(`finds the composer on ${site.host}`, () => {
      const found = findComposer(page(fixture(site.provider)), site, isShown);
      expect(found.ok).toBe(true);
      if (found.ok) expect(found.selector).toBe(site.composer.find((s) => document.querySelector(s)));
    });
  }

  it("skips Quill's clipboard box on Gemini", () => {
    const found = findComposer(page(fixture("gemini")), siteForHost("gemini.google.com")!, isShown);
    expect(found.ok && found.element.className).toBe("ql-editor textarea");
  });

  it("A2 skips a hidden match and takes the next one", () => {
    const html = '<div hidden><div class="ProseMirror" contenteditable="true" id="old"></div></div><div class="ProseMirror" contenteditable="true" id="new"></div>';
    const found = findComposer(page(html), siteForHost("claude.ai")!, isShown);
    expect(found.ok && found.element.id).toBe("new");
  });

  it("A2 skips a disabled or read-only textarea", () => {
    const html = '<textarea id="chat-input" disabled></textarea><textarea name="search" readonly></textarea><textarea placeholder="Message DeepSeek" id="ok"></textarea>';
    const found = findComposer(page(html), siteForHost("chat.deepseek.com")!, isShown);
    expect(found.ok && found.element.id).toBe("ok");
  });

  it("A1 says so when a redesign leaves no selector matching, and when nothing has loaded", () => {
    const error = "foxspace cannot find the message box on chatgpt.com. The page may still be loading, or the site changed its layout.";
    expect(findComposer(page(fixture("chatgpt-redesign")), siteForHost("chatgpt.com")!, isShown)).toEqual({ ok: false, error });
    expect(findComposer(page(""), siteForHost("chatgpt.com")!, isShown)).toEqual({ ok: false, error });
  });

  it("reads the text of a textarea and of an editor", () => {
    page('<textarea id="chat-input"></textarea>');
    const area = document.querySelector("textarea")!;
    area.value = "hello";
    expect(composerText(area)).toBe("hello");
    page('<div contenteditable="true"><p>one</p></div>');
    expect(composerText(document.querySelector<HTMLElement>("[contenteditable]")!)).toContain("one");
  });
});
