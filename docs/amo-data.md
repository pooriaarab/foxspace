# What the foxspace add-on sends, and its AMO data declaration

The manifest declares `data_collection_permissions: { "required": ["none"] }`.
This page lists everything that the add-on in `extension/` moves out of the
add-on, and why no AMO data type applies to it.

AMO's add-on policies define data transmission as data "collected, used,
transferred, shared, or handled outside of the add-on or the local browser".
The data types for the manifest key are listed at
https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/.

## What leaves the add-on

| What | To where | Why no data type applies |
|---|---|---|
| The block the user picks | The message box of the chat page in this tab, after the user presses Insert | The user chooses each item and sees the text before sending. foxspace never sends it; the user sends it to the site. Private items never go in |
| The message text at a send | foxspace's own event page, to check it for never-share terms | It stays in the add-on. foxspace stores nothing of it and sends it nowhere |
| The sync text | The clipboard, when the user presses Copy | The user moves it |
| The export file | A download, when the user presses Export | The user saves it |
| The injection trail | IndexedDB in this browser | It stays in the local browser |

The add-on makes no network requests. Its only host access is the content
script on the seven chat sites. The E2E build (`dist-e2e/`) adds a host
permission for the create-foxkit frame host on `*.trycloudflare.com`;
release.yml signs `dist-ext/`, which never has it.

If a later change sends data off the browser, the same change must add the
matching data types to `data_collection_permissions`.
