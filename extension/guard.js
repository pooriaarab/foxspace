// The guard dialog, in a frame on the chat page. It names the never-share
// term that stopped the send; the page never sees the term. Edit goes back
// to the composer; Send anyway sends the message as it is, once.
const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxspace did not answer.");
  return reply.value;
};
const failed = (error) => {
  $("status").textContent = error instanceof Error ? error.message : String(error);
  $("status").classList.add("bad");
};

async function start() {
  const held = await ask("guard:matches", { token });
  if (!held) {
    $("why").textContent = "foxspace could not check this message, so it stopped it. Send it only if it holds nothing you never share.";
    return;
  }
  if (held.tooLong) $("why").textContent = "The message is too long for foxspace to check, so it stopped it.";
  $("terms").replaceChildren(...held.matches.map((m) => {
    const li = document.createElement("li");
    li.append(Object.assign(document.createElement("b"), { textContent: m.term }), ` from ${m.from}`);
    return li;
  }));
}

const decide = (choice) => ask("guard:decide", { token, choice }).catch(failed);
$("edit").addEventListener("click", () => decide("edit"));
$("send").addEventListener("click", () => decide("send"));
addEventListener("keydown", (event) => {
  if (event.key === "Escape") decide("edit");
});
start().then(() => $("edit").focus(), failed);
