// The picker, in a frame on the chat page. The user picks a space and ticks
// the "ask" items for this message. Public items always go in; private
// items never reach this frame (the event page leaves them out). Insert
// puts the block in the composer; nothing is sent.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxspace did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const KINDS = { instructions: "Instructions", preference: "Preference", memory: "Memory", snippet: "Snippet" };
let state;
let render;

function status(text, bad = false) {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
}
const failed = (error) => status(error instanceof Error ? error.message : String(error), true);
const space = () => state.spaces.find((s) => s.id === $("space").value);
const ticked = () => [...document.querySelectorAll("input[data-item]:checked:not(:disabled)")].map((i) => i.dataset.item);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

// Each change asks again; only the answer to the last ask is shown, so a slow
// answer to an older tick cannot overwrite a newer one.
let asked = 0;
async function preview() {
  const mine = ++asked;
  const next = await ask("picker:render", { id: space().id, ticked: ticked() });
  if (mine !== asked) return;
  render = next;
  $("preview").textContent = render.text || render.empty;
  $("preview").classList.toggle("empty", !render.text);
  $("count").textContent = render.text ? `${render.text.length} characters` : "";
  // G10: a block that holds a never-share term does not go into the page, nor to the clipboard.
  const stopped = render.stops.length > 0;
  $("insert").disabled = $("copy").disabled = !render.text || stopped;
  const notes = [];
  if (render.left.tooLong) notes.push(`${render.left.tooLong} item${render.left.tooLong === 1 ? "" : "s"} did not fit.`);
  if (stopped) notes.push(`This block holds a never-share term: ${render.stops.map((m) => `"${m.term}"`).join(", ")}. Untick that item, or make it private.`);
  $("left").textContent = notes.join(" ");
  $("left").classList.toggle("bad", stopped);
}

function showSpace() {
  const s = space();
  $("items").replaceChildren(...s.items.map((item) => {
    const box = el("input", { type: "checkbox", checked: item.sensitivity === "public", disabled: item.sensitivity === "public" });
    box.dataset.item = item.id;
    box.addEventListener("change", () => preview().catch(failed));
    const level = el("span", { className: `level ${item.sensitivity}`, textContent: item.sensitivity === "public" ? "always" : "ask" });
    return el("li", {}, [el("label", {}, [box, el("span", { className: "text" }, [el("b", { textContent: `${KINDS[item.kind]}: ` }), item.text]), level])]);
  }));
  if (s.privateCount) $("items").append(el("li", { className: "note", textContent: s.privateCount === 1 ? "1 private item stays out." : `${s.privateCount} private items stay out.` }));
  return preview();
}

// Load the spaces, keep the chosen one if it is still there. With no space,
// the picker asks for a name first; with a space, the add form is open.
async function load(pick) {
  state = await ask("picker:state");
  $("title").textContent = `Add a space to ${state.label}`;
  const none = state.spaces.length === 0;
  $("space").hidden = $("add").hidden = none;
  $("make").hidden = !none;
  if (none) {
    $("items").replaceChildren();
    $("insert").disabled = $("copy").disabled = true;
    $("preview").textContent = "You have no spaces yet. Name one to start.";
    $("make-name").focus();
    return;
  }
  $("space").replaceChildren(...state.spaces.map((s) => el("option", { value: s.id, textContent: s.name })));
  if (pick && state.spaces.some((s) => s.id === pick)) $("space").value = pick;
  await showSpace();
}

async function start() {
  $("space").addEventListener("change", () => showSpace().catch(failed));
  await load();
  if (!$("space").hidden) $("space").focus();
}

$("new-space").addEventListener("click", () => {
  $("make").hidden = !$("make").hidden;
  if (!$("make").hidden) $("make-name").focus();
});
$("manage").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("spaces.html") }).catch(failed));
$("make").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const made = await ask("spaces:create", { name: $("make-name").value.trim() });
    $("make-name").value = "";
    await load(made.id);
    status(`Made "${made.name}". Add an item below.`);
    $("add-text").focus();
  } catch (error) {
    failed(error);
  }
});
$("add").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const id = space().id;
    const level = $("add-level").value;
    await ask("spaces:add", { id, items: [{ kind: $("add-kind").value, text: $("add-text").value.trim(), sensitivity: level }] });
    $("add-text").value = "";
    await load(id);
    status(level === "private" ? "Added. It is private, so it stays out of every message." : "Added.");
    $("add-text").focus();
  } catch (error) {
    failed(error);
  }
});

$("insert").addEventListener("click", async () => {
  try {
    const r = await ask("picker:insert", { id: space().id, ticked: ticked() });
    if (!r.ok) return status(r.error, true);
    if (!r.landed) return status(`${state.label} did not take the text. Press Copy, then paste it into the message box.`, true);
    status(`Added ${r.items} item${r.items === 1 ? "" : "s"}. Read it, then send.`);
  } catch (error) {
    failed(error);
  }
});
$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(render.text);
    status(`Copied ${render.text.length} characters.`);
  } catch (error) {
    failed(error);
  }
});
$("close").addEventListener("click", () => ask("picker:close").catch(failed));
addEventListener("keydown", (event) => {
  if (event.key === "Escape") ask("picker:close").catch(failed);
});

start().catch(failed);
