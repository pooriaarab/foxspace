// @vitest-environment happy-dom
// G10 in docs/failure-modes.md, on the sync page: text with a never-share term is never offered for Copy.
// A6: the popup says so when the page hides the picker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser, ownPage } from "./fake-browser.js";

const html = (name: string) => readFileSync(join(import.meta.dirname, "..", "extension", name), "utf8");
// The extension scripts are plain JS with no types, so they load by name.
const load = (name: string) => import(`../extension/${name}.js`);
const settle = () => new Promise((r) => setTimeout(r, 20));

async function loadBackground() {
  const fake = fakeBrowser();
  vi.stubGlobal("browser", fake.browser);
  const bg = await load("background");
  const space = await bg.spaces.create("Work");
  await bg.spaces.addItems(space.id, [
    { kind: "instructions", text: "Write plainly.", sensitivity: "public" },
    { kind: "memory", text: "Client is Zephyrcorp.", sensitivity: "public" },
  ]);
  await bg.spaces.setNeverShare(space.id, ["Zephyrcorp"]);
  return { ...fake, bg, space };
}

describe("the sync page", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("G10 names the never-share term in sync:render", async () => {
    const { bg, space } = await loadBackground();
    const render = await bg.pageHandlers["sync:render"]({ id: space.id, provider: "chatgpt", box: "more-about-you", ticked: [] });
    expect(render.text).toContain("Zephyrcorp");
    expect(render.stops).toEqual([{ term: "Zephyrcorp", from: "Work" }]);
  });

  it("G10 turns Copy off and says why", async () => {
    const { browser, listeners } = await loadBackground();
    const [onMessage] = listeners["runtime.onMessage"]!;
    browser.runtime.sendMessage = async (message: unknown) => onMessage!(message as never, ownPage("sync.html") as never);
    document.body.innerHTML = html("sync.html").replace(/^[\s\S]*<body[^>]*>|<script[\s\S]*$/g, "");
    await load("sync");
    await settle();
    (document.getElementById("box") as HTMLSelectElement).value = "more-about-you";
    document.getElementById("box")!.dispatchEvent(new Event("change"));
    await settle();
    expect([(document.getElementById("copy") as HTMLButtonElement).disabled, document.getElementById("status")!.textContent]).toEqual([
      true,
      'This text holds a never-share term: "Zephyrcorp". Untick that item, or make it private.',
    ]);
  });
});

describe("the popup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("A6 says so when the page hides the picker", async () => {
    const { browser, listeners } = await loadBackground();
    const error = "This page hides the foxspace picker, so foxspace does not open it or insert from it.";
    browser.tabs.query = async () => [{ id: 7, url: "https://chatgpt.com/" }] as never;
    browser.tabs.sendMessage = async () => ({ ok: false, error });
    const [onMessage] = listeners["runtime.onMessage"]!;
    expect(await onMessage!({ type: "popup:open-picker" } as never, ownPage("popup.html") as never)).toEqual({ ok: false, code: "bad-request", error });
  });
});
