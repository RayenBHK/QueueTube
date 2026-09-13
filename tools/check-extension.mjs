import { spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(projectRoot, "manifest.json"), "utf8"));
const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

assert(manifest.manifest_version === 3, "manifest_version must be 3");
assert(manifest.version === packageMetadata.version, "manifest and package versions must match");
assert(manifest.description.length <= 132, "manifest description exceeds 132 characters");
assert(Number(manifest.minimum_chrome_version) >= 116, "minimum Chrome version must cover the tested side-panel baseline");
assert(manifest.side_panel?.default_path, "side panel entry point is missing");
assert(manifest.action?.default_popup, "popup entry point is missing");
assert(manifest.permissions.includes("sidePanel"), "sidePanel permission is missing");
assert(manifest.permissions.includes("tabs"), "tabs permission is required for tab metadata");
assert(!manifest.host_permissions.includes("<all_urls>"), "host permissions are too broad");
assert(
  manifest.permissions.every((permission) => ["storage", "tabs", "tabGroups", "sidePanel"].includes(permission)),
  "manifest includes an unexpected permission"
);
assert(
  manifest.host_permissions.every((pattern) => [
    "https://www.youtube.com/*",
    "https://youtube.com/*",
    "https://m.youtube.com/*"
  ].includes(pattern)),
  "manifest includes an unexpected host permission"
);
assert(!manifest.key && !manifest.update_url, "development-only manifest metadata must not ship");

const declaredFiles = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.side_panel.default_path,
  ...manifest.content_scripts.flatMap((entry) => [...entry.js, ...(entry.css || [])]),
  ...Object.values(manifest.action.default_icon),
  ...Object.values(manifest.icons)
];

for (const file of declaredFiles) {
  await access(resolve(projectRoot, file));
  assert(true, `Missing declared file: ${file}`);
}

for (const [size, file] of Object.entries(manifest.icons)) {
  const buffer = await readFile(resolve(projectRoot, file));
  const dimensions = pngDimensions(buffer);
  assert(extname(file) === ".png", `${file} must be PNG`);
  assert(dimensions.width === Number(size) && dimensions.height === Number(size), `${file} does not match ${size}x${size}`);
}

const listingAssets = new Map([
  ["store-assets/screenshot-queue-room-1280x800.png", [1280, 800]],
  ["store-assets/screenshot-queued-badge-1280x800.png", [1280, 800]],
  ["store-assets/small-promo-440x280.png", [440, 280]]
]);
for (const [file, [width, height]] of listingAssets) {
  const dimensions = pngDimensions(await readFile(resolve(projectRoot, file)));
  assert(dimensions.width === width && dimensions.height === height, `${file} does not match ${width}x${height}`);
}

const sourceFiles = await walk(resolve(projectRoot, "src"));
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  if (extname(file) === ".js") {
    const syntax = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert(syntax.status === 0, syntax.stderr || `Syntax check failed: ${file}`);
    assert(!/\beval\s*\(|\bnew\s+Function\s*\(/.test(source), `Dynamic code execution found: ${file}`);
    assert(!/\.then\s*\(/.test(source), `Promise chain found: ${file}`);
  }
  if (extname(file) === ".html") {
    assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(source), `Inline script found: ${file}`);
    assert(!/\son[a-z]+\s*=/i.test(source), `Inline event handler found: ${file}`);
    assert(!/<(?:script|link)[^>]+(?:src|href)=["']https?:/i.test(source), `Remote executable resource found: ${file}`);
  }
}

const tests = spawnSync(process.execPath, ["--test"], { cwd: projectRoot, encoding: "utf8" });
if (tests.stdout) process.stdout.write(tests.stdout);
if (tests.stderr) process.stderr.write(tests.stderr);
assert(tests.status === 0, "Automated tests failed");

console.log(`QueueTube v${manifest.version}: ${checks} release checks passed.`);
