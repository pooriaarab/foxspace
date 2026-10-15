# The files foxspace reads

`parseImport` reads one JSON file of at most 1 MB. A file with a
`__proto__`, `constructor` or `prototype` key is refused. Every item is
checked as a space item (docs/failure-modes.md S1-S4) before anything is
added, so one bad item fails the whole import. A missing sensitivity is
`ask`.

| Format | Shape | Becomes |
|---|---|---|
| `foxspace/v1` | The foxspace export: `{format, spaces, updatedAt}` | New spaces with new ids, never agent-readable. A taken name gets " (2)" |
| `foxcache/v1` archive | `{format: "foxcache/v1", exportedAt?, memories?: Entry[], preferences?: Entry[], ...}` | Memory and preference items. Other sections (chats, projects) are listed as ignored |
| `foxcache/v1` memory list | A bare JSON list of `Entry`, or `{format: "foxcache/v1", kind: "memories", memories: Entry[]}` | Memory items |
| `foxpack/v1` | `{format: "foxpack/v1", memories: Entry[]}` | Memory items, source `foxpack` |
| `foxprefs/v1` | The foxprefs export: `{format, values, sensitivity, updatedAt}` | One preference item per value, as `Label: value`. Its level is the one the user chose in foxprefs, else the foxprefs default (the export leaves defaults out), else `private` for a field foxprefs does not have. `rules.neverShare` becomes never-share terms |
| `foxprefs/rules-v1` | The output of `foxprefs rules` | Its `neverShare` list becomes never-share terms |

`Entry` is a string, or `{text, site?, sensitivity?}`. Other keys of an
entry are not read. `site` becomes the item source, for example
`foxcache:chatgpt.com`.

Pasted text that is not JSON becomes one item per paragraph (text between
blank lines). Pasted instructions are one item.

## Open question

foxcache and foxpack do not publish their export formats yet. The shapes
above are what foxspace expects; align them when those formats are out.
