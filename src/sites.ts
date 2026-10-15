// One adapter per supported chat site: where the composer is and which
// control sends. The selectors are tried in order, so a site that changes
// its markup is still found when one of them still matches. docs/sites.md
// has the sources and the date they were checked.
import type { ProviderId } from "./providers.js";

export interface SiteAdapter {
  provider: ProviderId;
  host: string;
  /** The composer, most specific first. */
  composer: string[];
  /** The send control. */
  send: string[];
}

export const SITES: readonly SiteAdapter[] = Object.freeze([
  {
    provider: "chatgpt", host: "chatgpt.com",
    composer: ['#prompt-textarea[contenteditable="true"]', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]', "textarea#mobile-composer-prompt"],
    send: ['button[data-testid="send-button"]', "#composer-submit-button", 'button[data-testid="fruitjuice-send-button"]', 'button[aria-label="Send prompt"]'],
  },
  {
    provider: "claude", host: "claude.ai",
    composer: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
    send: ['button[aria-label="Send message"]', 'button[aria-label="Send Message"]', 'button[data-testid="send-button"]'],
  },
  {
    provider: "mistral", host: "chat.mistral.ai",
    composer: ['div.ProseMirror[contenteditable="true"]', 'textarea[name="message.text"]'],
    send: ['button[aria-label="Send"]', 'button[type="submit"]'],
  },
  {
    provider: "gemini", host: "gemini.google.com",
    // Not a bare "rich-textarea [contenteditable]": that also matches Quill's .ql-clipboard.
    composer: ['rich-textarea .ql-editor[contenteditable="true"]'],
    send: ['button[aria-label="Send message"]', "button.send-button"],
  },
  {
    provider: "perplexity", host: "www.perplexity.ai",
    composer: ['#ask-input[contenteditable="true"]', 'div[data-lexical-editor="true"][contenteditable="true"]', "textarea#ask-input"],
    send: ['button[aria-label="Submit"]', 'button[data-testid="submit-button"]'],
  },
  {
    provider: "grok", host: "grok.com",
    composer: ['div.tiptap.ProseMirror[contenteditable="true"]', 'textarea[aria-label="Ask Grok anything"]'],
    send: ['button[aria-label="Submit"]', 'button[type="submit"]'],
  },
  {
    provider: "deepseek", host: "chat.deepseek.com",
    composer: ["textarea#chat-input", 'textarea[name="search"]', 'textarea[placeholder*="DeepSeek"]'],
    send: ['div[role="button"].ds-button--primary', 'button[type="submit"]'],
  },
]);

/** The content script match patterns: these hosts only (A4). */
export const SITE_MATCHES: readonly string[] = SITES.map((s) => `https://${s.host}/*`);

/** The adapter for a host name, exact match only. */
export function siteForHost(host: string): SiteAdapter | undefined {
  return SITES.find((s) => s.host === host);
}
