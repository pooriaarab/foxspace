// The Firefox E2E test. Firefox gets synthetic copies of the seven chat
// origins foxspace supports through WebDriver BiDi network interception
// (e2e/intercept.mjs), each with the editor that site uses: the real
// prosemirror-view on ChatGPT, Claude, Le Chat and Grok, lexical on
// Perplexity, quill on Gemini and a React-style textarea on DeepSeek
// (e2e/editors/editor.js). The extension's content script runs there as on
// the real sites, and the checks read each editor's own model. The test
// drives the real pages: the spaces page (create, import a foxcache archive,
// add, never-share), the picker (private and "ask" items), the guard (stop,
// Edit, Send anyway), a redesigned page with no composer, the sync page,
// the trail, and an insert and an Enter send on every site.
// Writes artifacts/e2e-<date>.json after the checks.
// Usage: pnpm e2e [--headed]. Env: FIREFOX, or FOXKIT_BROWSER=ichabod with ICHABOD_API_KEY.
import { readFileSync } from "node:fs";
import { browserMode, launch, poll, writeArtifact } from "create-foxkit/e2e";
import { build } from "esbuild";
import { BUILT, interceptSites } from "./intercept.mjs";

const record = { startedAt: new Date().toISOString(), mode: browserMode(), checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Each site, with the composer selector of its foxspace adapter.
const SITES = {
  "chatgpt.com": "#prompt-textarea",
  "claude.ai": "div.ProseMirror",
  "chat.mistral.ai": "div.ProseMirror",
  "gemini.google.com": "rich-textarea .ql-editor",
  "www.perplexity.ai": "#ask-input",
  "grok.com": "div.tiptap.ProseMirror",
  "chat.deepseek.com": "#chat-input",
};
const SPACE = "Kyoto in May";
const ARCHIVE = readFileSync("tests/fixtures/foxcache-archive.json", "utf8");

/** The extension frame at path inside a chat page, found by its location (BiDi reports about:blank). */
async function frameOf(page, path, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const f of page.frames()) {
      if (f !== page.mainFrame() && (await f.evaluate(() => location.pathname).catch(() => "")) === path) return f;
    }
    if (Date.now() > deadline) return undefined;
    await sleep(200);
  }
}
const gone = async (page, path) => !(await frameOf(page, path, 1500));

/** Open a chat page and click the foxspace button, as a user does: it is in a closed shadow root. */
async function openChat(fox, url, composer) {
  const page = await fox.open(url);
  await page.setViewport({ width: 1000, height: 800 });
  await poll(page, (s) => Boolean(document.querySelector("foxspace-ui") && document.querySelector(s)), composer);
  await sleep(900); // the button follows the composer every 700 ms
  return page;
}
async function clickFox(page, composer) {
  const box = await page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { right: r.right, top: r.top };
  }, composer);
  await page.mouse.click(Math.min(1000 - 36, box.right - 32) + 14, Math.max(4, box.top - 34) + 14);
  const picker = await frameOf(page, "/picker.html");
  await poll(picker, () => document.getElementById("count").textContent || document.getElementById("status").textContent);
  return picker;
}
const sent = (page) => page.evaluate(() => [...document.querySelectorAll("#sent li")].map((li) => li.textContent));
const editorState = (page) => page.evaluate(() => document.documentElement.dataset.editorState ?? "");
// Alt+Shift+K, typed in the browser window from the parent process. The manifest binds
// MacCtrl+Shift+K on macOS, so there the first key is Control.
const MOD = process.platform === "darwin" ? `key("Control", "ControlLeft", 17)` : `key("Alt", "AltLeft", 18)`;
const SHORTCUT = `(() => {
  const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  tip.beginInputTransactionForTests(window);
  const key = (k, code, keyCode) => new KeyboardEvent("", { key: k, code, keyCode });
  const keys = [${MOD}, key("Shift", "ShiftLeft", 16), key("K", "KeyK", 75)];
  for (const k of keys) tip.keydown(k);
  for (const k of keys.reverse()) tip.keyup(k);
})()`;
/**
 * Press Alt+Shift+K as a user does, to open the picker through the
 * extension's command. BiDi key actions stay in the page and never reach
 * the browser's shortcuts, so the key goes in from the browser window: the
 * chrome scope that -remote-allow-system-access opens. Ichabod's Firefox
 * runs without it, so in that mode the caller clicks the button instead.
 */
