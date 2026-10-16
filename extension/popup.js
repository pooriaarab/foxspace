// The toolbar popup: the spaces at a glance, the picker for the current
// tab, and the site access that Firefox may not have granted at install.
import { SITE_MATCHES } from "../src/sites.ts";

const $ = (id) => document.getElementById(id);
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxspace did not answer.");
  return reply.value;
};
const status = (text) => ($("status").textContent = text);
const origins = { origins: [...SITE_MATCHES] };

async function start() {
  $("access").hidden = await browser.permissions.contains(origins);
  const spaces = await ask("spaces:list");
  $("spaces").replaceChildren(...spaces.map((s) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("span"), { textContent: s.name }), Object.assign(document.createElement("span"), { className: "count", textContent: `${s.items.length} item${s.items.length === 1 ? "" : "s"}` }));
    return li;
  }));
  if (!spaces.length) $("spaces").append(Object.assign(document.createElement("li"), { className: "note", textContent: "No spaces yet. Make one on the Spaces page." }));
}

$("grant").addEventListener("click", async () => {
  // Called from the click, as permissions.request needs.
  $("access").hidden = await browser.permissions.request(origins);
});
$("picker").addEventListener("click", async () => {
  try {
    await ask("popup:open-picker");
    close();
  } catch (error) {
    status(error instanceof Error ? error.message : String(error));
  }
});
start().catch((error) => status(String(error)));
