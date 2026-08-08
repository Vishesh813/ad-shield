const COSMETIC_SELECTORS = [
  "ins.adsbygoogle",
  "[data-adsbygoogle-status]",
  "[data-ad-client]",
  "[data-ad-slot]",
  "[data-ad-format]",
  ".adsbygoogle",
  ".advertisement",
  ".ad-container",
  ".ad-slot",
  ".ad-unit",
  ".ad-box",
  ".ad-banner",
  ".ad-inline",
  ".ad-leaderboard",
  ".ad-skin",
  ".ad-sticky",
  ".ad-wrapper",
  ".google-ad",
  ".sponsored-content",
  ".sponsoredArticle",
  "#ad-banner",
  "#ad-sidebar",
  "#ads-block",
  "#adholder",
  "#ad-slot",
  "#ads-box",
  "#adspace",
  ".advert",
  ".advertisment",
  ".adv-top",
  ".ad_wrap",
  ".ad-wrap",
  ".ad_popup",
  ".ad_popunder",
  "[class*='ad-slot']",
  "[class*='ad-container']",
  "[class*='ad-banner']",
  "[class*='advertisement']",
  "[class*='sponsored-']",
  ".sponsored-goods",
  ".promo-ad",
  ".product-ad"
];

const IFRAME_PATTERNS = [
  /(googlesyndication|doubleclick|googleadservices|taboola|outbrain|revcontent|criteo|mgid\.com)/i,
  /(adsterra|propellerads|propellerclick|popads|popcash|exoclick|trafficjunky|hilltopads|monetag|adAdmiral|adkernel|adpushup|advertisemain|onclick|contpart|aduoad)/i,
  /(^|\/)(ads|advert|sponsored|popunder|interstitial|overlay-?ad|promo)(\/|\.|\?|$)/i,
  /(register|registration|profile-account|click_id|clickid|redtrackApi|utm_source=propeller|utm_campaign=propeller)/i
];

const STRICT_POPUP_SITES = ["net77.cc", "net77.tv", "netmirror.app", "netmirror.gg", "nm77.gg", "vegamoviess.fun", "vegamovies.fun", "vegamovies.site", "vegamovies.cfd"];
const AUTH_OPEN_HOSTS = [
  "accounts.google.com", "accounts.youtube.com", "google.com", "youtube.com", "www.youtube.com",
  "sharethis.com", "t.sharethis.com", "telegram.me", "t.me",
  "facebook.com", "m.facebook.com", "www.facebook.com", "fb.com", "fb.watch",
  "twitter.com", "x.com", "instagram.com", "wa.me", "whatsapp.com", "api.whatsapp.com"
];

const NEVER_HIDE_PROBES = [
  "#fuckadblock", "#bottomAdsense", "#adsenseProbe",
  ".adsbox", ".ad_block_1", ".ad-placeholder", ".ad-test",
  ".pub_300x250", ".pub_300x250m", ".pub_728x90",
  ".textad", "[data-ad-test]"
];

class AdShieldContent {
  constructor() {
    this.host = (location.hostname || "").toLowerCase();
    this.state = { enabled: true, blockAds: true, blockTrackers: true, blockPopups: true, stealthMode: false, allowList: [] };
    this.active = false;
    this.style = null;
    this.observer = null;
    this.mutationTimer = null;
    this.pendingCount = 0;
    this.countTimer = null;
    this.payloadInjected = false;
    this.listening = false;
    this.popupDomains = new Set();
    this.videoAdCount = 0;
    this.videoAdaf = 0;
  }

  setStrictFlag() {
    const root = document.documentElement;
    if (!root) return;
    const strict = STRICT_POPUP_SITES.some((h) => this.host === h || this.host.endsWith("." + h));
    root.setAttribute("data-sh-strict", strict ? "1" : "0");
  }

  async boot() {
    this.setStrictFlag();
    this.setPopupFlag(true);
    this.injectPayload();
    this.loadPopupDomains();
    window.addEventListener("pageshow", () => {
      this.fetchState();
      if (this.active) this.scanDocument();
    });
    window.addEventListener("pagehide", () => {
      if (this.countTimer) {
        clearTimeout(this.countTimer);
        this.countTimer = null;
      }
    });
    this.watchClicks();
    await this.fetchState();
    this.listenStorage();
  }

  async loadPopupDomains() {
    try {
      const res = await fetch(chrome.runtime.getURL("lib/popup-domains.json"));
      if (!res.ok) return;
      const list = await res.json();
      if (!Array.isArray(list)) return;
      this.popupDomains = new Set(list);
      const root = document.documentElement;
      if (root) root.setAttribute("data-sh-popdom", list.join(","));
    } catch {}
  }

