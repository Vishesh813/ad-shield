import { fmt, btoaChar, seriesStats, dayKey } from "../lib/core.mjs";

const $ = (id) => document.getElementById(id);

let state = null;
let host = "";

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => resolve(resp || { ok: false }));
  });
}

async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && /^https?:/.test(tab.url)) host = new URL(tab.url).hostname;
  } catch {}
}

function load() {
  return send("getState").then((resp) => {
    if (resp.ok) state = resp.state;
    render();
  });
}

function render() {
  if (!state) return;
  const on = !!state.enabled;

  $("master").classList.toggle("off", !on);
  $("masterLbl").textContent = on ? "ON" : "OFF";

  $("blockAds").checked = !!state.blockAds;
  $("blockTrackers").checked = !!state.blockTrackers;
  $("blockPopups").checked = !!state.blockPopups;
  $("stealthMode").checked = !!state.stealthMode;
  $("ytCalm").checked = state.ytCalm !== false;

  renderSiteBar(on);
  renderStats();
  renderCharts();
  renderSites();

  $("sn").textContent = on ? "Live protection · all tabs" : "Protection paused";
}

function renderSiteBar(on) {
  const allowList = (state.allowList || "").split(",").map((x) => x.trim()).filter(Boolean);
  const allowed = on && host ? allowList.includes(host) : false;
  $("siteIc").textContent = host ? btoaChar(host) : "✦";
  $("siteName").textContent = host || "This page";
  const sb = $("sitebar");
  if (allowed) {
    sb.classList.add("suspended");
    $("siteStatus").textContent = "Protection suspended on this site";
    $("siteToggle").textContent = "Resume";
  } else if (on) {
    sb.classList.remove("suspended");
    $("siteStatus").textContent = host ? "Protected · network + cosmetic" : "Open a web page to manage";
    $("siteToggle").textContent = "Suspend";
  } else {
    sb.classList.remove("suspended");
    $("siteStatus").textContent = "Master switch is off";
    $("siteToggle").textContent = "Suspend";
  }
}

function renderStats() {
  const stats = state.stats || {};
  const day = stats[dayKey()] || {};
  $("kAds").textContent = fmt(day.ads || 0);
  $("kTrackers").textContent = fmt(day.trackers || 0);
  $("kPopups").textContent = fmt(day.popups || 0);
  $("kRequests").textContent = fmt((day.blocked || 0) + (day.popups || 0));
}

function renderCharts() {
  const seq = seriesStats(state.stats, 7);
  const max = Math.max(1, ...seq.map((s) => s.total));
  const total = seq.reduce((a, s) => a + s.total, 0);
  $("trendTotal").textContent = `${fmt(total)} blocked`;
  const bars = $("bars");
  bars.innerHTML = "";
  for (const s of seq) {
    const h = max ? Math.max(3, Math.round((s.total / max) * 100)) : 3;
    const bar = document.createElement("div");
    bar.className = "bar" + (s.total === 0 ? " low" : "");
    bar.style.height = h + "%";
    const tt = document.createElement("span");
    tt.className = "tt";
    tt.textContent = `${s.key}: ${s.total}`;
    bar.appendChild(tt);
    bars.appendChild(bar);
  }
}

function renderSites() {
  const allowList = (state.allowList || "").split(",").map((x) => x.trim()).filter(Boolean);
  $("sitesCount").textContent = `${allowList.length} site${allowList.length === 1 ? "" : "s"}`;
  const list = $("sitesList");
  list.innerHTML = "";
  for (const site of allowList) {
    const chip = document.createElement("div");
    chip.className = "chip";
    const sp = document.createElement("span");
    sp.textContent = site;
    chip.appendChild(sp);
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.title = "Remove allowance";
    rm.addEventListener("click", () => send("toggleSite", { host: site }).then(load));
    chip.appendChild(rm);
    list.appendChild(chip);
  }
  $("sitesEmpty").style.display = allowList.length ? "none" : "block";
}

["master", "blockAds", "blockTrackers", "blockPopups", "stealthMode", "ytCalm"].forEach((id) => {
  const el = $(id);
  if (id === "master") {
    el.addEventListener("click", () => send("setState", { key: "enabled", value: !state.enabled }).then(load));
  } else {
    el.addEventListener("change", (e) => send("setState", { key: id, value: e.target.checked }).then(load));
  }
});

$("siteToggle").addEventListener("click", () => {
  if (!host || !state.enabled) return;
  send("toggleSite", { host }).then(load);
});

$("openAnalytics").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

getActiveTab().then(load);