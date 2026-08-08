import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseAllowList,
  classifyRequest,
  bumpDay,
  pruneStats,
  seriesStats,
  aggregateDomains,
  summarize,
  fmt,
  btoaChar,
  dayKey,
  ytDecision,
  ytFightPlan
} from "../lib/core.mjs";

const root = join(import.meta.dirname, "..");
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
  }
}

function eq(a, b, label) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${label}: expected ${jb}, got ${ja}`);
}

// ── A. Filter list / DNR rules integrity ────────────────────────────────────

const RULE_FILES = ["rules-ads.json", "rules-trackers.json", "rules-popups.json"];
const VALID_RESOURCES = new Set([
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
]);

function loadRules() {
  const all = {};
  for (const f of RULE_FILES) {
    all[f] = JSON.parse(readFileSync(join(root, "lib", f), "utf8"));
  }
  return all;
}

test("every ruleset file is a top-level JSON array of rules", () => {
  const rules = loadRules();
  for (const f of RULE_FILES) {
    if (!Array.isArray(rules[f]) || rules[f].length === 0) throw new Error(`${f}: must be a rules array`);
  }
});

test("rule ids are unique across ALL rulesets", () => {
  const rules = loadRules();
  const seen = new Set();
  for (const f of RULE_FILES) {
    for (const r of rules[f]) {
      if (seen.has(r.id)) throw new Error(`duplicate id ${r.id} in ${f}`);
      seen.add(r.id);
    }
  }
});

test("every rule: positive priority, block action, valid condition", () => {
  const rules = loadRules();
  for (const f of RULE_FILES) {
    for (const r of rules[f]) {
      if (typeof r.priority !== "number" || r.priority <= 0) throw new Error(`${f} rule ${r.id}: priority`);
      if (r.action.type !== "block") throw new Error(`${f} rule ${r.id}: action`);
      if (typeof r.condition.urlFilter !== "string") throw new Error(`${f} rule ${r.id}: urlFilter`);
      if (!r.condition.urlFilter.startsWith("||")) throw new Error(`${f} rule ${r.id}: urlFilter must start with ||`);
      for (const rt of r.condition.resourceTypes || []) {
        if (!VALID_RESOURCES.has(rt)) throw new Error(`${f} rule ${r.id}: bad resourceType ${rt}`);
      }
      if (r.condition.regexFilter) throw new Error(`${f} rule ${r.id}: regexFilter must not appear in static rulesets (Firefox compat)`);
    }
  }
});

test("no duplicate domains across all rules", () => {
  const rules = loadRules();
  const seen = new Set();
  for (const f of RULE_FILES) {
    for (const r of rules[f]) {
      const d = r.condition.urlFilter.replace(/^\|\|/, "").replace(/\^$/, "");
      if (seen.has(d)) throw new Error(`domain ${d} duplicated`);
      seen.add(d);
      if (!/^[a-z0-9.-]+$/.test(d)) throw new Error(`domain ${d} invalid`);
    }
  }
});

test("rule counts are meaningful (ads>=100, trackers>=40, popups>=5)", () => {
  const rules = loadRules();
  if (rules["rules-ads.json"].length < 100) throw new Error("ads too few");
  if (rules["rules-trackers.json"].length < 40) throw new Error("trackers too few");
  if (rules["rules-popups.json"].length < 5) throw new Error("popups too few");
});

// ── B. allowlist parsing ────────────────────────────────────────────────────

test("parseAllowList: trims, lowercases, dedupes, drops empties", () => {
  eq(parseAllowList(" a.com , b.COM , a.com, , C.net "), ["a.com", "b.com", "c.net"], "allowlist");
  eq(parseAllowList(undefined), [], "undefined");
  eq(parseAllowList(""), [], "empty");
  eq(parseAllowList("x.com,x.com,x.com"), ["x.com"], "dedupe");
});

// ── C. URL classification (network stats) ───────────────────────────────────

test("classifyRequest: Google ad endpoints", () => {
  eq(classifyRequest("https://ad.doubleclick.net/path/x"), "ad", "ad.doubleclick.net");
  eq(classifyRequest("https://googleads.g.doubleclick.net/pagead/ads"), "ad", "googleads.g");
  eq(classifyRequest("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"), "ad", "pagead2");
  eq(classifyRequest("https://adservice.google.com/adsid/integrator.js"), "ad", "adservice.google.com");
});

test("classifyRequest: ad networks", () => {
  eq(classifyRequest("https://a.taboola.com/rtid/xyz"), "ad", "taboola");
  eq(classifyRequest("https://widgets.outbrain.com/outbrain.js"), "ad", "outbrain");
  eq(classifyRequest("https://cdn.criteo.net/x"), "ad", "criteo");
  eq(classifyRequest("https://adnxs.com/req"), "ad", "adnxs");
  eq(classifyRequest("https://ads.pubmatic.com/AdServer"), "ad", "pubmatic");
});

test("classifyRequest: trackers", () => {
  eq(classifyRequest("https://connect.facebook.net/en_US/fbevents.js"), "tracker", "fbevents");
  eq(classifyRequest("https://graph.facebook.com/tr"), "tracker", "graph fb");
  eq(classifyRequest("https://analytics.tiktok.com/api/v2/pixel"), "tracker", "tiktok pixel");
  eq(classifyRequest("https://cdn.amplitude.com/script.js"), "tracker", "amplitude");
  eq(classifyRequest("https://static.hotjar.com/c/hotjar-1.js"), "tracker", "hotjar");
});

test("classifyRequest: safe pages and false-positive guards", () => {
  eq(classifyRequest("https://www.youtube.com/watch?v=abc"), null, "youtube watch");
  eq(classifyRequest("https://www.google.com/search?q=ads"), null, "google search with ads text");
  eq(classifyRequest("https://example.com/ads/banner.jpg"), null, "path-only ads");
  eq(classifyRequest("https://example.com/blog/advertising-tips"), null, "path-only advertising");
  eq(classifyRequest("https://cdn.example.com/app.js"), null, "benign cdn");
  eq(classifyRequest(null), null, "null input");
  eq(classifyRequest(42), null, "non-string input");
});

// ── D. stats accumulation ───────────────────────────────────────────────────

test("bumpDay: unknown kind is a no-op", () => {
  const { stats } = bumpDay({}, "bogus", 5, "x.com");
  eq(Object.keys(stats), [], "no-op");
});

test("bumpDay: cosmetic increments ads+blocked; popup only popups", () => {
  let r = bumpDay({}, "cosmetic", 3, "a.com");
  let day = r.stats[dayKey()];
  eq(day.ads, 3, "ads");
  eq(day.blocked, 3, "blocked");
  eq(day.domains["a.com"], 3, "domain count");
  r = bumpDay(r.stats, "popup", 2, "a.com");
  day = r.stats[dayKey()];
  eq(day.popups, 2, "popups");
  eq(day.ads, 3, "ads unchanged");
  eq(day.blocked, 3, "blocked unchanged by popup");
});

test("bumpDay: n=0 still counts as 1 (host-only bumps)", () => {
  const { stats } = bumpDay({}, "networkAd", 0, "h.com");
  const day = stats[dayKey()];
  eq(day.ads, 1, "ads");
  eq(day.blocked, 1, "blocked");
  eq(day.domains["h.com"], 1, "domain");
});

test("pruneStats: drops entries older than 30 days, keeps today", () => {
  const stats = {};
  stats[dayKey()] = { ads: 1 };
  const old = new Date();
  old.setDate(old.getDate() - 40);
  stats[old.toISOString().slice(0, 10)] = { ads: 99 };
  const near = new Date();
  near.setDate(near.getDate() - 5);
  stats[near.toISOString().slice(0, 10)] = { ads: 2 };
  pruneStats(stats);
  eq(Object.keys(stats).length, 2, "pruned count");
});

// ── E. series / aggregation ─────────────────────────────────────────────────

test("seriesStats: length matches range, missing days are zero", () => {
  const seq = seriesStats({ [dayKey()]: { ads: 4, blocked: 4 } }, 7);
  eq(seq.length, 7, "length");
  eq(seq[6].total, 4, "today total");
  eq(seq[0].total, 0, "first day zero");
  eq(seq[0].key < seq[6].key, true, "chronological");
});

test("summarize: aggregates range totals", () => {
  const seq = seriesStats({}, 7);
  seq[6] = { total: 10, ads: 5, trackers: 3, popups: 2, key: dayKey(), domains: {} };
  const s = summarize(seq);
  eq(s, { total: 10, ads: 5, trackers: 3, popups: 2 }, "summary");
});

test("aggregateDomains: merges counts across days", () => {
  const seq = seriesStats({}, 2);
  seq[1] = { domains: { "ad.doubleclick.net": 5 }, total: 5, key: dayKey() };
  seq[0] = { domains: { "ad.doubleclick.net": 2, "x.com": 1 }, total: 3, key: "1999-01-01" };
  const agg = aggregateDomains(seq);
  eq(agg, { "ad.doubleclick.net": 7, "x.com": 1 }, "merged");
});

// ── F. formatting helpers ───────────────────────────────────────────────────

test("fmt: human readable", () => {
  eq(fmt(0), "0", "zero");
  eq(fmt(999), "999", "plain");
  eq(fmt(1500), "1.5k", "k");
  eq(fmt(1200000), "1.2M", "m");
});

test("btoaChar: stable avatar letter", () => {
  eq(btoaChar("youtube.com"), btoaChar("youtube.com"), "stable");
  eq(typeof btoaChar("example.com"), "string", "string");
});

// ── G. YouTube ad-fighting decision logic ───────────────────────────────────

test("ytDecision: skip button shown while ad is active", () => {
  const d = ytDecision({ adShowing: true, skipVisible: true });
  eq(d.actions.includes("skip"), true, "should skip");
});

test("ytDecision: mute + speed + hide overlays during ad", () => {
  const d = ytDecision({ adShowing: true });
  eq(d.actions.includes("mute"), true, "mute");
  eq(d.actions.includes("speed"), true, "speed");
  eq(d.actions.includes("hideOverlays"), true, "overlays");
});

test("ytDecision: restore when ad finished", () => {
  const d = ytDecision({ adShowing: false });
  eq(d.actions.includes("restore"), true, "restore");
  eq(d.needsRestore, true, "needsRestore");
});

test("ytDecision: already muted -> no mute action", () => {
  const d = ytDecision({ adShowing: true, alreadyMuted: true });
  eq(d.actions.includes("mute"), false, "no duplicate mute");
});

test("ytFightPlan: skip button ready -> click immediately, no fast-forward", () => {
  const p = ytFightPlan({ hasSkip: true, calm: true, adAgeMs: 100 });
  eq(p.clickSkip, true, "click skip");
  eq(p.fastForward, false, "no ff");
});

test("ytFightPlan: calm mode waits quietly for short unskippable ads", () => {
  const p = ytFightPlan({ hasSkip: false, calm: true, adAgeMs: 2000 });
  eq(p.fastForward, false, "no ff under 8s in calm mode");
  eq(p.overlay, true, "overlay shown");
});

test("ytFightPlan: prolonged unskippable ad in calm mode escalates to silent ff", () => {
  const p = ytFightPlan({ hasSkip: false, calm: true, adAgeMs: 12000 });
  eq(p.fastForward, true, "ff after 8s");
});

test("ytFightPlan: non-calm mode fast-forwards immediately", () => {
  const p = ytFightPlan({ hasSkip: false, calm: false, adAgeMs: 0 });
  eq(p.fastForward, true, "ff right away");
});

// ── H. cold-start safety nets ───────────────────────────────────────────────

test("background.js is a module that imports core.mjs", () => {
  const src = readFileSync(join(root, "background.js"), "utf8");
  if (!src.includes('from "./lib/core.mjs"')) throw new Error("missing core import");
  if (!src.includes('updateEnabledRulesets')) throw new Error("missing static ruleset toggling");
});

test("manifest references every shipped file", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const refs = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => c.js),
    ...manifest.web_accessible_resources.flatMap((w) => w.resources),
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...manifest.declarative_net_request.rule_resources.map((r) => r.path)
  ];
  for (const ref of refs) {
    if (!ref) throw new Error("empty reference in manifest");
    try {
      readFileSync(join(root, ref));
    } catch {
      throw new Error(`manifest references missing file: ${ref}`);
    }
  }
  const icons = Object.values(manifest.icons).concat(Object.values(manifest.action.default_icon));
  for (const i of icons) {
    try { readFileSync(join(root, i)); } catch { throw new Error(`icon missing: ${i}`); }
  }
});

test("popup/analytics pages use module scripts so they can import core", () => {
  const popup = readFileSync(join(root, "popup", "popup.html"), "utf8");
  const options = readFileSync(join(root, "options", "analytics.html"), "utf8");
  if (!popup.includes('type="module"')) throw new Error("popup.html must use module script");
  if (!options.includes('type="module"')) throw new Error("analytics.html must use module script");
});

// ── report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.log(`  FAIL: ${f.name}\n        ${f.error}`);
  process.exitCode = 1;
} else {
  console.log("all green — every scenario covered");
}