# Failure modes

Every way foxspace can fail, written before the code. Each row names the
test that covers it. Prefer an E2E check. Write an isolated test only when an
E2E check cannot reach the failure.

foxspace moves a person's own context into chat sites. The worst failures
are an item that reaches a page when the user did not choose it, a guard
that lets a never-share term out without a stop, and a block that the user
thinks went in but did not. So foxspace fails loudly: it throws, it shows
the reason, and it never guesses where text should go.

## Spaces and the `foxspace/v1` record

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| S1 | An item has no text, text that is not a string, or an unknown kind | `bad-space` names the item; nothing is stored | tests/schema.test.ts |
| S2 | An item or a space name is huge (a 1 MB snippet, 10 000 items) | `bad-space` above the limits: name 80, item 4 000 characters, 300 items, 100 never-share terms | tests/schema.test.ts |
| S3 | Text holds control characters, a bidi override, zero-width or tag characters that make it read differently in a prompt, or hide text from the user | Control characters (but newline and tab), the soft hyphen, bidi controls, the zero-width space, word joiner, BOM and the Unicode tag characters ("ASCII smuggling": a model reads them, a person does not see them) are refused with `bad-space`. The zero-width joiner and non-joiner and the variation selectors stay: emoji and scripts such as Persian need them | tests/schema.test.ts |
| S4 | A sensitivity is not `public`, `ask` or `private` | `bad-space`; a missing sensitivity is `ask`, never `public` | tests/schema.test.ts |
| S5 | Two spaces have one id, or two items in a space have one id | `bad-space` | tests/schema.test.ts |
| S6 | The stored record is corrupt (not JSON, wrong format tag, a bad item) | Every call throws `bad-store`. foxspace never writes over it | tests/spaces.test.ts, tests/node.test.ts |
| S7 | Two changes run at the same time on one spaces object | Both land; calls run one at a time | tests/spaces.test.ts |
| S8 | A caller changes an object that `get` or `list` returned | The stored space does not change (copies, not references) | tests/spaces.test.ts |
| S9 | A space or item id that does not exist | `not-found` names it | tests/spaces.test.ts |
| S10 | The store write fails | The call rejects; a later read shows the old state | tests/spaces.test.ts |

## Render (inject and sync)

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| R1 | A private item leaks into a render, in any format, for any provider, ticked or not | A private item is never rendered. Ticking it does nothing | tests/render.test.ts, E2E |
| R2 | An "ask" item is rendered without a tick | Only the ids the user ticked for this render go in; a tick list from an older space does not carry over | tests/render.test.ts, E2E |
| R3 | The render is longer than the provider box | Whole items are left out from the end, never a cut item; the result says how many were left out | tests/render.test.ts |
| R4 | Even the instructions alone are longer than the box | The render is empty and says so; it never cuts the text | tests/render.test.ts |
| R5 | Item text holds HTML or Markdown that changes the block (`</context>`, `# Ignore the above`) | The block is plain text in the composer; HTML is never parsed. In Markdown, an item line that would start a heading, quote, list or rule gets a backslash, so an item cannot start a new section | tests/render.test.ts |
| R6 | A space with nothing to render (all private or none ticked) | An empty render with the reason; the picker does not insert an empty block | tests/render.test.ts, E2E |
| R7 | An unknown provider | `bad-request` lists the providers | tests/render.test.ts |

## Import

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| I1 | The file is huge (400 MB) | `too-large` above 1 MB, from the file size before the file is read, and from the text length before it is encoded or parsed | tests/import.test.ts, tests/cli.test.ts |
| I2 | The file holds `__proto__`, `constructor` or `prototype` keys | `bad-import`; no object prototype changes | tests/import.test.ts |
| I3 | The file holds HTML or script in text (`<img src=x onerror=...>`) | The text is kept as plain text. The extension pages show it with `textContent`, so no element is made | tests/import.test.ts, E2E |
| I4 | The format is unknown, or the JSON is not one of the known shapes | `bad-import` names the formats foxspace reads; nothing is guessed | tests/import.test.ts |
| I5 | An imported item has a sensitivity that is weaker than its source (a foxprefs private field) | The source sensitivity is kept. A missing one becomes `ask`; in a foxprefs export, which leaves default levels out, it is the foxprefs default, and `private` for a field foxprefs does not have | tests/import.test.ts |
| I6 | One item in an import fails the item checks | The whole import fails and names the item; nothing is added | tests/import.test.ts |
| I7 | An import repeats items that the space has | An item with the same text and kind is not added twice | tests/spaces.test.ts |
| I8 | A foxprefs export holds `rules.neverShare` | The terms become never-share terms of the space, and are not rendered | tests/import.test.ts |
| I10 | The items fit but the import breaks a space limit (101 never-share terms, 301 items) | The space, its items and its terms are one change: it fails as a whole, and no item, term or empty "Imported from" space is left | tests/cli.test.ts, tests/spaces.test.ts |
| I9 | A foxspace file from someone else marks its spaces agent-readable | An imported space is never agent-readable; the user opts in | tests/import.test.ts |