  watchClicks() {
    const getHost = (href, base) => {
      try {
        return new URL(href, base).hostname.toLowerCase();
      } catch {
        return "";
      }
    };
    document.addEventListener("click", (e) => {
      const t = e.target;
      const a = t && t.closest ? t.closest("a[href]") : null;
      if (!a) return;
      const href = a.getAttribute("href") || "";
      const strict = this.isStrictSite();
      const host = getHost(href, location.href);
      const targetBlank = (a.target || "").toLowerCase() === "_blank";
      const popupDomainHit = this.popupDomains && (this.popupDomains.has(host) || this.popupDomains.has(host.replace(/^www\./, "")));

      if (strict && host && host !== this.host && targetBlank && !AUTH_OPEN_HOSTS.includes(host)) {
        e.preventDefault();
        e.stopPropagation();
        this.reportPopupBlocked();
        return;
      }
      if (popupDomainHit) {
        e.preventDefault();
        e.stopPropagation();
        this.reportPopupBlocked();
      }
    }, true);
  }

  isStrictSite() {
    try {
      return document.documentElement.getAttribute("data-sh-strict") === "1";
    } catch {
      return false;
    }
  }

  isStrictHost() {
    return this.isStrictSite();
  }

  reportPopupBlocked() {
    chrome.runtime.sendMessage({ type: "blockCount", kind: "popup" }).catch(() => {});
  }

