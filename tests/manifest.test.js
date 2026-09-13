import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function getManifest() {
  return JSON.parse(await readFile(resolve(projectRoot, "manifest.json"), "utf8"));
}

function pngDimensions(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("manifest is MV3, scoped, and includes an explicit side-panel entry point", async () => {
  const manifest = await getManifest();
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.side_panel.default_path);
  assert.ok(manifest.action.default_popup);
  assert.ok(manifest.host_permissions.every((pattern) => pattern.includes("youtube.com")));
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.ok(manifest.description.length <= 132);
});

test("all declared local entry points exist", async () => {
  const manifest = await getManifest();
  const declaredFiles = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.side_panel.default_path,
    ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])]),
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons)
  ];
  await Promise.all(declaredFiles.map((file) => access(resolve(projectRoot, file))));
});

test("declared PNG icons match every manifest size", async () => {
  const manifest = await getManifest();
  for (const [size, file] of Object.entries(manifest.icons)) {
    assert.equal(extname(file), ".png");
    const dimensions = pngDimensions(await readFile(resolve(projectRoot, file)));
    assert.deepEqual(dimensions, { width: Number(size), height: Number(size) });
  }
});

test("extension pages contain no inline scripts or event handlers", async () => {
  const files = ["src/popup/popup.html", "src/sidepanel/sidepanel.html"];
  for (const file of files) {
    const html = await readFile(resolve(projectRoot, file), "utf8");
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, `${file} has an inline script`);
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${file} has an inline event handler`);
  }
});

test("extension code avoids remote execution and promise chains", async () => {
  const files = ["src/background.js", "src/content.js", "src/popup/popup.js", "src/sidepanel/sidepanel.js"];
  for (const file of files) {
    const source = await readFile(resolve(projectRoot, file), "utf8");
    assert.equal(/\beval\s*\(|\bnew\s+Function\s*\(/.test(source), false, `${file} executes dynamic code`);
    assert.equal(/\.then\s*\(/.test(source), false, `${file} uses a promise chain`);
  }
});
