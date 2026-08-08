(() => {
  if (window.googletag && window.googletag.apiReady) return;

  const pubads = {
    add() { return pubads; },
    addEventListener() { return pubads; },
    removeEventListener() { return pubads; },
    refresh() {},
    appendSingleRequest() {},
    disableInitialLoad() {},
    disableMergedPull() {},
    clearTargeting() { return pubads; },
    setTargeting() { return pubads; },
    getTargeting() { return []; },
    getSlots() { return []; },
    setConfig() { return pubads; },
    setCookieOptions() { return pubads; },
    setPublisherProvidedId() { return pubads; },
    enableVideoAds() {},
    setCentering() {},
    markAsAmp() {},
    setVideoContent() {},
    updateCorrelator() {},
    getCorrelator() { return ""; }
  };

  const slot = {
    getSlotElementId() { return ""; },
    getAdUnitPath() { return ""; },
    addService() { return slot; },
    setTargeting() { return slot; },
    clearTargeting() { return slot; },
    setCollapseEmptyDiv() { return slot; },
    setConfig() { return slot; },
    setSafeFrameConfig() { return slot; },
    defineSizeMapping() { return slot; },
    setCategoryExclusion() { return slot; },
    setTargetUrl() { return slot; },
    getTargetingMap() { return {}; },
    getResponseInformation() { return null; },
    getTargeting() { return {}; },
    getSizes() { return []; },
    addEventListener() { return slot; },
    removeEventListener() { return slot; },
    getService() { return pubads; }
  };

  const gpt = {
    cmd: [],
    apiReady: true,
    pubadsReady: true,
    version: "1.4.0"
  };

  gpt.defineSlot = () => slot;
  gpt.defineOutOfPageSlot = () => slot;
  gpt.defineArraySlot = () => slot;
  gpt.defineSizeMapping = () => ({
    addSize() { return this; },
    build() { return null; }
  });
  gpt.display = () => {};
  gpt.enableServices = () => { gpt.pubadsReady = true; };
  gpt.pubads = () => pubads;
  gpt.getVersion = () => "1.4.0";
  gpt.traffic = () => {};

  const cmd = window.googletag && Array.isArray(window.googletag.cmd) ? window.googletag.cmd : [];
  for (const fn of cmd) {
    try { if (typeof fn === "function") fn(); } catch {}
  }
  gpt.cmd.push = (fn) => {
    try {
      if (typeof fn === "function") fn();
      else if (fn && fn.length && typeof fn.then === "function") fn();
    } catch {}
  };

  window.googletag = gpt;
})();
