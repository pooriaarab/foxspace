// Serve synthetic copies of real chat site origins with WebDriver BiDi
// network interception: network.addIntercept stops each request to these
// hosts before it leaves Firefox, and network.provideResponse answers it
// from e2e/sites/<host>/ (shared files from e2e/sites/). The page then has
// the real origin, https://chatgpt.com, so the extension's content script
// and its host matches run as they do on the real site. No request reaches
// the real site.
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const ROOT = "e2e/sites";

function fileFor(url) {
  const { host, pathname } = new URL(url);
  const path = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const page = pathname === "/" ? "index.html" : extname(path) ? path : `${path}.html`;
  for (const file of [join(ROOT, host, page), join(ROOT, page)]) if (existsSync(file) && statSync(file).isFile()) return file;
  return undefined;
}

/** Intercept every request to the hosts. Returns the requests served, for the record. */
export async function interceptSites(browser, hosts) {
  const connection = browser.connection;
  const served = [];
  connection.on("network.beforeRequestSent", async (event) => {
    if (!event.isBlocked) return;
    const file = fileFor(event.request.url);
    const body = file ? readFileSync(file) : Buffer.from("Not found");
    served.push(`${file ? 200 : 404} ${event.request.url}`);
    await connection.send("network.provideResponse", {
      request: event.request.request,
      statusCode: file ? 200 : 404,
      reasonPhrase: file ? "OK" : "Not Found",
      headers: [{ name: "content-type", value: { type: "string", value: TYPES[extname(file ?? "")] ?? "text/plain" } }],
      body: { type: "base64", value: body.toString("base64") },
    });
  });
  const reply = await connection.send("network.addIntercept", { phases: ["beforeRequestSent"], urlPatterns: hosts.map((hostname) => ({ type: "pattern", protocol: "https", hostname })) });
  return { id: reply.result.intercept, served };
}
