import { fmt, dayKey, seriesStats, aggregateDomains, summarize } from "../lib/core.mjs";

const $ = (id) => document.getElementById(id);

let state = null;
let days = 30;

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (resp) => resolve(resp || { ok: false }));
  });
}

function load() {
  return send("getState").then((resp) => {
    if (resp.ok) state = resp.state;
    render();
  });
}

// ── KPI row ─────────────────────────────────────────────────────────────────

function renderKPIs(seq) {
  const s = summarize(seq);
  const domains = new Set();
  for (const obj of Object.values(state.stats || {})) {
    for (const host of Object.keys(obj.domains || {})) domains.add(host);
  }
  $("kTotal").textContent = fmt(s.total);
  $("kAvg").textContent = `${fmt(Math.round(s.total / seq.length))}/day`;
  $("kAds").textContent = fmt(s.ads);
  $("kTrackers").textContent = fmt(s.trackers);
  $("kPopups").textContent = fmt(s.popups);
  $("kSites").textContent = String(domains.size);
}

// ── Trend chart (SVG) ───────────────────────────────────────────────────────

function renderChart(seq) {
  const W = 960, H = 230, padL = 40, padR = 16, padT = 20, padB = 26;
  const max = Math.max(1, ...seq.map((s) => s.total));
  const n = seq.length;
  const x = (i) => padL + (n === 1 ? 0 : ((W - padL - padR) * i) / (n - 1));
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);

  const points = seq.map((s, i) => `${x(i).toFixed(1)},${y(s.total).toFixed(1)}`);
  const linePath = catmullRom(points);
  const areaPoints = `${padL},${H - padB} ${linePath} ${W - padR},${H - padB}`;

  const labels = seq.map((s, i) => {
    if (n > 14 && i % Math.ceil(n / 7) !== 0) return "";
    return `<text class="tick" x="${x(i) + 4}" y="${H - 6}" font-size="10" fill="#5b6b92">${s.date.getMonth() + 1}/${s.date.getDate()}</text>`;
  }).join("");

  $("chart").innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2dd4bf" stop-opacity=".35"/>
          <stop offset="1" stop-color="#2dd4bf" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon class="area" points="${areaPoints}"></polygon>
      <polyline class="area-line" points="${linePath}"></polyline>
      ${seq.map((s, i) => s.total > 0 ? `<circle class="dot" cx="${x(i)}" cy="${y(s.total)}" r="3" fill="#fff" stroke="#0f766e" stroke-width="1.5"><title>${s.key} — ${s.total} blocked</title></circle>` : "").join("")}
      ${labels}
    </svg>`;
  const tot = seq.reduce((a, s) => a + s.total, 0);
  $("trendHint").textContent = `total ${fmt(tot)} in ${n} days · peak ${fmt(max)}/day`;
}

function catmullRom(pts) {
  const p = pts.map((pt) => pt.split(",").map(Number));
  if (p.length < 3) return pFallback(pts);
  let d = `M ${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function pFallback(pts) {
  return pts.join(" ");
}

function renderMix(seq) {
  const s = summarize(seq);
  const total = s.ads + s.trackers + s.popups;
  const rows = [
    { name: "Ads & native", v: s.ads, c: "var(--accent2)" },
    { name: "Trackers", v: s.trackers, c: "var(--violet)" },
    { name: "Popups", v: s.popups, c: "#f472b6" }
  ];
  $("mix").innerHTML = total === 0
    ? `<p class="empty-txt">Nothing blocked in this range yet. Browse — ads will start stacking up here.</p>`
    : rows.map((r) => `
      <div class="mrow">
        <span>${r.name}</span>
        <div class="bar"><div class="fill" style="width:${Math.round((r.v / total) * 100)}%;background:${r.c}"></div></div>
        <b>${fmt(r.v)}</b>
      </div>`).join("");
}

// ── Top blocked hosts ───────────────────────────────────────────────────────

function renderHosts(seq) {
  const hosts = aggregateDomains(seq);
  const top = Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = top.length ? top[0][1] : 1;
  $("hosts").innerHTML = top.length === 0
    ? `<p class="empty-txt">No network-layer blocks recorded yet.</p>`
    : top.map(([h, c], i) => `
      <div class="hrow">
        <span class="rk">${i + 1}</span>
        <div>
          <span class="nm">${h}</span>
          <div class="hbar"><div class="hfill" style="width:${Math.round((c / max) * 100)}%"></div></div>
        </div>
        <span class="cnt">${fmt(c)}</span>
      </div>`).join("");
  $("hostsHint").textContent = top.length ? `${top.length} of ${Object.keys(hosts).length} distinct hosts` : "";
}

// ── Daily stacked breakdown ─────────────────────────────────────────────────

function renderDaily() {
  const seq = seriesStats(state.stats, 30);
  const max = Math.max(1, ...seq.map((s) => s.total));
  $("daily").innerHTML = seq.map((s) => {
    const ah = s.total === 0 ? 0 : Math.max(4, Math.round((s.ads / max) * 100));
    const th = s.total === 0 ? 0 : Math.max(2, Math.round((s.trackers / max) * 100));
    const ph = s.total === 0 ? 0 : Math.max(2, Math.round((s.popups / max) * 100));
    return `<div class="dcol" title="${s.key}: ${s.total} blocked (${s.ads} ads, ${s.trackers} trk, ${s.popups} pop)">
      ${ph ? `<div class="dseg p" style="height:${ph}%"></div>` : ""}
      ${th ? `<div class="dseg t" style="height:${th}%"></div>` : ""}
      ${ah ? `<div class="dseg a" style="height:${ah}%"></div>` : ""}
      <span class="dlab">${s.date.getDate()}</span>
    </div>`;
  }).join("");
}

function render() {
  if (!state) return;
  const seq = seriesStats(state.stats, days);
  renderKPIs(seq);
  renderChart(seq);
  renderMix(seq);
  renderHosts(seq);
  renderDaily();
}

document.querySelectorAll("#rangeSeg button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#rangeSeg button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    days = Number(b.dataset.days);
    render();
  });
});

$("clearBtn").addEventListener("click", async () => {
  if (!confirm("Clear all AdShield statistics? Blocking itself is unaffected.")) return;
  await send("setState", { key: "stats", value: {} });
  load();
});

load();