// The sync page: a space as text sized for one settings box of a chat
// site, with a copy button and the way to the box. Private items never go
// in; "ask" items only when ticked here. Writing into the site's settings
// is not automated in v0.1.
import { PROVIDERS } from "../src/providers.ts";

const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxspace did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
let spaces = [];
let render;

function status(text, bad = false) {
  $("status").textContent = text;
  $("status").classList.toggle("bad", bad);
}
const failed = (error) => status(error instanceof Error ? error.message : String(error), true);
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
};
const provider = () => PROVIDERS.find((p) => p.id === $("provider").value);
const box = () => provider().sync.find((b) => b.id === $("box").value);
const ticked = () => [...document.querySelectorAll("#ticks input:checked")].map((i) => i.dataset.item);

function showTicks() {
  const space = spaces.find((s) => s.id === $("space").value);
  const items = space?.items.filter((i) => i.sensitivity === "ask") ?? [];
  $("ticks").replaceChildren(...items.map((item) => {
    const input = el("input", { type: "checkbox" });
    input.dataset.item = item.id;
    input.addEventListener("change", () => update().catch(failed));
    return el("li", {}, [el("label", {}, [input, el("span", { className: "text", textContent: item.text })])]);
  }));
  if (!items.length) $("ticks").append(el("li", { className: "note", textContent: "None in this space." }));
}

function showBoxes() {
  const p = provider();
  $("box").replaceChildren(...p.sync.map((b) => el("option", { value: b.id, textContent: b.label })));
  $("box").disabled = !p.sync.length;
  $("open").hidden = !p.settingsUrl;
  if (p.settingsUrl) Object.assign($("open"), { href: p.settingsUrl, textContent: `Open ${p.label} settings` });
}

// Each change asks again; only the answer to the last ask is shown, so a slow
// answer to an older choice cannot overwrite a newer one.
let asked = 0;
async function update() {
  const mine = ++asked;
  const p = provider();
  const b = box();
  $("target").textContent = b ? `${p.label}: ${b.label}` : p.label;
  $("where").textContent = b ? `Paste it in ${p.settingsPath}.` : p.settingsPath;
  if (!b || !$("space").value) {
    render = undefined;
    $("text").textContent = b ? "Make a space first, on the spaces page." : `${p.label} has no settings box to sync to. Use the picker on the site instead.`;
    $("count").textContent = $("limit").textContent = "";
    $("copy").disabled = true;
    return;
  }
  const next = await ask("sync:render", { id: $("space").value, provider: p.id, box: b.id, ticked: ticked() });
  if (mine !== asked) return;
  render = next;
  $("text").textContent = render.text || render.empty;
  $("text").classList.toggle("empty", !render.text);
  // G10: text with a never-share term is never offered for Copy.
  $("copy").disabled = !render.text || render.stops.length > 0;
  status(render.stops.length ? `This text holds a never-share term: ${render.stops.map((m) => `"${m.term}"`).join(", ")}. Untick that item, or make it private.` : "", render.stops.length > 0);
  const left = [render.left.private && `${render.left.private} private`, render.left.unticked && `${render.left.unticked} "ask" not ticked`, render.left.tooLong && `${render.left.tooLong} too long for the box`].filter(Boolean);
  $("count").textContent = `${render.text.length.toLocaleString("en")} / ${b.limit.toLocaleString("en")} characters${left.length ? `. Left out: ${left.join(", ")}.` : "."}`;
  $("limit").textContent = `${b.limitIs === "documented" ? "Limit from the site" : b.limitIs === "reported" ? "Limit from reports" : "No limit documented"}: ${b.note}`;
}

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(render.text);
    status(`Copied ${render.text.length} characters. Paste them in ${provider().label}: ${box().label}.`);
  } catch (error) {
    failed(error);
  }
});
for (const id of ["space", "box"]) $(id).addEventListener("change", () => (id === "space" && showTicks(), update().catch(failed)));
$("provider").addEventListener("change", () => (showBoxes(), update().catch(failed)));

async function start() {
  spaces = await ask("spaces:list");
  $("space").replaceChildren(...spaces.map((s) => el("option", { value: s.id, textContent: s.name })));
  $("provider").replaceChildren(...PROVIDERS.map((p) => el("option", { value: p.id, textContent: p.label })));
  showBoxes();
  showTicks();
  await update();
}
start().catch(failed);