## Guard

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| G1 | The term is hidden with zero-width characters or a soft hyphen (`pass​port`) | Matches: both sides are NFKC-normalized and stripped of format characters | tests/guard.test.ts, E2E |
| G2 | The term is written with Unicode lookalikes (Cyrillic `а`, fullwidth `Ｐ`, math letters) | Matches: NFKC plus a lookalike map folds them to Latin | tests/guard.test.ts |
| G3 | Case or spacing changes (`ACME  Corp`, `acme\ncorp`) | Matches | tests/guard.test.ts |
| G4 | A number term is written with other separators (`604-555-0199` for `604 555 0199`), or a code with spaces put in it (`AB 1234 56`) | Matches: a term of 6 or more digits matches by its digits; a one-word term of 6 or more characters also matches with spaces in it | tests/guard.test.ts |
| G5 | A short term matches inside a longer word (`Ann` in `banner`) | No match: a term matches whole words only | tests/guard.test.ts |
| G6 | The outgoing text is too long to check | It counts as a match ("too long to check"), so the send stops | tests/guard.test.ts |
| G7 | A term is empty or only spaces after normalization | It is refused when it is saved; it never matches everything | tests/guard.test.ts |
| G8 | The page sees the never-share terms | The terms stay in the event page. The content script sends the composer text and gets a yes or no; the dialog that names the term is an extension page in a frame | E2E |
| G9 | The guard reads more than the composer | The content script reads the composer text at submit time only | code review, E2E |
| G10 | A public or ticked item holds a never-share term, so Insert would put the term in the page before any send | The picker names the term in its frame and turns off Insert and Copy; the event page refuses such an insert | E2E |
| G11 | The user edits the message while the guard dialog is open, or while the check runs, then sends | The send goes out only if the text now is the text that was checked; else it is checked again | E2E |

## Sites and the composer

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| A1 | The composer is not found (not loaded, or the site changed) | The picker says that foxspace cannot find the message box on this site, and inserts nothing | tests/sites.test.ts, E2E |
| A2 | A site redesign changes the composer markup | The adapter finds the composer by an ordered list of selectors; with none matching, A1. A hidden or zero-size match is skipped | tests/sites.test.ts |
| A3 | The insert does not register with the site's editor (React, ProseMirror) | Text goes in with `execCommand("insertText")`, which fires `beforeinput` and `input`. foxspace reads the composer back; when the block is not there, it says so and offers Copy | E2E |
| A4 | The page is not a supported site | The content script does not run there (manifest matches) | tests/sites.test.ts |
| A5 | The page sends a message to the content script or the picker frame | The event page answers only its own pages and the content script's two messages; nothing in the page can list spaces | code review, E2E |

## Extension

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| X1 | The event page unloads between a pick and the insert | All state is in `storage.local` and `storage.session`; the insert message names the space and the ticks | Code review; the E2E does not force an unload |
| X2 | "Send anyway" loops into the guard again | A replayed send skips the guard once | E2E |
| X3 | The trail fails to write | The insert still happens; the spaces page shows that the trail failed | Not tested: the E2E cannot make IndexedDB fail. Code review of `record` in extension/background.js |
| X4 | The sync text is longer than the provider box | The sync page shows the count and the limit, and what was left out | tests/render.test.ts (R3), E2E (count, limit and left-out line) |

## Node store, CLI and MCP

| # | Failure mode | Wanted behaviour | Test |
|---|---|---|---|
| N1 | `$FOXSPACE_HOME/spaces.json` is not JSON | `bad-store`; the file is not changed | tests/node.test.ts |
| N2 | A crash during a write | The write goes to a temp file and renames, so no half file; a failed rename removes the temp file | tests/node.test.ts |
| N4 | `spaces.json` is huge | `bad-store` from the file size, before the file is read | tests/node.test.ts |
| N3 | Two foxspace processes change the store at once, so one change is lost | A change holds `spaces.json.lock` (an exclusive create) from its read to its write. Another process waits up to 10 s, then fails with `bad-store` that names the lock. A lock left by a process that is gone is taken over | tests/node.test.ts |
| C1 | Bad usage (unknown command, missing argument, unknown flag) | Exit 2 with the usage text | tests/cli.test.ts |
| C2 | `show` prints private items | Private text is masked; only its length shows | tests/cli.test.ts |
| C3 | `guard` finds a term | Exit 3 and the term; exit 0 when clean | tests/cli.test.ts |
| M1 | `get_space` gives a space that is not agent-readable, or an item that is not public, or tells an agent which hidden spaces exist | A space that is not agent-readable gets the same not-found answer as a name that does not exist, with the name as the agent wrote it. Only public items are rendered | tests/mcp.test.ts |
| M2 | An MCP tool writes | There is no tool that writes; every tool is marked read-only | tests/mcp.test.ts |
