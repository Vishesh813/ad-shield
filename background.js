import { parseAllowList, classifyRequest, bumpDay, pruneStats, dayKey } from "./lib/core.mjs";

const DEFAULTS = {
  enabled: true,
  blockAds: true,
  blockTrackers: true,
  blockPopups: true,
  stealthMode: false,
  ytCalm: true,
  allowList: "",
  stats: {}
};

const RULESETS = ["ads", "trackers", "popups"];

const cache = { settings: null };

function isFirefox() {
  try {
    return typeof navigator !== "undefined" && /Firefox/.test(navigator.userAgent);
  } catch {
    return false;
  }
}

async function getSettings() {
  if (cache.settings) return cache.settings;
  const stored = await chrome.storage.local.get(DEFAULTS);
  cache.settings = Object.assign({}, DEFAULTS, stored);
  return cache.settings;
}

async function applyStaticRulesets() {
  const s = await getSettings();
  const enable = [];
  if (s.enabled) {
    if (s.blockAds) enable.push("ads");
    if (s.blockTrackers) enable.push("trackers");
    if (s.blockPopups) enable.push("popups");
  }
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    disableRulesetIds: RULESETS,
    enableRulesetIds: enable
  });
}

async function applySessionRules() {
  const s = await getSettings();
  const allowList = parseAllowList(s.allowList);
  const firefox = isFirefox();
  const add = [];

  if (s.enabled && s.blockAds && !firefox) {
    add.push({
      id: 50001,
      priority: 20001,
      action: { type: "redirect", redirect: { extensionPath: "/lib/stub-adsbygoogle.js" } },
      condition: { resourceTypes: ["script"], regexFilter: "\\/adsbygoogle(\\.min)?\\.js(\\?.*)?$" }
    });
    add.push({
      id: 50002,
      priority: 20001,
      action: { type: "redirect", redirect: { extensionPath: "/lib/stub-gpt.js" } },
      condition: { resourceTypes: ["script"], regexFilter: "\\/tag\\/js\\/gpt\\.js" }
    });
  }

  if (s.enabled && !firefox) {
    add.push({
      id: 50010,
      priority: 20000,
      action: { type: "block" },
      condition: {
        resourceTypes: ["script"],
        regexFilter: "(?i)(fuckadblock|anti[-_]?adblock|adblock[-_]?(check|detect|test|wall|bust)|ads?check|adwall|blockwall)"
      }
    });
    add.push({
      id: 50011,
      priority: 20000,
      action: { type: "block" },
      condition: {
        resourceTypes: ["main_frame", "sub_frame"],
        regexFilter: "(?i)\\/\\/(sc|p|ad|tr|pop|r)\\.([a-z0-9-]+\\.)?(shop|xyz|top|icu|fun|click|racing)\\/"
      }
    });
    add.push({
      id: 50012,
      priority: 20000,
      action: { type: "block" },
      condition: {
        resourceTypes: ["main_frame", "sub_frame"],
        regexFilter: "(?i)1xlite[s-]?\\d{0,6}\\.pro|\\/get\\/opera-gx|utm_source=propeller\\&utm_medium=ppc"
      }
    });
  }

  allowList.forEach((host, n) => {
    const condition = firefox ? { initiatorDomains: [host] } : { requestInitiatorDomains: [host] };
    add.push({
      id: 75000 + n,
      priority: 21000,
      action: { type: "allow" },
      condition
    });
  });

  const existing = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = existing.map((r) => r.id);
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules: add });
}

async function refreshRules() {
  await applyStaticRulesets();
  await applySessionRules();
}

let rulesBooted = false;
function ensureRulesBoot() {
  if (rulesBooted) return;
  rulesBooted = true;
  refreshRules().catch(() => {});
}

async function persist(partial) {
  const s = Object.assign({}, await getSettings(), partial);
  cache.settings = s;
  await chrome.storage.local.set(partial);
  await refreshRules();
  await notifyTabs();
  await refreshBadge();
}

async function notifyTabs() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, { type: "shSettingsChanged" });
    } catch {}
  }
}

async function bumpStats(kind, n, host) {
  const s = await getSettings();
  const { stats } = bumpDay(s.stats, kind, n, host);
  const next = Object.assign({}, s, { stats });
  cache.settings = next;
  await chrome.storage.local.set({ stats });
  await refreshBadge();
}

async function refreshBadge() {
  const s = await getSettings();
  const day = (s.stats || {})[dayKey()] || {};
  const total = (day.blocked || 0) + (day.popups || 0);
  const text = s.enabled && total > 0 ? (total > 999 ? "999+" : String(total)) : "";
  try {
    await chrome.action.setBadgeBackgroundColor({ color: "#14b8a6" });
    await chrome.action.setBadgeText({ text });
  } catch {}
}

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get(null);
  await chrome.storage.local.set(Object.assign({}, DEFAULTS, cur));
  pruneStats(cur.stats || {});
  if (cur.stats) await chrome.storage.local.set({ stats: cur.stats });
  await refreshRules();
  await refreshBadge();
  chrome.alarms.create("adshield-keepalive", { delayInMinutes: 1, periodInMinutes: 15 });
});

