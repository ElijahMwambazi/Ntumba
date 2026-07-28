import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const webPublic = new URL("../apps/web/public/", import.meta.url);
const webDist = new URL("../apps/web/dist/", import.meta.url);

async function pngDimensions(path) {
  const bytes = await readFile(path);
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${path} must be a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", webPublic), "utf8"));
assert.equal(manifest.name, "Ntumba");
assert.equal(manifest.id, "/");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.theme_color, "#F5F3ED");
assert.equal(manifest.background_color, "#F5F3ED");
assert.deepEqual(await pngDimensions(new URL("icons/ntumba-192.png", webPublic)), [192, 192]);
assert.deepEqual(await pngDimensions(new URL("ntumba-logo.png", webPublic)), [512, 512]);
assert.deepEqual(
  await pngDimensions(new URL("icons/ntumba-maskable-512.png", webPublic)),
  [512, 512],
);
assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));

const indexHtml = await readFile(new URL("../apps/web/index.html", import.meta.url), "utf8");
assert.match(indexHtml, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(indexHtml, /rel="apple-touch-icon" sizes="180x180"/);

const serviceWorker = await readFile(new URL("sw.js", webPublic), "utf8");
assert.match(serviceWorker, /isApiRequest/);
assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
assert.match(serviceWorker, /request\.mode === "navigate"/);
assert.match(serviceWorker, /caches\.match\(OFFLINE_URL\)/);
assert.match(serviceWorker, /SHELL_ASSETS\.includes\(url\.pathname\)/);
assert.doesNotMatch(serviceWorker, /cache\.put/);
assert.doesNotMatch(serviceWorker, /localStorage|indexedDB/);

const offlineHtml = await readFile(new URL("offline.html", webPublic), "utf8");
assert.match(offlineHtml, /You’re offline/);
assert.match(offlineHtml, /fresh provider confirmation/);
assert.doesNotMatch(offlineHtml, /https?:\/\//);
assert.doesNotMatch(offlineHtml, /\/api\//);

for (const asset of [
  "manifest.webmanifest",
  "sw.js",
  "offline.html",
  "offline.css",
  "icons/ntumba-192.png",
  "icons/ntumba-maskable-512.png",
]) {
  assert.ok(
    (await stat(new URL(asset, webDist))).isFile(),
    `${asset} must be emitted by the web build`,
  );
}

console.log("PWA asset checks passed.");
