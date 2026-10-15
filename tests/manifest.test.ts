// A4 in docs/failure-modes.md: the add-on runs on the supported sites only, with no other host access.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_MATCHES } from "../src/index.js";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

describe("manifest", () => {
  it("runs the content script on the supported sites only", () => {
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches).toEqual(SITE_MATCHES);
    expect(manifest.content_scripts[0].all_frames).toBeUndefined();
  });

  it("lets only the supported sites frame the picker", () => {
    for (const entry of manifest.web_accessible_resources) expect(entry.matches).toEqual(SITE_MATCHES);
  });

  it("asks for no host permission and no permission but storage", () => {
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest.browser_specific_settings.gecko.data_collection_permissions).toEqual({ required: ["none"] });
  });
});
