# The supported sites

Checked on 2026-10-15 from public sources, not against live logged-in
sites. Chat sites change their markup often, so `src/sites.ts` tries an
ordered list of selectors per site, and foxspace says so when none
matches (docs/failure-modes.md A1, A2).

Labels: **documented** (the vendor says so), **reported** (third-party
code or articles, with a date), **unknown**.

## Composer and send control

| Site | Composer | Send | Source (reported) |
|---|---|---|---|
| chatgpt.com | ProseMirror `div#prompt-textarea[contenteditable]`; a `textarea[name="prompt-textarea"]` when logged out | `button[data-testid="send-button"]`, `#composer-submit-button` | zabcore/ai-leak-guard PR #72 (Sep 2026) |
| claude.ai | ProseMirror (TipTap) `div.ProseMirror[contenteditable]` | `button[aria-label="Send message"]` | ArcRift PLATFORM_SELECTORS.md (May 2026); simple-chat-hub-extension #89 (Sep 2026) |
| chat.mistral.ai | ProseMirror `div.ProseMirror[contenteditable]`; older `textarea[name="message.text"]` | `button[aria-label="Send"]` | ArcRift (May 2026). Low confidence after the Oct 2026 rename to Vibe |
| gemini.google.com | Quill `rich-textarea .ql-editor[contenteditable]` | `button[aria-label="Send message"]` | zabcore/ai-leak-guard PR #76 (Sep 2026) |
| www.perplexity.ai | Lexical `#ask-input[contenteditable]` | `button[aria-label="Submit"]` (localized) | MCP-SuperAssistant perplexity adapter (Feb 2026); greasyfork 576823 (Sep 2026) |
| grok.com | TipTap `div.tiptap.ProseMirror[contenteditable]`; older `textarea[aria-label="Ask Grok anything"]` | `button[aria-label="Submit"]` | greasyfork 536180 (Dec 2025), 576823 (Sep 2026) |
| chat.deepseek.com | React `textarea#chat-input`; newer `textarea[name="search"]` | `div[role="button"].ds-button--primary` (a div) | YouTube-to-LLM PR #5 (2026); ArcRift (May 2026) |

## Settings boxes for Sync

| Site | Box | Limit foxspace uses | Basis |
|---|---|---|---|
| ChatGPT | Custom instructions; More about you (Settings > Personalization) | 1,500 each | documented: 1,500 on Free and Go, 5,000 on paid plans (help.openai.com 8096356). Whether 5,000 is per box is unknown |
| Claude | Instructions for Claude (Settings > General) | 1,500 | unknown: no limit is documented (support.claude.com 10185728). Organization instructions are 3,000 |
| Le Chat | Custom instructions (Sidebar > Context > Instructions) | 1,500 | unknown: docs.mistral.ai says only "keep them concise" |
| Gemini | Instructions for Gemini | 1,500 | unknown: a per-entry cap exists but is not published (support.google.com/gemini 16598625) |
| Perplexity | Introduce yourself (Settings > Personalize) | 1,500 | unknown: not documented |
| Grok | Custom instructions (Settings > Customize) | 4,000 | reported: 4,000 or 12,000 in 2026 articles; foxspace uses the lower one |
| DeepSeek | none | - | reported: no such setting (deepseek-ai/DeepSeek-V3 #1145 closed as not planned) |

The settings links in `src/providers.ts` are reported deep links, not
documented ones. Writing into these boxes is not automated in v0.1: the
user copies the text and pastes it.
