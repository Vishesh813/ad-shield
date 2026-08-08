(() => {
  if (window.adsbygoogle && !window.__adshieldStub) return;
  window.__adShieldStub = true;

  const createSlot = function () {
    const callback = arguments.length ? arguments[0] : {};
    const pushArgs = arguments.length ? Array.prototype.slice.call(arguments) : [];
    const slot = { elementId: (Math.random() * 1e16).toFixed(), path: "unknown" };
    if (typeof callback === "object" && callback) {
      if (callback.onReady) callback.onReady();
      if (callback.onAdRender) callback.onAdRender();
      if (callback.onError && window.console && console.warn) console.warn("[adsbygoogle] ad slot blocked by AdShield");
      if (!callback.autoAdRequested && callback.params) {
        slot.path = callback.params.ad_client || "000000";
      }
    }
    return slot;
  };

  const api = window.__adShown ? window.__adShown : (window.__adShown = { push: [] });
  api.load = function () {};
  api.postalMessage = function () {};
  if (!api.push) {
    const queue = window.adsbygoogle || [];
    queue.forEach(createSlot);
    api.push = function (config) {
      try {
        if (typeof config === "function") {
          config();
        } else if (config && config.service !== "AdSense") {
          createSlot(config);
        }
      } catch (e) {
        if (console && console.warn) console.warn("[adsby] AdShield stub error", e);
      }
    };
  }
  window.adsbygoogle = api;
})();