  listenStorage() {
    if (this.listening) return;
    this.listening = true;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "shSettingsChanged") this.fetchState();
    });
    window.addEventListener("message", (e) => {
      if (!e.data || e.data.__adshield !== true) return;
      if (e.data.type === "popupBlocked") {
        chrome.runtime.sendMessage({ type: "blockCount", kind: "popup" }).catch(() => {});
      }
    });
  }

  async fetchState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getState" }, (resp) => {
        if (resp && resp.ok) this.state = resp.state;
        this.apply();
        resolve();
      });
    });
  }

  apply() {
    const allow = (this.state.allowList || []).some((h) => h === this.host);
    this.active = this.state.enabled && this.state.blockAds && !allow;
    this.setPopupFlag(this.state.enabled && this.state.blockPopups && !allow);
    if (this.active) this.ensureHiding();
    else this.teardownHiding();
  }

  setPopupFlag(enabled) {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute("data-sh-popup", enabled ? "1" : "0");
  }

  ensureHiding() {
    if (!this.style || !this.style.parentNode) {
      const style = document.createElement("style");
      style.setAttribute("data-sh-ss", "1");
      (document.head || document.documentElement).appendChild(style);
      this.style = style;
      const sheet = style.sheet;
      for (const sel of COSMETIC_SELECTORS) {
        try {
          const rule = this.state.stealthMode
            ? `${sel} { visibility: hidden !important; height: 0 !important; max-height: 0 !important; overflow: hidden !important; }`
            : `${sel} { display: none !important; }`;
          sheet.insertRule(rule, sheet.cssRules.length);
        } catch {}
      }
    }
    if (!this.observer) {
      this.observer = new MutationObserver((muts) => {
        if (muts.some((m) => Array.from(m.addedNodes || []).some((n) => n.nodeType === 1))) {
          clearTimeout(this.mutationTimer);
          this.mutationTimer = setTimeout(() => this.scanDocument(), 40);
        }
      });
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
    }
    this.scanDocument();
  }

  teardownHiding() {
    if (this.style) {
      this.style.remove();
      this.style = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  scanDocument() {
    if (!this.active) return;
    let count = 0;
    for (const sel of COSMETIC_SELECTORS) {
      let els;
      try {
        els = document.querySelectorAll(sel);
      } catch {
        continue;
      }
      for (const el of els) {
        if (el.hasAttribute("data-sh-hide")) continue;
        if (this.isProbe(el)) continue;
        el.setAttribute("data-sh-hide", "1");
        this.hideElement(el);
        count++;
      }
    }
    for (const node of document.querySelectorAll("iframe, object, embed")) {
      const src = node.getAttribute("src") || node.getAttribute("data-src") || "";
      if (!src) continue;
      if (IFRAME_PATTERNS.some((re) => re.test(src)) && !node.hasAttribute("data-sh-hide")) {
        node.setAttribute("data-sh-hide", "1");
        this.hideElement(node);
        count++;
      }
    }
    if (count) this.reportCosmetic(count);
    this.scanForWalls();
    this.scanVideoAds();
  }

  isProbe(el) {
    return NEVER_HIDE_PROBES.some((sel) => {
      try {
        return el.matches(sel);
      } catch {
        return false;
      }
    });
  }

  findFixedOverlay(el) {
    let node = el;
    for (let i = 0; node && i < 8; i++) {
      let st;
      try {
        st = window.getComputedStyle(node);
      } catch {
        return null;
      }
      if (st.position === "fixed") {
        const r = node.getBoundingClientRect();
        if (r.width >= window.innerWidth * 0.6 && r.height >= window.innerHeight * 0.6) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  scanForWalls() {
    const markers = /(adblock|ad\s*blocker|adblocker|dns[^\n]{0,40}(blocked|blocking|blocker|based|detect)|whitelist|disable\s+(your\s+)?(ad|popup)[^\n]{0,40}continue|adblock[^\n]{0,60}(detected|found)|blocked[^\n]{0,40}refresh)/i;
    for (const el of document.querySelectorAll("div,section,main,article,aside,span,p,iframe")) {
      if (el.hasAttribute("data-sh-hide")) continue;
      const t = (el.textContent || el.getAttribute("src") || "").replace(/\s+/g, " ").trim();
      if (!t || t.length > 4000) continue;
      if (!markers.test(t)) continue;
      let st;
      try {
        st = window.getComputedStyle(el);
      } catch {
        continue;
      }
      if (st.position !== "fixed") continue;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const big = r.width >= vw * 0.6 && r.height >= vh * 0.6;
      const toast = r.width <= vw * 0.9 && r.height <= vh * 0.3;
      const cornerAd = this.isStrictSite() &&
        (r.left >= vw * 0.7) && (r.top >= vh * 0.55) &&
        r.width <= vw * 0.3 && r.height <= vh * 0.35 &&
        /(download|opera|installer|\.exe\b|setup)/i.test(t);
      if (!big && !toast && !cornerAd) continue;
      el.setAttribute("data-sh-hide", "1");
      this.hideElement(el);
      try {
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("pointer-events", "none", "important");
        el.style.setProperty("z-index", "-1", "important");
        el.innerHTML = "";
      } catch {}
      chrome.runtime.sendMessage({ type: "blockCount", kind: "cosmetic", n: 1, host: this.host }).catch(() => {});
    }
  }

  isVideoContext(el) {
    for (let n = el; n && n !== document.documentElement && n.tagName !== "BODY"; n = n.parentElement) {
      if (n.tagName === "VIDEO") return true;
      const cls = typeof n.className === "string" ? n.className.toLowerCase() : "";
      if (/(video|player|movie|watch|media|streamer|embed)/.test(cls)) return true;
    }
    return false;
  }

  scanVideoAds() {
    const markers = /(^|[^a-z])(ad\s*(is\s+)?(loading|playing|will\s*play|in\s*\d+\s*s|skip)|advertisement|sponsored\s*ad|preroll|pre-?roll|(please\s+wait|loading)[^a-z]{0,24}(ad|advertisement))[-a-z0-9 :.,]{0,60}/i;
    for (const el of document.querySelectorAll("div,span,p,h2,h3,button,a")) {
      if (el.hasAttribute("data-sh-hide")) continue;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || t.length < 8 || t.length > 220) continue;
      if (!markers.test(t)) continue;
      if (!this.isVideoContext(el)) continue;
      el.setAttribute("data-sh-hide", "1");
      this.hideElement(el);
      this.videoAdCount++;
    }
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      let visible;
      try {
        const st = window.getComputedStyle(v);
        visible = r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
      } catch {
        visible = true;
      }
      if (!visible && !v.muted && !v.paused) {
        try { v.muted = true; } catch {}
      }
      const src = (v.currentSrc || v.getAttribute("src") || "").toLowerCase();
      if (src && /(^|\/)(ad|advert|preroll|pre-?roll|post-?roll|promo|sponsored|download|setup|opus)[-_.0-9]*\.(mp4|m3u8|webm|mp3)|[?#](ad|advert|preroll)=/.test(src)) {
        try { v.pause(); v.muted = true; } catch {}
        const wrap = v.closest("div,section") || v;
        if (!wrap.hasAttribute("data-sh-hide")) {
          wrap.setAttribute("data-sh-hide", "1");
          this.hideElement(wrap);
        }
      }
    }
    if (this.videoAdaf) {
      chrome.runtime.sendMessage({ type: "blockCount", kind: "cosmetic", n: this.videoAdaf, host: this.host }).catch(() => {});
      this.videoAdaf = 0;
    }
  }

  hideElement(el) {
    if (this.state.stealthMode) {
      const s = el.style;
      s.setProperty("visibility", "hidden", "important");
      s.setProperty("height", "0", "important");
      s.setProperty("max-height", "0", "important");
      s.setProperty("overflow", "hidden", "important");
    } else {
      const s = el.style;
      s.setProperty("display", "none", "important");
      s.setProperty("height", "0", "important");
      s.setProperty("margin", "0", "important");
      s.setProperty("padding", "0", "important");
    }
  }

  reportCosmetic(n) {
    this.pendingCount += n;
    if (this.countTimer) return;
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      if (!this.pendingCount) return;
      chrome.runtime.sendMessage({ type: "blockCount", kind: "cosmetic", n: this.pendingCount, host: this.host }).catch(() => {});
      this.pendingCount = 0;
    }, 2000);
  }

  injectPayload() {
    this.payloadInjected = true;
  }
}

new AdShieldContent().boot();