chrome.runtime.onStartup.addListener(async () => {
  await refreshRules();
  await refreshBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "adshield-keepalive") {
    await refreshRules();
    await refreshBadge();
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  cache.settings = null;
  if (!changes.stats) {
    await refreshRules();
    await refreshBadge();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return sendResponse({ ok: false });

    if (msg.type === "getState") {
      const s = await getSettings();
      sendResponse({ ok: true, state: s });
    } else if (msg.type === "setState") {
      await persist({ [msg.key]: msg.value });
      sendResponse({ ok: true });
    } else if (msg.type === "toggleSite") {
      const s = await getSettings();
      const list = parseAllowList(s.allowList);
      const idx = list.indexOf(msg.host);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(msg.host);
      await persist({ allowList: list.join(",") });
      sendResponse({ ok: true });
    } else if (msg.type === "blockCount") {
      bumpStats(msg.kind, msg.n, msg.host);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true;
});

const TAB_RESCUE_HOSTS = new Set(["net77.cc", "vegamoviess.fun"]);
const TAB_REScue_ALLOW = new Set([
  "accounts.google.com", "accounts.youtube.com", "google.com", "youtube.com",
  "www.youtube.com", "sharethis.com", "t.sharethis.com", "telegram.me", "t.me",
  "facebook.com", "m.facebook.com", "www.facebook.com", "fb.com", "fb.watch",
  "twitter.com", "x.com", "instagram.com", "wa.me", "whatsapp.com", "api.whatsapp.com"
]);
const lastGoodUrl = new Map();

function tabRescueInit() {
  try {
    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (!info.url) return;
      try {
        const host = new URL(info.url).hostname.toLowerCase().replace(/^www\./, "");
        const guarded = TAB_RESCUE_HOSTS.has(host);
        if (guarded && info.status !== "loading") lastGoodUrl.set(tabId, info.url);
      } catch {}
    });

    chrome.tabs.onUpdated.addListener((tabId, info) => {
      if (info.status !== "loading") return;
      try {
        const goodUrl = lastGoodUrl.get(tabId);
        if (!goodUrl) return;
        const goodHost = new URL(goodUrl).hostname.toLowerCase().replace(/^www\./, "");
        if (!TAB_RESCUE_HOSTS.has(goodHost)) return;
        const target = new URL(info.url);
        const targetHost = target.hostname.toLowerCase().replace(/^www\./, "");
        if (TAB_RESCUE_ALLOW.has(targetHost)) return;
        if (targetHost === goodHost || targetHost.endsWith("." + goodHost) || goodHost.endsWith("." + targetHost)) return;
        if (/^(chrome|about|devtools|edge|file|data|blob|javascript|view-source)/.test(target.protocol)) return;
        bumpStats("popup", 1, targetHost).catch(() => {});
        chrome.tabs.update(tabId, { url: goodUrl }).catch(() => {});
      } catch {}
    });
  } catch {}
}

function popInjectMain() {
  if (!chrome.scripting || !chrome.scripting.executeScript) return;
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== "loading") return;
    try {
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content/popup-payload.js"],
        world: "MAIN",
        injectImmediately: true
      }).catch(() => {});
    } catch {}
  });
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

const netQueue = { ad: 0, tracker: 0, hosts: { ad: {}, tracker: {} } };
let netTimer = null;

ensureRulesBoot();
tabRescueInit();
popInjectMain();

function flushNetQueue() {
  netTimer = null;
  if (netQueue.ad) { bumpStats("networkAd", netQueue.ad); netQueue.ad = 0; }
  if (netQueue.tracker) { bumpStats("networkTracker", netQueue.tracker); netQueue.tracker = 0; }
  for (const [host, count] of Object.entries(netQueue.hosts.ad)) {
    if (count > 0) bumpStats("networkAd", 0, host);
  }
  for (const [host, count] of Object.entries(netQueue.hosts.tracker)) {
    if (count > 0) bumpStats("networkTracker", 0, host);
  }
  netQueue.hosts = { ad: {}, tracker: {} };
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0 || details.type === "main_frame") return;
    const kind = classifyRequest(details.url);
    if (!kind) return;
    netQueue[kind]++;
    try {
      const host = new URL(details.url).hostname;
      netQueue.hosts[kind][host] = (netQueue.hosts[kind][host] || 0) + 1;
    } catch {}
    if (!netTimer) netTimer = setTimeout(flushNetQueue, 6000);
  },
  { urls: ["<all_urls>"] }
);