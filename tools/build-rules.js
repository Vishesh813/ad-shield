const fs = require("fs");
const path = require("path");
const { AD_DOMAINS, TRACKER_DOMAINS, NATIVE_DOMAINS, POPUP_DOMAINS } = require("../lib/filters");

function normalizeDomain(d) {
  return d.toLowerCase().replace(/\/.*$/, "").replace(/^\.+/, "");
}

function buildRules(list, startId) {
  const rules = [];
  let id = startId;
  const seenDomains = new Set();
  for (const raw of list) {
    const domain = normalizeDomain(raw);
    if (!/^[a-z0-9.-]+$/.test(domain) || domain.includes("..")) continue;
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    rules.push({
      id: id++,
      priority: 20000,
      action: { type: "block" },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: ["main_frame", "sub_frame", "script", "image", "media", "stylesheet", "xmlhttprequest", "object", "ping", "font", "other"]
      }
    });
  }
  return rules;
}

const outDir = path.join(__dirname, "..", "lib");

const sets = [
  { name: "rules-ads", ids: buildRules([...AD_DOMAINS, ...NATIVE_DOMAINS], 1000) },
  { name: "rules-trackers", ids: buildRules(TRACKER_DOMAINS, 2000) },
  { name: "rules-popups", ids: buildRules(POPUP_DOMAINS, 3000) }
];

let total = 0;
const allIds = new Set();
for (const { name, ids } of sets) {
  for (const r of ids) {
    if (allIds.has(r.id)) throw new Error(`duplicate static rule id ${r.id}`);
    allIds.add(r.id);
  }
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(ids));
  total += ids.length;
  console.log(`${name}: ${ids.length}`);
}

const seenDomains = new Set();
const popupDomains = [];
for (const raw of POPUP_DOMAINS) {
  const d = normalizeDomain(raw);
  if (!/^[a-z0-9.-]+$/.test(d) || d.includes("..") || seenDomains.has(d)) continue;
  seenDomains.add(d);
  popupDomains.push(d);
}
fs.writeFileSync(path.join(outDir, "popup-domains.json"), JSON.stringify(popupDomains));
console.log(`popup-domains: ${popupDomains.length}`);

console.log(`total static rules: ${total}`);