async function pressShortcut(page) {
  await page.bringToFront();
  const bidi = fox.browser.connection;
  const tree = await bidi.send("browsingContext.getTree", { "moz:scope": "chrome" });
  await bidi.send("script.evaluate", { target: { context: tree.result.contexts[0].context }, "moz:scope": "chrome", awaitPromise: false, expression: SHORTCUT });
  return frameOf(page, "/picker.html");
}
/** Wait for an insert to settle: the block is in the editor, or the picker says it is not. Remote runs are slow. */
const landed = (page, picker) =>
  Promise.any([
    poll(page, () => (document.documentElement.dataset.editorState ?? "").startsWith("Context for this chat"), undefined, 15_000),
    poll(picker, () => document.getElementById("status").textContent, undefined, 15_000),
  ]).then(() => sleep(300), () => {});
/** Choose the space by name in the picker: the extension seeds two example spaces first. */
async function pickSpace(picker, name) {
  await picker.evaluate((n) => {
    const select = document.getElementById("space");
    select.value = [...select.options].find((o) => o.textContent === n).value;
    select.dispatchEvent(new Event("change"));
  }, name);
  await poll(picker, () => document.getElementById("preview").textContent.includes("Plan by train."));
}

let fox;
try {
  await build({ entryPoints: ["e2e/editors/editor.js"], outfile: `${BUILT}/editor.js`, bundle: true, format: "esm", target: "firefox140", logLevel: "warning" });
  fox = await launch({ extension: "dist-e2e", headless: !process.argv.includes("--headed") });
  record.firefox = await fox.browser.version();
  const intercept = await interceptSites(fox.browser, Object.keys(SITES));
  record.interceptId = intercept.id;

  // 1. Build a space on the real spaces page: create, import the foxcache archive, add, never-share.
  const spaces = await fox.openExtensionPage("spaces.html");
  await poll(spaces, () => Boolean(document.getElementById("new-name")));
  const statusText = () => spaces.evaluate(() => document.getElementById("status").textContent);
  // 0. A new install has the two example spaces. Delete them, so the steps below start empty.
  const listNames = () => spaces.evaluate(() => [...document.querySelectorAll("#list li button span:first-child")].map((s) => s.textContent));
  // The install seeds them in the background, so the page can load first: wait for the seed, then reload.
  await poll(spaces, async () => (await browser.storage.local.get("seeded")).seeded === true);
  if ((await spaces.evaluate(() => document.querySelectorAll("#list li button").length)) !== 2) await spaces.evaluate(() => location.reload());
  await poll(spaces, () => document.querySelectorAll("#list li button").length === 2);
  check("a new install has the example spaces", ["Trip to Japan", "Work: Acme launch"], (await listNames()).toSorted());
  for (const left of [1, 0]) {
    await spaces.evaluate(() => (window.confirm = () => true));
    await spaces.click("#delete");
    await poll(spaces, (n) => document.querySelectorAll("#list li button").length === n, left);
  }
  check("the example spaces can be deleted", [], await listNames());
  await spaces.type("#new-name", SPACE);
  await spaces.click("#new button");
  await poll(spaces, () => !document.getElementById("editor").hidden);
  check("the space is created", `Created "${SPACE}".`, await statusText());
  await spaces.evaluate((text) => (document.getElementById("import-text").value = text), ARCHIVE);
  await spaces.click("#import");
  await poll(spaces, () => document.getElementById("status").textContent.startsWith("Imported"));
  check("the foxcache archive imports", `Imported foxcache/v1: added 5 items to "${SPACE}". Not read: chats.`, await statusText());
  check("imported items keep their level, ask by default", ["public", "ask", "private", "ask", "public"], await spaces.evaluate(() => [...document.querySelectorAll("#items select.sens")].map((s) => s.value)));
  check("HTML in an import stays text (I3)", [0, true], await spaces.evaluate(() => [document.querySelectorAll("#items img").length, document.getElementById("items").textContent.includes("<img src=x")]));
  await spaces.select("#add-kind", "instructions");
  await spaces.select("#add-sens", "public");
  await spaces.type("#add-text", "Plan by train. Keep each day light.");
  await spaces.click("#add button");
  await poll(spaces, () => document.getElementById("status").textContent.startsWith("Added"));
  check("an instruction item is added", "Added 1 item.", await statusText());
  await spaces.type("#terms", "AB123456");
  await spaces.click("#save-terms");
  await poll(spaces, () => document.getElementById("status").textContent.startsWith("Saved"));
  check("a never-share term is saved", "Saved 1 never-share term.", await statusText());

  // 2. Inject on chatgpt.com (ProseMirror): public in, private never, "ask" only when ticked (R1, R2, A3).
  const gpt = await openChat(fox, "https://chatgpt.com/", "#prompt-textarea");
  let picker = await clickFox(gpt, "#prompt-textarea");
  await pickSpace(picker, SPACE);
  const preview = () => picker.evaluate(() => document.getElementById("preview").textContent);
  let text = await preview();
  check("the picker preview has the public items", [true, true, true], ["Plan by train.", "I am vegetarian", "Answer in short paragraphs."].map((s) => text.includes(s)));
  check("the preview has no private or unticked ask item", [false, false, false], ["AB123456", "3000 CAD", "quiet hotels"].map((s) => text.includes(s)));
  check("the picker says the private item stays out", "1 private item stays out.", await picker.evaluate(() => document.querySelector("#items li.note")?.textContent));
  await picker.evaluate(() => [...document.querySelectorAll("#items label")].find((l) => l.textContent.includes("3000 CAD")).querySelector("input").click());
  await poll(picker, () => document.getElementById("preview").textContent.includes("3000 CAD"));
  check("the page cannot read the picker or its preview (G8)", [false, true], await gpt.evaluate(() => [document.documentElement.innerText.includes("3000 CAD"), document.querySelector("foxspace-ui").shadowRoot === null]));
  const block = await preview();
  await picker.click("#insert");
  await poll(gpt, () => (document.documentElement.dataset.editorState ?? "").includes("3000 CAD"));
  const state = await editorState(gpt);
  record.injected = state;
  check("ProseMirror's model holds the block, line for line (A3)", block, state);
  check("no private item and no unticked ask item went in (R1, R2)", [false, false], ["AB123456", "quiet hotels"].map((s) => state.includes(s)));
  check("the picker closes after the insert", true, await gone(gpt, "/picker.html"));
  check("nothing was sent by the insert", [], await sent(gpt));

  // 3. Guard on chatgpt.com: a clean send goes through; a hidden term stops; Send anyway sends once (G1, X2).
  await gpt.click('[data-testid="send-button"]');
  await poll(gpt, () => document.querySelectorAll("#sent li").length === 1);
  check("a clean message is sent through the guard", 1, (await sent(gpt)).length);
  await gpt.click("#prompt-textarea");
  await gpt.evaluate(() => document.execCommand("insertText", false, "My passport is AB 1234​56, book the rail pass."));
  await gpt.click('[data-testid="send-button"]');
  let dialog = await frameOf(gpt, "/guard.html");
  await poll(dialog, () => document.querySelectorAll("#terms li").length > 0);
  check("the guard stops the send and names the term", [`AB123456 from ${SPACE}`], await dialog.evaluate(() => [...document.querySelectorAll("#terms li")].map((li) => li.textContent)));
  check("the stopped message was not sent", 1, (await sent(gpt)).length);
  check("the page never sees the term or the dialog (G8)", [false, false], await gpt.evaluate((n) => [document.documentElement.innerText.includes("AB123456"), document.documentElement.innerText.includes(`from ${n}`)], SPACE));
  // G11: an edit while the dialog is open is checked again before it goes out.
  await gpt.click("#prompt-textarea");
  await gpt.evaluate(() => document.execCommand("insertText", false, " Thanks."));
  await dialog.click("#send");
  await sleep(800);
  dialog = await frameOf(gpt, "/guard.html");
  check("an edit after the stop is checked again, not sent", [1, true], [(await sent(gpt)).length, Boolean(dialog)]);
  await poll(dialog, () => document.querySelectorAll("#terms li").length > 0);
  await dialog.click("#send");
  await poll(gpt, () => document.querySelectorAll("#sent li").length === 2);
  check("Send anyway sends it once", [2, true], [(await sent(gpt)).length, (await sent(gpt))[1].includes("AB 1234")]);
  check("the dialog closes", true, await gone(gpt, "/guard.html"));

  // 4. Guard on claude.ai with Enter: Edit keeps the text and sends nothing; a clean Enter goes through.
  const claude = await openChat(fox, "https://claude.ai/", "div.ProseMirror");
  await claude.click("div.ProseMirror");
  await claude.keyboard.type("Book a hotel for passport ab123456");
  await claude.keyboard.press("Enter");
  dialog = await frameOf(claude, "/guard.html");
  await poll(dialog, () => document.querySelectorAll("#terms li").length > 0);
  await dialog.click("#edit");
  await sleep(500);
  check("Edit sends nothing and keeps the text", [0, true, true], [(await sent(claude)).length, (await editorState(claude)).includes("ab123456"), await gone(claude, "/guard.html")]);
  await claude.evaluate(() => window.chatEditor.clear());
  await claude.click("div.ProseMirror");
  await claude.keyboard.type("Hello there");
  await claude.keyboard.press("Enter");
  await poll(claude, () => document.querySelectorAll("#sent li").length === 1);
  check("a clean Enter is sent through the guard", ["Hello there"], await sent(claude));

  // 5. Inject into a React-style textarea on chat.deepseek.com.
  const deep = await openChat(fox, "https://chat.deepseek.com/", "#chat-input");
  picker = await clickFox(deep, "#chat-input");
  await pickSpace(picker, SPACE);
  const deepBlock = await preview();
  await picker.click("#insert");
  await poll(deep, () => (document.documentElement.dataset.editorState ?? "").includes("Plan by train."));
  check("the textarea took the block from input events", deepBlock, await editorState(deep));

  // 6. A redesign with no composer the adapter knows: the picker says so and inserts nothing (A1).
  const redesign = await fox.open("https://chatgpt.com/redesign");
  await poll(redesign, () => Boolean(document.querySelector("foxspace-ui")));
  const tabId = await spaces.evaluate(async () => (await browser.tabs.query({})).find((t) => t.url === "https://chatgpt.com/redesign")?.id);
  await spaces.evaluate((id) => browser.tabs.sendMessage(id, { type: "foxspace:open-picker" }, { frameId: 0 }), tabId);
  picker = await frameOf(redesign, "/picker.html");
  await poll(picker, () => !document.getElementById("insert").disabled);
  await picker.click("#insert");
  await poll(picker, () => document.getElementById("status").textContent);
  check("no composer: the picker says so", "foxspace cannot find the message box on chatgpt.com. The page may still be loading, or the site changed its layout.", await picker.evaluate(() => document.getElementById("status").textContent));
  check("no composer: nothing goes in", "", await editorState(redesign));

  // 7. The trail lists the two injections, and checks out.
  const trailPage = await fox.openExtensionPage("spaces.html");
  await poll(trailPage, () => document.querySelectorAll("#trail li b").length >= 2);
  check("the trail lists each injection", [`${SPACE} into chat.deepseek.com, 3 items`, `${SPACE} into chatgpt.com, 4 items`], await trailPage.evaluate(() => [...document.querySelectorAll("#trail li")].map((li) => li.firstChild.textContent + li.childNodes[1].textContent)));
  check("the trail checks out", "The trail checks out: no entry was changed or removed.", await trailPage.evaluate(() => document.getElementById("trail-check").textContent));

  // 8. Sync: the text for ChatGPT "More about you", sized for the box, with a copy (X4).
  const sync = await fox.openExtensionPage("sync.html");
  await poll(sync, () => document.getElementById("count").textContent);
  await sync.evaluate((n) => {
    const select = document.getElementById("space");
    select.value = [...select.options].find((o) => o.textContent === n).value;
    select.dispatchEvent(new Event("change"));
  }, SPACE);
  await sync.select("#box", "more-about-you");
  await poll(sync, () => document.getElementById("target").textContent === "ChatGPT: More about you");
  await sync.evaluate(() => [...document.querySelectorAll("#ticks label")].find((l) => l.textContent.includes("3000 CAD")).querySelector("input").click());
  await poll(sync, () => document.getElementById("text").textContent.includes("3000 CAD"));
  const syncText = await sync.evaluate(() => document.getElementById("text").textContent);
  record.syncText = syncText;
  check("the sync text has the ticked ask item and no private item", [true, false, false], [syncText.includes("3000 CAD"), syncText.includes("AB123456"), syncText.includes("Plan by train.")]);
  check("the sync count shows the box limit", `${syncText.length} / 1,500 characters. Left out: 1 private, 1 "ask" not ticked.`, await sync.evaluate(() => document.getElementById("count").textContent));
  check("the sync page links to the settings", "https://chatgpt.com/#settings/Personalization", await sync.evaluate(() => document.getElementById("open").href));
  await sync.click("#copy");
  await poll(sync, () => document.getElementById("status").textContent);
  check("Copy copies the sync text", `Copied ${syncText.length} characters. Paste them in ChatGPT: More about you.`, await sync.evaluate(() => document.getElementById("status").textContent));

  // 9. Every site, with its own editor: Alt+Shift+K opens the picker, the
  // block goes in line for line, on an empty composer and before the text
  // the user typed, and Enter sends the editor's model through the guard.
  // A re-render of the composer and of foxspace-ui brings the button and
  // the guard back (A3, A12, A14, A15).
  const local = record.mode === "local";
  if (!local) record.skipped = ["Alt+Shift+K: Ichabod's Firefox has no system access, so no key reaches the browser's shortcuts. The button opens the picker."];
  for (const [host, composer] of Object.entries(SITES)) {
    const page = await openChat(fox, `https://${host}/`, composer);
    if (local) {
      picker = await pressShortcut(page);
      check(`${host}: Alt+Shift+K opens the picker`, true, Boolean(picker));
      await poll(picker, () => document.getElementById("count").textContent);
    } else picker = await clickFox(page, composer);
    await pickSpace(picker, SPACE);
    const want = await preview();
    await picker.click("#insert");
    await landed(page, picker);
    check(`${host}: the editor's model holds the block on an empty composer`, want, await editorState(page));
    if (!(await gone(page, "/picker.html"))) await picker.click("#close");
    await page.evaluate(() => window.chatEditor.clear());
    await page.click(composer);
    await page.keyboard.type("hello world");
    picker = await clickFox(page, composer);
    await pickSpace(picker, SPACE);
    await picker.evaluate(() => (document.getElementById("add-text").value = ""));
    await picker.click("#insert");
    await landed(page, picker);
    check(`${host}: the block goes in before the typed text`, `${want}\n\nhello world`, await editorState(page));
    const closed = await gone(page, "/picker.html");
    check(`${host}: the picker says the block went in`, true, closed);
    if (!closed) await picker.click("#close");
    await page.click(composer);
    await page.keyboard.press("Enter");
    await poll(page, () => document.querySelectorAll("#sent li").length > 0, undefined, 15_000).catch(() => false);
    check(`${host}: Enter sends the editor's model through the guard`, [`${want}\n\nhello world`], await sent(page));
    await page.evaluate(() => {
      document.querySelector("foxspace-ui").remove();
      window.chatEditor.rerender(false);
    });
    await sleep(900); // the content script puts its button back every 700 ms
    check(`${host}: the button comes back after a re-render`, true, await page.evaluate(() => Boolean(document.querySelector("foxspace-ui"))));
    picker = await clickFox(page, composer);
    check(`${host}: the button on the new composer opens the picker`, true, Boolean(picker));
    await picker.click("#close");
    await page.click(composer);
    await page.keyboard.type("my passport is AB123456");
    await page.keyboard.press("Enter");
    dialog = await frameOf(page, "/guard.html");
    check(`${host}: the guard stops an Enter on the new composer`, [true, 1], [Boolean(dialog), (await sent(page)).length]);
    await poll(dialog, () => document.querySelectorAll("#terms li").length > 0);
    await dialog.click("#edit");
    // Send anyway replays the Enter, after a click in the dialog took the focus (A16).
    await sleep(300);
    await page.click(composer);
    await page.keyboard.press("Enter");
    dialog = await frameOf(page, "/guard.html");
    await poll(dialog, () => document.querySelectorAll("#terms li").length > 0);
    await dialog.click("#send");
    await poll(page, () => document.querySelectorAll("#sent li").length === 2, undefined, 15_000).catch(() => false);
    check(`${host}: Send anyway sends the stopped Enter`, "my passport is AB123456", (await sent(page))[1] ?? "");
    // The site re-renders the composer, with the draft, while the dialog is open (A17).
    await page.click(composer);
    await page.keyboard.type("my passport is AB123456");
    await page.keyboard.press("Enter");
    dialog = await frameOf(page, "/guard.html");
    await poll(dialog, () => document.querySelectorAll("#terms li").length > 0);
    await page.evaluate(() => window.chatEditor.rerender(true));
    await dialog.click("#send");
    await poll(page, () => document.querySelectorAll("#sent li").length === 3, undefined, 15_000).catch(() => false);
    check(`${host}: Send anyway after a re-render sends from the new composer`, "my passport is AB123456", (await sent(page))[2] ?? "");
    await page.close(); // a remote Firefox closes the session with too many tabs open
  }

  // 10. A public item that holds a never-share term: the picker names it and does not insert it (G10).
  await spaces.evaluate(() => {
    const select = [...document.querySelectorAll("#items li")].find((li) => li.textContent.includes("AB123456")).querySelector("select.sens");
    select.value = "public";
    select.dispatchEvent(new Event("change"));
  });
  await poll(spaces, () => document.getElementById("status").textContent === "Item is public now.");
  picker = await clickFox(deep, "#chat-input");
  await pickSpace(picker, SPACE);
  await poll(picker, () => document.getElementById("left").textContent);
  check("a block with a never-share term cannot be inserted or copied", ['This block holds a never-share term: "AB123456". Untick that item, or make it private.', true, true], await picker.evaluate(() => [document.getElementById("left").textContent, document.getElementById("insert").disabled, document.getElementById("copy").disabled]));
  check("the page did not get it", false, (await editorState(deep)).includes("AB123456"));
  record.served = intercept.served;
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
}

record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = record.passed ? writeArtifact("artifacts", "e2e", record) : writeArtifact("artifacts", "e2e-failed", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}: ${JSON.stringify(c.actual)}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
