// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://chatgpt.com/"}
// A6 in docs/failure-modes.md: a page that hides the foxspace UI gets no picker and no insert.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "./fake-browser.js";

const HIDES = "This page hides the foxspace picker, so foxspace does not open it or insert from it.";
let root: ShadowRoot;
let send: (message: unknown) => Promise<{ ok: boolean; error?: string; landed?: boolean }>;
const host = () => document.querySelector("foxspace-ui") as HTMLElement;
const picker = () => root.querySelector("iframe");

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setInterval"] });
  document.documentElement.querySelector("foxspace-ui")?.remove();
  document.body.innerHTML = readFileSync(join(import.meta.dirname, "fixtures", "sites", "chatgpt.html"), "utf8");
  // happy-dom has no layout: give the composer a box, as Firefox does.
  const composer = document.querySelector("#prompt-textarea") as HTMLElement;
  composer.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 600, width: 600, height: 60 });
  const attach = HTMLElement.prototype.attachShadow;
  vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(function (this: HTMLElement, init) {
    root = attach.call(this, init);
    return root;
  });
  const fake = fakeBrowser();
  vi.stubGlobal("browser", fake.browser);
  await import(`../extension/${"content"}.js`);
  const [onMessage] = fake.listeners["runtime.onMessage"]!;
  send = (message) => onMessage!(message as never, { id: fake.browser.runtime.id } as never) as never;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.getElementById("foxspace-test-style")?.remove();
});
const pageStyle = (css: string) => document.head.append(Object.assign(document.createElement("style"), { id: "foxspace-test-style", textContent: css }));

describe("a page that hides the foxspace UI", () => {
  it("A6 opens the picker when the page leaves the UI alone", async () => {
    expect(await send({ type: "foxspace:open-picker" })).toEqual({ ok: true });
    expect(picker()).not.toBeNull();
  });

  it("A6 does not open the picker under a hidden host or <html>", async () => {
    host().style.opacity = "0";
    expect(await send({ type: "foxspace:open-picker" })).toEqual({ ok: false, error: HIDES });
    host().style.opacity = "";
    pageStyle("html { filter: opacity(0.05) }");
    expect(await send({ type: "foxspace:open-picker" })).toEqual({ ok: false, error: HIDES });
    expect(picker()).toBeNull();
  });

  it("A6 refuses the insert and closes the picker when the page hides it after it opened", async () => {
    await send({ type: "foxspace:open-picker" });
    pageStyle("foxspace-ui { visibility: hidden !important }");
    expect(await send({ type: "foxspace:insert", text: "My salary is 91000 CAD." })).toEqual({ ok: false, error: HIDES });
    expect([picker(), document.querySelector("#prompt-textarea")!.textContent!.includes("91000")]).toEqual([null, false]);
  });

  it("A6 closes the picker when focus moves into it while it is hidden", async () => {
    await send({ type: "foxspace:open-picker" });
    host().style.mixBlendMode = "multiply";
    dispatchEvent(new Event("blur"));
    expect(picker()).toBeNull();
  });
});
