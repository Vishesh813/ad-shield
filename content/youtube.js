(() => {
  if (window.__ADSHIELD_YT__) return;
  window.__ADSHIELD_YT__ = true;

  const YT_SELECTORS = [
    ".ytp-ad-player-overlay",
    ".ytp-ad-image-overlay",
    ".ytp-ad-text-overlay",
    ".ytp-ad-compact-banner",
    ".ytp-ad-action-interstitial",
    ".ytp-ad-interrupting",
    ".ytp-ad-module .ytp-ad-message",
    ".ytp-ad-overlay-container",
    ".ytp-ad-simple-ad-badge",
    "ytd-display-ad-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-companion-slot-renderer",
    "ytd-ads-engagement-panel-rendered",
    "ytd-ad-slot-renderer",
    ".ytd-promoted-sparkles-web-renderer",
    ".video-ads",
    "#masthead-ad",
    "#player-ads"
  ];

  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button-modern",
    ".ytp-ad-skip-regular-modern-button",
    ".ytp-ad-skip-button",
    ".ytp-skip-ad-button",
    "button[class*='ytp-ad-skip']"
  ];

  let enabled = false;
  let suspended = false;
  let calm = true;
  let mutedByUs = false;
  let speededByUs = false;
  let fastForwarded = false;
  let adActive = false;
  let adStartAt = 0;
  let pollTimer = null;
  let observer = null;
  let tickQueued = false;
  let styleEl = null;
  let overlayEl = null;

  function refreshState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "getState" }, (resp) => {
        const s = resp && resp.ok ? resp.state : {};
        enabled = !!(s.enabled && s.blockAds);
        calm = s.ytCalm !== false;
        suspended = (s.allowList || "").split(",").map((h) => h.trim().toLowerCase()).includes(location.hostname);
        resolve();
      });
    });
  }

  function video() {
    return document.querySelector("video.html5-main-video");
  }

  function player() {
    return document.querySelector(".html5-video-player");
  }

  function isAdShowing() {
    const p = player();
    if (!p) return false;
    if (p.classList.contains("ad-showing") || p.classList.contains("ad-interrupting")) return true;
    return !!document.querySelector(".ytp-ad-module .ytp-ad-player-overlay");
  }

  function findSkipButton() {
    for (const sel of SKIP_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    const module = document.querySelector(".ytp-ad-module");
    if (module) {
      for (const b of module.querySelectorAll("button")) {
        const t = (b.textContent || "").toLowerCase();
        if (t.includes("skip") || t.includes("跳过") || t.includes("広告をスキップ")) return b;
      }
    }
    return null;
  }

  function ytFightPlan({ hasSkip = false, calm = true, adAgeMs = 0 }) {
    const plan = { clickSkip: hasSkip, overlay: true, fastForward: false };
    if (!hasSkip && !(calm && adAgeMs < 8000)) plan.fastForward = true;
    return plan;
  }

  function ensureStyle() {
    if (styleEl && styleEl.parentNode) return;
    styleEl = document.createElement("style");
    styleEl.setAttribute("data-sh-yt", "1");
    (document.head || document.documentElement).appendChild(styleEl);
    const sheet = styleEl.sheet;
    for (const sel of YT_SELECTORS) {
      try { sheet.insertRule(`${sel} { display: none !important; }`, sheet.cssRules.length); } catch {}
    }
    try {
      sheet.insertRule(
        `[data-sh-hush] { position: absolute !important; top: 50% !important; left: 50% !important; transform: translate(-50%,-50%) !important; z-index: 2147483640 !important; background: rgba(7,12,26,.86) !important; color: #e9eefb !important; padding: 13px 26px !important; border-radius: 14px !important; font: 600 13px/1.4 system-ui, -apple-system, sans-serif !important; letter-spacing: .3px !important; box-shadow: 0 10px 40px rgba(0,0,0,.5) !important; pointer-events: none !important; }`,
        sheet.cssRules.length
      );
    } catch {}
  }

  function ensureOverlay() {
    if (overlayEl && overlayEl.parentNode) return;
    overlayEl = document.createElement("div");
    overlayEl.setAttribute("data-sh-hush", "1");
    overlayEl.textContent = "Skipping ad…";
    const host = player() || document.querySelector("#movie_player") || document.documentElement;
    host.appendChild(overlayEl);
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.remove();
    overlayEl = null;
  }

  function restoreVideo() {
    const v = video();
    removeOverlay();
    if (v) {
      if (mutedByUs) {
        v.muted = false;
        try { v.volume = 1; } catch {}
        mutedByUs = false;
      }
      if (speededByUs) {
        v.playbackRate = 1;
        speededByUs = false;
      }
    }
    fastForwarded = false;
  }

  function handleAd() {
    const v = video();
    let skip = findSkipButton();
    const plan = ytFightPlan({ hasSkip: !!skip, calm, adAgeMs: performance.now() - adStartAt });
    ensureStyle();

    if (plan.clickSkip && skip) {
      try {
        skip.click();
        return;
      } catch {}
    }

    ensureOverlay();

    if (v) {
      if (!v.muted) {
        v.muted = true;
        try { v.volume = 0; } catch {}
        mutedByUs = true;
      }
      if (plan.fastForward && !speededByUs) {
        try {
          v.playbackRate = 16;
          speededByUs = true;
        } catch {}
      }
      if (v.paused) {
        try { v.play().catch(() => {}); } catch {}
      }
    }
  }

  function tick() {
    tickQueued = false;
    if (!enabled || suspended) {
      restoreVideo();
      return;
    }
    const ad = isAdShowing();
    if (ad) {
      if (!adActive) { adActive = true; adStartAt = performance.now(); }
      handleAd();
    } else {
      adActive = false;
      restoreVideo();
    }
  }

  function scheduleTick() {
    if (tickQueued) return;
    tickQueued = true;
    setTimeout(tick, 120);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "shSettingsChanged") refreshState().then(scheduleTick);
  });

  window.addEventListener("pageshow", () => {
    refreshState().then(scheduleTick);
  });

  for (const ev of ["yt-navigate-finish", "yt-page-data-updated", "yt-player-updated", "yt-page-data-changed", "DOMContentLoaded"]) {
    document.addEventListener(ev, scheduleTick, { passive: true });
  }

  refreshState().then(() => {
    ensureStyle();
    tick();
    pollTimer = setInterval(tick, 500);
    observer = new MutationObserver(scheduleTick);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  });
})();