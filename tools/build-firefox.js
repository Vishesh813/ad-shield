const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist", "firefox");

function copyDir(src, dest, exclusions = []) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclusions.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
copyDir(root, dist, ["node_modules", "dist", "tools", "tests", "_metadata", "adshield.zip", "adshield-firefox.zip", ".git"]);

const manifestPath = path.join(dist, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

delete manifest.minimum_chrome_version;
manifest.name = "AdShield — Ad, Tracker & Popup Blocker (Firefox)";
manifest.browser_specific_settings = {
  gecko: {
    id: "adshield@shield.local",
    strict_min_version: "124.0"
  }
};
const background = manifest.background;
if (background && background.service_worker) {
  manifest.background = { scripts: [manifest.background.service_worker] };
}
if (Array.isArray(manifest.permissions)) {
  manifest.permissions = manifest.permissions.filter((p) => p !== "declarativeNetRequestWithHostAccess");
}
for (const cs of manifest.content_scripts || []) {
  delete cs.match_origin_as_fallback;
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log("firefox build written to", dist);
