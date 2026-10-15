// The spaces page: the list of spaces and the editor of one. Every change
// goes to the event page, which checks it; a refused change shows its reason.
// Text is shown with textContent only, so an imported item never becomes HTML (I3).
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxspace did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const KINDS = { instructions: "Instructions", preference: "Preference", memory: "Memory", snippet: "Snippet" };
const LEVELS = ["public", "ask", "private"];
let all = [];
let current = "";

function status(text, bad = false) {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
}
const failed = (error) => status(error instanceof Error ? error.message : String(error), true);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

function levelSelect(value, label) {
  const select = el("select", { className: "sens", title: "Who can read this" }, LEVELS.map((l) => el("option", { value: l, textContent: l })));
  select.value = select.dataset.level = value;
  select.setAttribute("aria-label", label);
  return select;
}

function itemRow(space, item) {
  const text = el("div", { className: "text", textContent: item.text });
  if (item.source) text.append(el("span", { className: "source", textContent: `from ${item.source}` }));
  const level = levelSelect(item.sensitivity, `Who can read: ${item.text.slice(0, 40)}`);
  level.dataset.item = item.id;
  level.addEventListener("change", async () => {
    try {
      await ask("spaces:item", { id: space.id, itemId: item.id, patch: { sensitivity: level.value } });
      status(`Item is ${level.value} now.`);
      await load();
    } catch (error) {
      failed(error);
    }
  });
  const remove = el("button", { className: "ghost small", type: "button", textContent: "Remove" });
  remove.addEventListener("click", async () => {
    await ask("spaces:remove-item", { id: space.id, itemId: item.id }).then(load, failed);
    status("Removed the item.");
  });
  const row = el("li", { className: `item ${item.sensitivity}` }, [el("span", { className: "kind", textContent: KINDS[item.kind] }), text, level, remove]);
  row.dataset.id = item.id;
  return row;
}

function show() {
  const list = $("list");
  list.replaceChildren(...all.map((s) => {
    const button = el("button", { type: "button" }, [el("span", { textContent: s.name }), el("span", { className: "count", textContent: String(s.items.length) })]);
    button.setAttribute("aria-current", String(s.id === current));
    button.addEventListener("click", () => {
      current = s.id;
      location.hash = s.id;
      show();
    });
    return el("li", {}, [button]);
  }));
  if (!all.length) list.append(el("li", { className: "empty", textContent: "No spaces yet. Create one below." }));
  const space = all.find((s) => s.id === current);
  $("editor").hidden = !space;
  if (!space) return;
  $("name").value = space.name;
  $("agent").checked = space.agentReadable;
  $("items").replaceChildren(...space.items.map((i) => itemRow(space, i)));
  if (!space.items.length) $("items").append(el("li", { className: "note", textContent: "No items yet. Add one below, or import a foxcache export." }));
  $("terms").value = space.neverShare.join("\n");
}

async function load() {
  all = await ask("spaces:list");
  if (!all.some((s) => s.id === current)) current = all.find((s) => s.id === location.hash.slice(1))?.id ?? all[0]?.id ?? "";
  show();
}

$("new").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const space = await ask("spaces:create", { name: $("new-name").value });
    $("new-name").value = "";
    current = space.id;
    location.hash = space.id;
    status(`Created "${space.name}".`);
    await load();
  } catch (error) {
    failed(error);
  }
});
$("name").addEventListener("change", () => ask("spaces:rename", { id: current, name: $("name").value }).then(() => (status("Renamed the space."), load()), failed));
$("agent").addEventListener("change", () => ask("spaces:agent", { id: current, agentReadable: $("agent").checked }).then(() => (status($("agent").checked ? "Agents may read the public items now." : "Agents cannot read this space now."), load()), failed));
$("delete").addEventListener("click", async () => {
  const space = all.find((s) => s.id === current);
  if (!space || !confirm(`Delete "${space.name}" and its ${space.items.length} items?`)) return;
  await ask("spaces:remove", { id: current }).then(() => (status(`Deleted "${space.name}".`), load()), failed);
});
$("add-sens").addEventListener("change", () => ($("add-sens").dataset.level = $("add-sens").value));
$("add").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const { added, skipped } = await ask("spaces:paste", { id: current, text: $("add-text").value, kind: $("add-kind").value, sensitivity: $("add-sens").value });
    $("add-text").value = "";
    status(`Added ${added.length} item${added.length === 1 ? "" : "s"}${skipped ? `; ${skipped} already there` : ""}.`);
    await load();
  } catch (error) {
    failed(error);
  }
});
$("save-terms").addEventListener("click", async () => {
  try {
    const terms = $("terms").value.split("\n").map((t) => t.trim()).filter(Boolean);
    const space = await ask("spaces:never-share", { id: current, terms });
    status(`Saved ${space.neverShare.length} never-share term${space.neverShare.length === 1 ? "" : "s"}.`);
    await load();
  } catch (error) {
    failed(error);
  }
});

async function importText(text) {
  try {
    const r = await ask("spaces:import", { text, into: current });
    $("import-text").value = "";
    if (r.spaces) status(`Imported ${r.format}: added ${r.spaces.length} space${r.spaces.length === 1 ? "" : "s"}.`);
    else {
      const notes = [`Imported ${r.format}: added ${r.added} item${r.added === 1 ? "" : "s"} to "${r.space}"${r.skipped ? ` (${r.skipped} already there)` : ""}.`];
      if (r.terms) notes.push(`Added ${r.terms} never-share term${r.terms === 1 ? "" : "s"}.`);
      if (r.ignored.length) notes.push(`Not read: ${r.ignored.join(", ")}.`);
      status(notes.join(" "));
    }
    await load();
  } catch (error) {
    failed(error);
  }
}
$("import").addEventListener("click", () => importText($("import-text").value));
$("import-pick").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files?.[0];
  $("import-file").value = "";
  // The event page checks the size too; this stops a huge file before it is read.
  if (file && file.size > 1024 * 1024) return status("The file is larger than 1024 KB.", true);
  if (file) await importText(await file.text());
});
$("export").addEventListener("click", async () => {
  try {
    const state = await ask("spaces:export");
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: "application/json" }));
    el("a", { href: url, download: `foxspace-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported ${state.spaces.length} space${state.spaces.length === 1 ? "" : "s"}. The file holds private items too; keep it safe.`);
  } catch (error) {
    failed(error);
  }
});

load().catch(failed);
