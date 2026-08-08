export function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseAllowList(value) {
  return [...new Set(String(value || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean))];
}

export function fmt(n) {
  if (typeof n !== "number") return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}

export function btoaChar(host) {
  let n = 0;
  for (const c of String(host)) n = (n * 31 + c.charCodeAt(0)) | 0;
  return "ABCDEFG23456789"[Math.abs(n) % 16];
}

export const NET_AD_RE = /(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.com|adtag\.google\.com|taboola\.com|outbrain\.com|revcontent\.com|criteo\.|mgid\.com|adnxs\.com|adsrvr\.org|pubmatic\.com|rubiconproject\.com|adform\.(com|net)|moatads\.com|smartadserver\.com|adskeeper\.com)/i;

export const NET_TRACKER_RE = /(connect\.facebook\.net|graph\.facebook\.com|analytics\.tiktok\.com|amplitude\.com|segment\.io|fullstory\.com|hotjar\.com|newrelic\.com|nr-data\.net|mixpanel\.com|krxd\.net|demdex\.net|appsflyer\.com|clarity\.ms|qualtrics\.com|static\.doubleclick\.net|googletagmanager\.com|matomo\.org|plausible\.io)/i;

export function classifyRequest(url) {
  if (typeof url !== "string") return null;
  if (NET_TRACKER_RE.test(url)) return "tracker";
  if (NET_AD_RE.test(url)) return "ad";
  return null;
}

export function styleDays(count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    out.push(d);
  }
  return out;
}

export function seriesStats(stats, days = 30) {
  const src = stats || {};
  return styleDays(days).map((date) => {
    const key = dayKey(date);
    const d = src[key] || {};
    return {
      key,
      date,
      ads: d.ads || 0,
      trackers: d.trackers || 0,
      popups: d.popups || 0,
      blocked: d.blocked || 0,
      total: (d.blocked || 0) + (d.popups || 0),
      domains: d.domains || {}
    };
  });
}

export function pruneStats(stats, days = 30) {
  const cutoff = Date.now() - days * 86400000;
  for (const k of Object.keys(stats || {})) {
    if (new Date(k).getTime() < cutoff) delete stats[k];
  }
  return stats;
}

export function bumpDay(stats, kind, count = 1, host, date = new Date()) {
  const src = JSON.parse(JSON.stringify(stats || {}));
  pruneStats(src);
  const key = dayKey(date);
  const day = src[key] || { ads: 0, trackers: 0, popups: 0, blocked: 0, domains: {} };
  const n = count || 1;

  if (kind === "networkAd") { day.blocked += n; day.ads += n; }
  else if (kind === "networkTracker") { day.blocked += n; day.trackers += n; }
  else if (kind === "popup") { day.popups += n; }
  else if (kind === "cosmetic") { day.ads += n; day.blocked += n; }
  else return { stats: src, key };

  if (host) {
    day.domains = day.domains || {};
    day.domains[host] = (day.domains[host] || 0) + n;
  }
  src[key] = day;
  return { stats: src, key };
}

export function aggregateDomains(series) {
  const out = {};
  for (const s of series) {
    for (const [h, c] of Object.entries(s.domains || {})) {
      out[h] = (out[h] || 0) + c;
    }
  }
  return out;
}

export function summarize(series) {
  let total = 0, ads = 0, trackers = 0, popups = 0;
  for (const s of series) {
    total += s.total;
    ads += s.ads;
    trackers += s.trackers;
    popups += s.popups;
  }
  return { total, ads, trackers, popups };
}

export function ytDecision({ adShowing = false, skipVisible = false, alreadyMuted = false, rate = 1 }) {
  const actions = [];
  if (adShowing && skipVisible) actions.push("skip");
  if (adShowing && !alreadyMuted) actions.push("mute");
  if (adShowing) actions.push("speed");
  if (adShowing) actions.push("hideOverlays");
  if (!adShowing) actions.push("restore");
  return { actions, needsRestore: !adShowing };
}

export function ytFightPlan({ hasSkip = false, calm = true, adAgeMs = 0 }) {
  const plan = {
    clickSkip: hasSkip,
    overlay: true,
    fastForward: false
  };
  if (!hasSkip && !(calm && adAgeMs < 8000)) {
    plan.fastForward = true;
  }
  return plan;
}