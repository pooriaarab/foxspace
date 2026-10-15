// A stand-in for a chat site's editor, shared by the synthetic sites. Like
// ProseMirror and React, it keeps its own state and updates it only from
// input events; the send control sends that state, never the DOM. So text
// put in the composer without the events a user's typing fires is not
// sent, as on the real sites. Each sent message is an <li> in #sent.
export function chat({ composer, send, enterSends = true }) {
  const box = document.querySelector(composer);
  const read = () => (box instanceof HTMLTextAreaElement ? box.value : box.innerText.replace(/\n+$/, ""));
  let state = "";
  box.addEventListener("input", () => {
    state = read();
    document.documentElement.dataset.editorState = state;
  });
  const submit = () => {
    if (!state.trim()) return;
    const li = document.createElement("li");
    li.textContent = state;
    document.getElementById("sent").append(li);
    if (box instanceof HTMLTextAreaElement) box.value = "";
    else box.innerHTML = "<p><br></p>";
    state = "";
    document.documentElement.dataset.editorState = "";
  };
  document.querySelector(send).addEventListener("click", submit);
  if (enterSends) {
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      submit();
    });
  }
}
