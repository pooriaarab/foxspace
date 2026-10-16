// The chat sites foxspace supports, and their settings boxes for Sync.
// Limits were looked up on 2026-10-15; docs/sites.md has the sources. Where a
// site documents no limit, foxspace uses a safe size and says so.
import type { ItemKind } from "./schema.js";

export type ProviderId = "chatgpt" | "claude" | "mistral" | "gemini" | "perplexity" | "grok" | "deepseek";

export interface SyncBox {
  id: string;
  label: string;
  /** The longest text, in characters, that foxspace renders for the box. */
  limit: number;
  /** documented: the site says so. reported: third parties say so. assumed: a safe size, no source. */
  limitIs: "documented" | "reported" | "assumed";
  note: string;
  /** The item kinds that go into this box. */
  kinds: ItemKind[];
}

export interface Provider {
  id: ProviderId;
  label: string;
  host: string;
  /** Where the user pastes the Sync text, or undefined when there is no such page. */
  settingsUrl?: string;
  /** How to get to the box when there is no link. */
  settingsPath: string;
  sync: SyncBox[];
}

const ALL: ItemKind[] = ["instructions", "preference", "memory", "snippet"];
const assumed = (label: string): SyncBox => ({ id: "instructions", label, limit: 1500, limitIs: "assumed", note: "The site documents no limit. foxspace keeps the text to 1,500 characters.", kinds: ALL });

export const PROVIDERS: readonly Provider[] = Object.freeze([
  {
    id: "chatgpt", label: "ChatGPT", host: "chatgpt.com", settingsUrl: "https://chatgpt.com/#settings/Personalization", settingsPath: "Settings > Personalization",
    sync: [
      { id: "custom-instructions", label: "Custom instructions", limit: 1500, limitIs: "documented", note: "1,500 characters on Free and Go, 5,000 on paid plans. foxspace sizes for 1,500 so the text fits every plan.", kinds: ["instructions"] },
      { id: "more-about-you", label: "More about you", limit: 1500, limitIs: "documented", note: "1,500 characters on Free and Go, 5,000 on paid plans. foxspace sizes for 1,500 so the text fits every plan.", kinds: ["preference", "memory", "snippet"] },
    ],
  },
  { id: "claude", label: "Claude", host: "claude.ai", settingsUrl: "https://claude.ai/settings/general", settingsPath: "Settings > General > Instructions for Claude", sync: [assumed("Instructions for Claude")] },
  { id: "mistral", label: "Le Chat", host: "chat.mistral.ai", settingsPath: "Sidebar > Context > Instructions", sync: [assumed("Custom instructions")] },
  { id: "gemini", label: "Gemini", host: "gemini.google.com", settingsUrl: "https://gemini.google.com/saved-info", settingsPath: "Settings & help > Personal Intelligence > Instructions for Gemini", sync: [assumed("Instructions for Gemini")] },
  { id: "perplexity", label: "Perplexity", host: "www.perplexity.ai", settingsUrl: "https://www.perplexity.ai/account/personalize", settingsPath: "Settings > Personalize > Introduce yourself", sync: [assumed("Introduce yourself")] },
  {
    id: "grok", label: "Grok", host: "grok.com", settingsPath: "Profile > Settings > Customize",
    sync: [{ id: "instructions", label: "Custom instructions", limit: 4000, limitIs: "reported", note: "Reports give 4,000 or 12,000 characters. foxspace uses the lower one.", kinds: ALL }],
  },
  { id: "deepseek", label: "DeepSeek", host: "chat.deepseek.com", settingsPath: "DeepSeek has no custom instructions or memory setting.", sync: [] },
]);

/** The longest block that the picker inserts into a composer. */
export const INJECT_LIMIT = 8000;

export function providerById(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function providerForHost(host: string): Provider | undefined {
  return PROVIDERS.find((p) => p.host === host);
}
