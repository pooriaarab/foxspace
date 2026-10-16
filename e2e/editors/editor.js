// The editors of the synthetic chat sites: the real prosemirror-view (ChatGPT,
// Claude, Le Chat, Grok), lexical (Perplexity) and quill (Gemini), a React-
// style textarea (DeepSeek) and a bare contenteditable (the redesign page).
// e2e/run.mjs bundles this file to /editor.js. Each editor keeps its own
// model and updates it only through its own event handling, as on the real
// sites. Enter and the send control send the model, never the DOM, so text
// that the editor did not take is not sent. Each sent message is an <li>
// in #sent; documentElement.dataset.editorState mirrors the model, one line
// per paragraph.
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { $createParagraphNode, $createTextNode, $getRoot, COMMAND_PRIORITY_HIGH, createEditor, KEY_ENTER_COMMAND } from "lexical";
import { registerRichText } from "@lexical/rich-text";
import Quill from "quill";

/** Each kind mounts in host, calls changed() on each model change and submit() on Enter. load(text) sets the model, one paragraph per line. */
const KINDS = {
  prosemirror(host, attrs, changed, submit) {
    const plugins = [keymap({ Enter: () => (submit(), true) }), keymap(baseKeymap)];
    const fresh = (text = "") => EditorState.create({ schema, plugins, doc: schema.node("doc", null, text.split("\n").map((line) => schema.node("paragraph", null, line ? [schema.text(line)] : []))) });
    const view = new EditorView(host, {
      state: fresh(),
      attributes: attrs,
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        changed();
      },
    });
    return {
      model: () => view.state.doc.content.content.map((p) => p.textContent).join("\n"),
      load: (text) => (view.updateState(fresh(text)), changed()),
      destroy: () => view.destroy(),
    };
  },
  lexical(host, attrs, changed, submit) {
    const root = Object.assign(document.createElement("div"), { contentEditable: "true" });
    for (const [name, value] of Object.entries(attrs)) root.setAttribute(name, value);
    host.append(root);
    const editor = createEditor({ namespace: "chat", onError: (error) => console.error(error) });
    editor.setRootElement(root);
    const stops = [
      registerRichText(editor),
      editor.registerUpdateListener(changed),
      editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
        if (event?.shiftKey) return false;
        event?.preventDefault();
        submit();
        return true;
      }, COMMAND_PRIORITY_HIGH),
    ];
    return {
      model: () => editor.getEditorState().read(() => $getRoot().getChildren().map((p) => p.getTextContent()).join("\n")),
      load: (text) => editor.update(() => $getRoot().clear().append(...text.split("\n").map((line) => $createParagraphNode().append(...(line ? [$createTextNode(line)] : []))))),
      destroy: () => (stops.forEach((stop) => stop()), editor.setRootElement(null), root.remove()),
    };
  },
  quill(host, _attrs, changed, submit) {
    const box = host.appendChild(document.createElement("div"));
    const quill = new Quill(box, {});
    quill.on("text-change", changed);
    // Ahead of Quill's own Enter binding, as a chat site does.
    quill.keyboard.addBinding({ key: "Enter", shiftKey: false }, () => (submit(), false));
    quill.keyboard.bindings.Enter.unshift(quill.keyboard.bindings.Enter.pop());
    return {
      model: () => quill.getText().replace(/\n$/, ""),
      load: (text) => quill.setText(text),
      destroy: () => box.remove(),
    };
  },
  textarea(host, attrs, changed, submit) {
    const box = host.appendChild(Object.assign(document.createElement("textarea"), { rows: 2 }));
    for (const [name, value] of Object.entries(attrs)) box.setAttribute(name, value);
    let state = "";
    // Delegated from the host, as React does from its root: a removed box sends nothing.
    const off = new AbortController();
    host.addEventListener("input", (event) => event.target === box && ((state = box.value), changed()), { signal: off.signal });
    host.addEventListener("keydown", (event) => {
      if (event.target !== box || event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      submit();
    }, { signal: off.signal });
    return { model: () => state, load: (text) => ((box.value = state = text), changed()), destroy: () => (off.abort(), box.remove()) };
  },
  plain(host, attrs, changed) {
    const box = host.appendChild(Object.assign(document.createElement("div"), { contentEditable: "plaintext-only" }));
    for (const [name, value] of Object.entries(attrs)) box.setAttribute(name, value);
    let state = "";
    box.addEventListener("input", () => ((state = box.innerText), changed()));
    return { model: () => state, load: (text) => ((box.textContent = state = text), changed()), destroy: () => box.remove() };
  },
};

/** A chat page: kind of editor, its host element, its attributes, and the send control. */
export function chat({ kind, host, attrs = {}, send }) {
  const where = document.querySelector(host);
  let editor;
  const changed = () => (document.documentElement.dataset.editorState = editor?.model() ?? "");
  const submit = () => {
    const text = editor.model();
    if (!text.trim()) return;
    const li = document.createElement("li");
    li.textContent = text;
    document.getElementById("sent").append(li);
    editor.load("");
  };
  const mount = () => (editor = KINDS[kind](where, attrs, changed, submit));
  mount();
  document.querySelector(send).addEventListener("click", submit);
  // For the E2E: empty the editor, or re-render it as a single-page app
  // does: a new element, with the draft kept when keep is true.
  window.chatEditor = {
    clear: () => editor.load(""),
    rerender(keep) {
      const draft = editor.model();
      editor.destroy();
      where.replaceChildren();
      mount();
      editor.load(keep ? draft : "");
    },
  };
}
