(() => {
  if (window.__ADSHIELD_POPUP__) return;
  let win = window;
  let doc;
  try { doc = win.document; } catch { return; }
  win.__ADSHIELD_POPUP__ = true;

  let enabled = false;
  let popDomains = new Set();
  let strict = false;
  const authHosts = new Set([
    "accounts.google.com", "accounts.youtube.com", "google.com", "youtube.com", "www.youtube.com",
    "sharethis.com", "t.sharethis.com", "telegram.me", "t.me",
    "facebook.com", "m.facebook.com", "www.facebook.com", "fb.com", "fb.watch",
    "twitter.com", "x.com", "instagram.com", "wa.me", "whatsapp.com", "api.whatsapp.com"
  ]);
  const realOpen = win.open ? win.open.bind(win) : null;
  let lastGesture = 0;

  const gestureEvents = ["pointerdown", "pointerup", "mousedown", "keydown", "touchstart"];
  const onGesture = () => { lastGesture = performance.now(); };
  for (const ev of gestureEvents) win.addEventListener(ev, onGesture, { capture: true, passive: true });

  function readConfig() {
    try {
      const root = doc.documentElement;
      enabled = !!(root && root.getAttribute("data-sh-popup") === "1");
      strict = !!(root && root.getAttribute("data-sh-strict") === "1");
      const raw = (root && root.getAttribute("data-sh-popdom")) || "";
      popDomains = new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
    } catch { enabled = false; }
  }
  readConfig();
  try {
    new MutationObserver(() => readConfig()).observe(doc.documentElement, { attributes: true, attributeFilter: ["data-sh-popup", "data-sh-popdom", "data-sh-strict"] });
  } catch {}

  function hasGesture() {
    const now = performance.now();
    if (now - lastGesture < 3000) return true;
    try { if (navigator.userActivation && navigator.userActivation.isActive) return true; } catch {}
    return false;
  }

  function makeNop(closed) {
    const target = {
      close() { target.closed = true; },
      focus() {},
      blur() {},
      postMessage() {},
      document: null,
      location: null,
      width: 0,
      height: 0
    };
    target.closed = !!closed;
    return target;
  }

  function notify(type) {
    try { win.postMessage({ __adshield: true, type }, "*"); } catch {}
  }

  let openCount = 0;
  let openCountSince = 0;

  win.open = function open(u, n) {
    readConfig();
    if (!enabled) return realOpen ? realOpen.apply(this, arguments) : null;

    const cleanUrl = typeof arguments[0] === "string" ? arguments[0].trim() : "";
    if (cleanUrl === "" || cleanUrl === "about:blank") {
      notify("popupBlocked");
      return makeNop(true);
    }

    let host = "";
    try { host = new URL(cleanUrl, location.href).hostname.toLowerCase(); } catch {}

    if (strict && host && host !== location.hostname && !authHosts.has(host)) {
      notify("popupBlocked");
      return makeNop(true);
    }

    if (host && popDomains.has(host)) {
      notify("popupBlocked");
      return makeNop(true);
    }

    if (!hasGesture()) {
      notify("popupBlocked");
      return makeNop(true);
    }

    const now = performance.now();
    if (now - openCountSince > 900) { openCount = 0; openCountSince = now; }
    openCount += 1;
    if (openCount > 1) {
      notify("popupBlocked");
      return makeNop(true);
    }

    return realOpen ? realOpen.apply(this, arguments) : null;
  };

  try {
    const nat = Function.prototype.toString;
    win.open.toString = () => nat.call(realOpen);
  } catch {}
})();