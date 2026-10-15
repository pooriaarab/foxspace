// The content script, on the supported chat sites only (manifest matches).
// It puts a foxspace button next to the composer, opens the picker in a
// frame, inserts the block that the event page sends, and guards each send. The picker is an
// extension page in a closed shadow root: the chat page cannot read the
// spaces, the ticks or the preview. Only the inserted block reaches the page,
// and the user sees it in the composer before sending.
import { composerText, findComposer, insertBlock } from "../src/composer.ts";
import { siteForHost } from "../src/sites.ts";

const here = siteForHost(location.host);
if (here) start(here);

function start(site) {
  const host = document.createElement("foxspace-ui");
  host.style.cssText = "all:initial;position:fixed;inset:0 auto auto 0;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    button { all: initial; position: fixed; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; display: grid; place-items: center;
      background: #1d1a17; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: transform 120ms cubic-bezier(.23,1,.32,1); }
    button:hover { transform: scale(1.08); } button:focus-visible { outline: 2px solid #e8833a; outline-offset: 2px; }
    img { width: 18px; height: 18px; border-radius: 4px; }
    iframe { position: fixed; border: 0; border-radius: 14px; box-shadow: 0 8px 32px rgba(0,0,0,.35); background: transparent; color-scheme: normal; }`;
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Add a foxspace space to this message");
  button.title = "foxspace: add a space (Alt+Shift+K)";
  button.hidden = true;
  button.append(Object.assign(document.createElement("img"), { src: browser.runtime.getURL("icons/icon-48.png"), alt: "" }));
  root.append(style, button);
  let frame;

  const composerBox = () => {
    const found = findComposer(document, site);
    return found.ok ? found.element.getBoundingClientRect() : undefined;
  };
  // Keep the button at the top right of the composer, which sites move and re-render.
  const place = () => {
    if (!host.isConnected) document.documentElement.append(host);
    const box = composerBox();
    button.hidden = !box;
    if (box) Object.assign(button.style, { left: `${Math.min(innerWidth - 36, box.right - 32)}px`, top: `${Math.max(4, box.top - 34)}px` });
    if (frame && box) placeFrame(box);
  };
  const placeFrame = (box) => {
    const width = Math.min(400, innerWidth - 16);
    const height = Math.min(520, innerHeight - 16);
    const left = Math.max(8, Math.min(box ? box.left : 8, innerWidth - width - 8));
    const top = box ? Math.max(8, box.top - height - 8) : 8;
    Object.assign(frame.style, { width: `${width}px`, height: `${height}px`, left: `${left}px`, top: `${top}px` });
  };

  const close = () => {
    frame?.remove();
    frame = undefined;
    const found = findComposer(document, site);
    if (found.ok) found.element.focus();
  };
  const open = () => {
    if (frame) return close();
    frame = document.createElement("iframe");
    frame.src = browser.runtime.getURL("picker.html");
    frame.title = "foxspace";
    placeFrame(composerBox());
    root.append(frame);
  };
  button.addEventListener("click", open);

  // The guard (G8, G9). At a send, it reads the composer text, and nothing
  // else, and asks the event page. The terms stay there: the content
  // script gets a yes, or a token for the dialog frame that names the term.
  // The send waits for the answer, then goes on, or stops at the dialog.
  const pending = new Map();
  let holding = false;
  let replaying = false;
  const showGuard = (token) => {
    const dialog = document.createElement("iframe");
    dialog.src = `${browser.runtime.getURL("guard.html")}#${token}`;
    dialog.title = "foxspace guard";
    const box = composerBox();
    const width = Math.min(420, innerWidth - 16);
    Object.assign(dialog.style, { width: `${width}px`, height: "180px", left: `${Math.max(8, box ? box.left + (box.width - width) / 2 : 8)}px`, top: `${Math.max(8, box ? box.top - 188 : 8)}px` });
    root.append(dialog);
    return dialog;
  };
  const guard = (event, composer, replay) => {
    if (replaying) return; // X2: a send the user let through skips the guard once.
    const text = composerText(composer);
    if (!text.trim()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (holding) return;
    holding = true;
    check(composer, text, replay);
  };
  // A send goes out only with the text that was checked. Text that changed
  // during the check, or while the dialog was open, is checked again (G11).
  const check = (composer, text, replay) => {
    // A failed check stops the send too; the dialog says it could not check.
    const stop = (token) => pending.set(token, { composer, text, replay, dialog: showGuard(token) });
    browser.runtime.sendMessage({ type: "content:guard", text }).then(
      (reply) => {
        if (!reply?.ok) return stop("check-failed");
        if (!reply.value.ok) return stop(reply.value.token);
        const now = composerText(composer);
        if (now !== text) return check(composer, now, replay);
        holding = false;
        send(replay);
      },
      () => stop("check-failed"),
    );
  };
  const send = (replay) => {
    replaying = true;
    try {
      replay();
    } finally {
      replaying = false;
    }
  };
  const decide = (token, choice) => {
    const held = pending.get(token);
    if (!held) return;
    pending.delete(token);
    held.dialog.remove();
    if (choice === "send") {
      const now = composerText(held.composer);
      if (now !== held.text) return check(held.composer, now, held.replay);
      holding = false;
      return send(held.replay);
    }
    holding = false;
    held.composer.focus();
  };
  // Window, capture phase, from document_start: before any listener of the site.
  addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const found = findComposer(document, site);
    if (!found.ok || !event.composedPath().includes(found.element)) return;
    const init = { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true, composed: true, ctrlKey: event.ctrlKey, metaKey: event.metaKey };
    guard(event, found.element, () => found.element.dispatchEvent(new KeyboardEvent("keydown", init)));
  }, true);
  const SEND = site.send.join(", ");
  addEventListener("click", (event) => {
    const control = event.target instanceof Element ? event.target.closest(SEND) : null;
    if (!control) return;
    const found = findComposer(document, site);
    if (!found.ok) return;
    // The site can re-render its send control while the dialog is open.
    guard(event, found.element, () => (control.isConnected ? control : document.querySelector(SEND))?.click());
  }, true);

  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return undefined;
    switch (message?.type) {
      case "foxspace:open-picker":
        open();
        return Promise.resolve({ ok: true });
      case "foxspace:close-picker":
        close();
        return Promise.resolve({ ok: true });
      case "foxspace:guard-decision":
        decide(message.token, message.choice);
        return Promise.resolve({ ok: true });
      case "foxspace:insert": {
        const found = findComposer(document, site);
        if (!found.ok) return Promise.resolve({ ok: false, error: found.error });
        const landed = insertBlock(found.element, message.text);
        if (landed) close();
        return Promise.resolve({ ok: true, landed });
      }
      default:
        return undefined;
    }
  });

  place();
  setInterval(place, 700);
  addEventListener("resize", place);
  addEventListener("scroll", place, true);
}
