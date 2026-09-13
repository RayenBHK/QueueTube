import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("manifest is valid and all declared local entry points exist", async () => {
  const manifestPath = resolve(projectRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");

  const declaredFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ];

  await Promise.all(declaredFiles.map((file) => access(resolve(projectRoot, file))));
});
