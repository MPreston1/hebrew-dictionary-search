(function () {
  "use strict";

  // ---------- Saved preferences ----------
  const DICTS = ["morfix", "pealim", "milog"];

  function loadPref(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function loadEnabled() {
    const saved = loadPref("dictSet", null);
    const out = { morfix: true, pealim: true, milog: true };
    if (saved && typeof saved === "object") {
      for (const d of DICTS) if (typeof saved[d] === "boolean") out[d] = saved[d];
    }
    if (!DICTS.some(d => out[d])) out.morfix = true;
    return out;
  }

  // ---------- State ----------
  const state = {
    firebaseKey: "AIzaSyB7Uf_gXgLY2TOKdKPfHn9xoAaZK1NKywU",
    token: null,
    tokenExpiresAt: 0,
    showGloss: loadPref("showGloss", false),
    enabled: loadEnabled(),
    relayUrl: loadPref("relayUrl", ""),   // optional Pi relay address (set in Settings)
    relayAvailable: false,                // did the relay answer its last ping?
    relayCache: false,                    // ...and does it offer the shared cache?
    relayReason: "",                      // why the last ping failed (shown in Settings)
    activeTab: "morfix",
    morfix: { lastResult: null, lastRaw: null },
    pealim: { lastResult: null, lastRawHtml: null },
    milog: { lastResult: null, lastRawHtml: null }
  };

  // ---------- Elements ----------
  const els = {
    form: document.getElementById("search-form"),
    input: document.getElementById("search-input"),
    goButton: document.getElementById("go-button"),
    resultTabs: document.getElementById("result-tabs"),
    columnMorfix: document.getElementById("column-morfix"),
    columnPealim: document.getElementById("column-pealim"),
    columnMilog: document.getElementById("column-milog"),
    dictColumns: document.querySelector(".dict-columns"),
    showGlossCheckbox: document.getElementById("show-gloss"),
    statusMorfix: document.getElementById("status-morfix"),
    statusPealim: document.getElementById("status-pealim"),
    statusMilog: document.getElementById("status-milog"),
    viewRawMorfix: document.getElementById("view-raw-morfix"),
    viewRawPealim: document.getElementById("view-raw-pealim"),
    viewRawMilog: document.getElementById("view-raw-milog"),
    refreshMorfix: document.getElementById("refresh-morfix"),
    refreshPealim: document.getElementById("refresh-pealim"),
    refreshMilog: document.getElementById("refresh-milog"),
    resultsMorfix: document.getElementById("results-morfix"),
    resultsPealim: document.getElementById("results-pealim"),
    resultsMilog: document.getElementById("results-milog"),
    openSettings: document.getElementById("open-settings"),
    dialog: document.getElementById("settings-dialog"),
    firebaseKeyField: document.getElementById("firebase-key"),
    relayUrlField: document.getElementById("relay-url"),
    relayStatus: document.getElementById("relay-status"),
    relayTest: document.getElementById("relay-test"),
    relayCacheStatus: document.getElementById("relay-cache-status"),
    relayCacheSend: document.getElementById("relay-cache-send"),
    settingsSave: document.getElementById("settings-save"),
    settingsCancel: document.getElementById("settings-cancel"),
    rawDialog: document.getElementById("raw-dialog"),
    rawDialogTitle: document.getElementById("raw-dialog-title"),
    rawJson: document.getElementById("raw-json"),
    rawClose: document.getElementById("raw-close"),
    hoverTooltip: document.getElementById("hover-tooltip"),
    searchCacheStatus: document.getElementById("search-cache-status"),
    searchCacheExport: document.getElementById("search-cache-export"),
    searchCacheImport: document.getElementById("search-cache-import"),
    searchCacheImportFile: document.getElementById("search-cache-import-file"),
    searchCacheClear: document.getElementById("search-cache-clear")
  };

  els.firebaseKeyField.value = state.firebaseKey;
  els.showGlossCheckbox.checked = state.showGloss;

  els.openSettings.addEventListener("click", () => {
    els.firebaseKeyField.value = state.firebaseKey;
    els.relayUrlField.value = getSavedRelay();
    renderRelayStatus();
    els.dialog.showModal();
    refreshSearchCacheStatus();
    refreshPiCacheStatus();
  });
  els.settingsCancel.addEventListener("click", () => els.dialog.close());
  els.settingsSave.addEventListener("click", () => {
    state.firebaseKey = els.firebaseKeyField.value.trim();
    state.token = null;
    // Save the relay address too if it was edited (Save & test does the same, with a visible check).
    if (els.relayUrlField.value.trim().replace(/\/+$/, "") !== getSavedRelay()) saveRelayUrl();
    els.dialog.close();
  });
  els.relayTest.addEventListener("click", () => saveRelayUrl());
  els.relayCacheSend.addEventListener("click", () => sendCacheToPi());

  // ---------- Search result cache UI ----------
  async function refreshSearchCacheStatus() {
    try {
      const count = await searchCacheCount();
      els.searchCacheStatus.textContent = count
        ? `${count} result${count === 1 ? "" : "s"} cached.`
        : "Nothing cached yet.";
    } catch (e) {
      els.searchCacheStatus.textContent = "Couldn't read the cache.";
    }
  }
  refreshSearchCacheStatus();

  els.searchCacheExport.addEventListener("click", async () => {
    els.searchCacheExport.disabled = true;
    const originalLabel = els.searchCacheExport.textContent;
    els.searchCacheExport.textContent = "Preparing…";
    try {
      await exportSearchCache();
    } catch (e) {
      alert(`Couldn't export search cache: ${e.message}`);
    } finally {
      els.searchCacheExport.disabled = false;
      els.searchCacheExport.textContent = originalLabel;
    }
  });

  els.searchCacheImport.addEventListener("click", () => els.searchCacheImportFile.click());
  els.searchCacheImportFile.addEventListener("change", async () => {
    const file = els.searchCacheImportFile.files && els.searchCacheImportFile.files[0];
    els.searchCacheImportFile.value = ""; // allow re-selecting the same file later
    if (!file) return;
    els.searchCacheImport.disabled = true;
    const originalLabel = els.searchCacheImport.textContent;
    els.searchCacheImport.textContent = "Importing…";
    try {
      const text = await file.text();
      const summary = await importSearchCache(text);
      await refreshSearchCacheStatus();
      alert(`Imported ${summary.count} cached result${summary.count === 1 ? "" : "s"}.`);
    } catch (e) {
      alert(`Couldn't import search cache: ${e.message}`);
    } finally {
      els.searchCacheImport.disabled = false;
      els.searchCacheImport.textContent = originalLabel;
    }
  });

  els.searchCacheClear.addEventListener("click", async () => {
    if (!confirm("Clear all cached search results?")) return;
    els.searchCacheClear.disabled = true;
    try {
      await clearSearchCache();
      await refreshSearchCacheStatus();
      // Nothing on screen is backed by the cache anymore — drop the
      // "Refresh" links so the columns don't keep implying otherwise
      // until the next search.
      els.refreshMorfix.hidden = true;
      els.refreshPealim.hidden = true;
      els.refreshMilog.hidden = true;
    } catch (e) {
      alert(`Couldn't clear search cache: ${e.message}`);
    } finally {
      els.searchCacheClear.disabled = false;
    }
  });

  // The number shown in a phone-width tab next to the dictionary's name.
  // Empty (not 0) when there's nothing to count.
  function setTabCount(dict, n) {
    const el = document.getElementById("tabcount-" + dict);
    if (el) el.textContent = n ? String(n) : "";
  }

  function resetMorfixColumn() {
    setTabCount("morfix", 0);
    state.morfix.lastResult = null;
    state.morfix.lastRaw = null;
    els.statusMorfix.textContent = "";
    els.statusMorfix.classList.remove("error");
    els.viewRawMorfix.hidden = true;
    els.refreshMorfix.hidden = true;
    els.resultsMorfix.innerHTML = `<div class="empty-state">Search a word to see its entry.</div>`;
  }

  function resetPealimColumn() {
    setTabCount("pealim", 0);
    state.pealim.lastResult = null;
    state.pealim.lastRawHtml = null;
    els.statusPealim.textContent = "";
    els.statusPealim.classList.remove("error");
    els.viewRawPealim.hidden = true;
    els.refreshPealim.hidden = true;
    els.resultsPealim.innerHTML = `<div class="empty-state">Search a word to see its entry.</div>`;
  }

  function resetMilogColumn() {
    setTabCount("milog", 0);
    state.milog.lastResult = null;
    state.milog.lastRawHtml = null;
    els.statusMilog.textContent = "";
    els.statusMilog.classList.remove("error");
    els.viewRawMilog.hidden = true;
    els.refreshMilog.hidden = true;
    els.resultsMilog.innerHTML = `<div class="empty-state">Search a word to see its entry.</div>`;
  }

  // Reflect state.enabled in the dictionary buttons, the columns and the phone tabs.
  function applyScope() {
    const enabled = DICTS.filter(d => state.enabled[d]);
    if (!enabled.includes(state.activeTab)) state.activeTab = enabled[0];
    const columns = { morfix: els.columnMorfix, pealim: els.columnPealim, milog: els.columnMilog };
    for (const d of DICTS) {
      const on = state.enabled[d];
      const isActive = state.activeTab === d;
      document.getElementById("toggle-" + d).setAttribute("aria-pressed", String(on));
      columns[d].hidden = !on;
      columns[d].classList.toggle("active-tab", isActive);
      const tab = document.getElementById("tab-" + d);
      tab.hidden = !on;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    }
    // Tabs only appear (on phone-width screens, via CSS) when 2+ dictionaries are on
    els.resultTabs.classList.toggle("on", enabled.length >= 2);
    els.dictColumns.classList.toggle("tabs-on", enabled.length >= 2);
    els.dictColumns.classList.toggle("cols-1", enabled.length === 1);
    els.dictColumns.classList.toggle("cols-2", enabled.length === 2);
    if (!state.enabled.morfix) resetMorfixColumn();
    if (!state.enabled.pealim) resetPealimColumn();
    if (!state.enabled.milog) resetMilogColumn();
  }

  // Tab mode (one dictionary at a time, switched with tabs) is for phones in either
  // orientation and for narrow windows. A phone is a touch screen whose physical screen is
  // small; screen.width/height don't change when iOS widens the page, unlike the layout width.
  function updateTabMode() {
    const narrow = window.matchMedia("(max-width: 760px)").matches;
    const phone = window.matchMedia("(pointer: coarse)").matches &&
      Math.min(window.screen.width, window.screen.height) <= 600;
    document.documentElement.classList.toggle("tab-mode", narrow || phone);
  }
  updateTabMode();
  window.addEventListener("resize", updateTabMode);
  window.addEventListener("orientationchange", updateTabMode);

  // At least one dictionary always stays pressed.
  function toggleDict(which) {
    const next = { ...state.enabled, [which]: !state.enabled[which] };
    if (!DICTS.some(d => next[d])) return;
    state.enabled = next;
    savePref("dictSet", state.enabled);
    applyScope();
  }
  for (const d of DICTS) {
    document.getElementById("toggle-" + d).addEventListener("click", () => toggleDict(d));
    document.getElementById("tab-" + d).addEventListener("click", () => {
      state.activeTab = d;
      applyScope();
    });
  }
  applyScope();

  els.showGlossCheckbox.addEventListener("change", () => {
    state.showGloss = els.showGlossCheckbox.checked;
    savePref("showGloss", state.showGloss);
    if (state.morfix.lastResult) renderMorfix(state.morfix.lastResult);
  });

  els.rawClose.addEventListener("click", () => els.rawDialog.close());
  els.viewRawMorfix.addEventListener("click", () => {
    els.rawDialogTitle.textContent = "Raw Morfix response";
    els.rawJson.textContent = state.morfix.lastRaw ? JSON.stringify(state.morfix.lastRaw, null, 2) : "(nothing to show)";
    els.rawDialog.showModal();
  });
  els.viewRawPealim.addEventListener("click", () => {
    els.rawDialogTitle.textContent = "Raw Pealim response (HTML)";
    els.rawJson.textContent = state.pealim.lastRawHtml || "(nothing to show)";
    els.rawDialog.showModal();
  });
  els.viewRawMilog.addEventListener("click", () => {
    els.rawDialogTitle.textContent = "Raw Milog response (HTML)";
    els.rawJson.textContent = state.milog.lastRawHtml || "(nothing to show)";
    els.rawDialog.showModal();
  });

  // ---------- Timeout + auth helpers ----------
  // cache: "no-store" is essential here, not just tidy: without it the
  // browser's own HTTP cache can silently serve an old response for these
  // proxy URLs — even with no network connection at all — completely
  // bypassing the app's own IndexedDB search cache and its 3-month
  // staleness/"Clear cache" logic. This keeps that cache the only cache.
  function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, cache: "no-store", signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function getToken() {
    const now = Date.now();
    if (state.token && now < state.tokenExpiresAt) return state.token;
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(state.firebaseKey)}`,
      { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnSecureToken: true }) }
    );
    if (!resp.ok) throw new Error(`Firebase auth failed (${resp.status}). Check the Firebase API key in Settings.`);
    const data = await resp.json();
    state.token = data.idToken;
    const expiresInMs = (parseInt(data.expiresIn, 10) || 3600) * 1000;
    state.tokenExpiresAt = now + expiresInMs - 60000;
    return state.token;
  }

  // ---------- Pi relay (optional) ----------
  // If a relay address is saved and the relay answers its ping (which only happens
  // while this device is on your tailnet), lookups go through the Pi first. If it
  // doesn't answer, or a relayed request fails, the public CORS proxies below take
  // over exactly as before.
  const RELAY_PING_TIMEOUT_MS = 3000;
  const RELAY_FETCH_TIMEOUT_MS = 15000;
  let relayCheckPromise = null;

  // The address typed in Settings. Blank when this page is served by the Pi itself.
  function getSavedRelay() {
    return String(state.relayUrl || "").trim().replace(/\/+$/, "");
  }

  // The relay to use: the saved address or, on a page the relay serves itself
  // (it adds window.PI_HOSTED), that same server.
  function getRelayBase() {
    return getSavedRelay() || (window.PI_HOSTED ? window.location.origin : "");
  }

  function relayStatusText() {
    if (!getRelayBase()) return "Not set up. Lookups use the public CORS proxies.";
    if (state.relayAvailable) {
      return window.PI_HOSTED && !getSavedRelay()
        ? "Connected. This page is served by your Pi, so lookups go through it first, with the public proxies as a fallback."
        : "Connected. Lookups go through your Pi first, with the public proxies as a fallback.";
    }
    return `Can't reach the relay (${state.relayReason || "is Tailscale on?"}). Lookups use the public CORS proxies.`;
  }

  function renderRelayStatus() {
    if (els.relayStatus) els.relayStatus.textContent = relayStatusText();
    if (els.dialog && els.dialog.open) refreshPiCacheStatus();
  }

  // Ask the relay whether it is there. Fails quietly when it isn't.
  function checkRelay() {
    if (relayCheckPromise) return relayCheckPromise;   // a check is already running
    relayCheckPromise = (async () => {
      const base = getRelayBase();
      let ok = false;
      let cacheOk = false;
      state.relayReason = "";
      if (base) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), RELAY_PING_TIMEOUT_MS);
        try {
          const r = await fetch(base + "/api/ping", { signal: ctrl.signal, cache: "no-store" });
          if (!r.ok) {
            state.relayReason = `the relay answered HTTP ${r.status}` + (r.status === 404 ? " - is it updated and restarted?" : "");
          } else {
            const j = await r.json();
            if (j.ok === true && j.service === "dictionary-relay" && Array.isArray(j.features) && j.features.includes("fetch")) {
              ok = true;
              cacheOk = j.features.includes("cache");
            } else if (j.service === "ceyd-relay") {
              state.relayReason = "that's the old relay - update and restart it";
            } else {
              state.relayReason = "unexpected reply from that address";
            }
          }
        } catch (e) {
          state.relayReason = e.name === "AbortError"
            ? `no answer within ${RELAY_PING_TIMEOUT_MS / 1000} seconds - is Tailscale on?`
            : "blocked or unreachable - not on Tailscale, or the browser refused the cross-site request";
        }
        clearTimeout(timer);
      }
      state.relayAvailable = ok;
      state.relayCache = ok && cacheOk;
      renderRelayStatus();
      return ok;
    })().finally(() => { relayCheckPromise = null; });
    return relayCheckPromise;
  }

  async function saveRelayUrl() {
    let v = els.relayUrlField.value.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
    els.relayUrlField.value = v;
    if (relayCheckPromise) await relayCheckPromise;     // let any check for the old address finish first
    state.relayUrl = v;
    savePref("relayUrl", v);
    state.relayAvailable = false;
    els.relayStatus.textContent = getRelayBase() ? "Checking…" : relayStatusText();
    if (getRelayBase()) await checkRelay();
  }

  // One lookup through the relay: the target URL goes in the query string, and only
  // Authorization/Accept are passed along (as X-Target-* headers).
  function relayAttempt(url, headers) {
    return {
      name: "Pi relay",
      fetch: async () => {
        const fwd = {};
        for (const [name, value] of Object.entries(headers)) {
          const lower = name.toLowerCase();
          if (lower === "authorization") fwd["X-Target-Authorization"] = value;
          else if (lower === "accept") fwd["X-Target-Accept"] = value;
        }
        try {
          return await fetchWithTimeout(
            `${getRelayBase()}/api/fetch?url=${encodeURIComponent(url)}`,
            { headers: fwd }, RELAY_FETCH_TIMEOUT_MS);
        } catch (err) {
          // Network-level failure: the relay has gone away (left the tailnet, Pi off).
          // Stop trying it until the next check; the proxies take this lookup.
          if (err.name !== "AbortError") { state.relayAvailable = false; renderRelayStatus(); }
          throw err;
        }
      }
    };
  }

  // ---------- Generic CORS fallback chain ----------
  // corsproxy.io goes first: it's the only proxy here that can forward custom
  // headers (needed for Morfix's Authorization). The others are fallbacks in
  // case corsproxy.io is rate-limited/down. `parseAndValidate` decides what
  // counts as a genuine success for a given site — simple passthrough proxies
  // (allorigins, codetabs) return their own 200 OK even when the upstream
  // body is an error page, so HTTP status alone isn't trustworthy.
  async function fetchWithCorsFallback(url, { headers = {}, parseAndValidate }) {
    // If the first ping is still in flight, wait for it (at most a few seconds) so the
    // relay isn't skipped just because it hasn't answered yet.
    if (relayCheckPromise) await relayCheckPromise;
    const attempts = [
      //{ name: 'corsproxy.io', fetch: () => fetchWithTimeout(`https://corsproxy.io/?key=46e13d75&url=${encodeURIComponent(url)}`, { headers }, 9000) },
      { name: 'corsproxy.io', fetch: () => {
        let proxyUrl =
          `https://corsproxy.io/?key=KEYDATA&url=${encodeURIComponent(url)}`;

        for (const [name, value] of Object.entries(headers)) {
          proxyUrl += `&reqHeaders=${encodeURIComponent(`${name}:${value}`)}`;
        }

        return fetchWithTimeout(proxyUrl, {}, 9000);
        }
      },
      { name: 'direct',       fetch: () => fetchWithTimeout(url, { headers }, 8000) },
      { name: 'allorigins',   fetch: () => fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {}, 9000) },
      { name: 'codetabs',     fetch: () => fetchWithTimeout(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, {}, 9000) },
    ];
    if (state.relayAvailable && getRelayBase()) attempts.unshift(relayAttempt(url, headers));
    const errors = [];
    for (const attempt of attempts) {
      try {
        const resp = await attempt.fetch();
        if (!resp.ok) { errors.push(`${attempt.name}: HTTP ${resp.status}`); continue; }
        let result;
        try {
          result = await parseAndValidate(resp);
        } catch (e) {
          errors.push(`${attempt.name}: ${e.message}`);
          continue;
        }
        if (result === null || result === undefined) {
          errors.push(`${attempt.name}: response didn't look valid`);
          continue;
        }
        return { data: result, via: attempt.name };
      } catch (err) {
        errors.push(`${attempt.name}: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
      }
    }
    throw new Error(`All fetch attempts failed — ${errors.join('; ')}`);
  }

  // ---------- Morfix ----------
  async function fetchMorfix(word, { retriedAuth = false } = {}) {
    const token = await getToken();
    const targetUrl =
      "https://backend.morfix.com/TranslationHebrew/TranslationService.svc/GetTranslation/" +
      encodeURIComponent(word);
    const authHeaders = { "Authorization": `Bearer ${token}`, "Accept": "application/json" };
    //const authHeaders = { "Authorization": `Bearer ${token}` };

    let data, via;
    try {
      ({ data, via } = await fetchWithCorsFallback(targetUrl, {
        headers: authHeaders,
        parseAndValidate: async resp => {
          const parsed = await resp.json();
          return (parsed && ("ResultType" in parsed || "TranslationType" in parsed)) ? parsed : null;
        }
      }));
    } catch (err) {
      if (!retriedAuth) {
        state.token = null;
        return fetchMorfix(word, { retriedAuth: true });
      }
      throw new Error(`Could not reach Morfix through any route. ${err.message}`);
    }
    return { data, via };
  }

  function flattenMeanings(meaningGroups) {
    const result = [];
    for (const group of meaningGroups || []) {
      const items = group
        .map(item => ({ displayText: item.DisplayText || "", gloss: item.Translation || "" }))
        .filter(it => it.displayText || it.gloss);
      const displayText = items.map(it => it.displayText).filter(Boolean).join(", ");
      const definition = group.map(item => item.Meaning).filter(Boolean).join("; ");
      if (displayText || definition) result.push({ displayText, definition, items });
    }
    return result;
  }

  function parseMorfixResponse(data) {
    const isToEnglish = data.TranslationType === "ToEnglish";
    const headwordLanguage = isToEnglish ? "hebrew" : "english";
    const matched = data.ResultType === "Match";
    const entries = (data.Words || []).map(word => ({
      id: word.ID || "",
      headwordLanguage,
      partOfSpeech: word.PartOfSpeech || "",
      senses: flattenMeanings(word.InputLanguageMeanings),
      translations: flattenMeanings(word.OutputLanguageMeanings)
    }));
    const corrections = (data.CorrectionList || []).map(item => item.Word).filter(Boolean);
    return { query: data.Query || "", matched, entries, corrections };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function senseListHtml(senses, dir) {
    if (!senses.length) return "";
    return `<ul class="sense-list" dir="${dir}">${senses.map(s => {
      const glossItems = state.showGloss ? (s.items || []).filter(it => it.gloss) : [];
      return `
      <li>
        <span class="sense-display">${escapeHtml(s.displayText)}</span>
        ${s.definition ? `<span class="sense-def">${escapeHtml(s.definition)}</span>` : ""}
        ${glossItems.length ? `<ul class="gloss-sublist">${glossItems.map(it => `
          <li class="sense-gloss">${escapeHtml(it.displayText)} — ${escapeHtml(it.gloss)}</li>`).join("")}</ul>` : ""}
      </li>`;
    }).join("")}</ul>`;
  }

  function morfixEntryCardHtml(entry) {
    const tabLabel = entry.headwordLanguage === "hebrew" ? "HEB → ENG" : "ENG → HEB";
    const headword = entry.senses[0] ? entry.senses[0].displayText : "";
    const sourceDir = entry.headwordLanguage === "hebrew" ? "rtl" : "ltr";
    const translationDir = entry.headwordLanguage === "hebrew" ? "ltr" : "rtl";
    return `
      <div class="entry-card">
        <div class="entry-tab">${tabLabel}</div>
        <div class="entry-body">
          <div class="headword-row" dir="${sourceDir}">
            <span class="headword">${escapeHtml(headword)}</span>
            ${entry.partOfSpeech ? `<span class="pos-tag">${escapeHtml(entry.partOfSpeech)}</span>` : ""}
          </div>
          ${entry.translations.length ? `<div class="section-label">Translations</div>${senseListHtml(entry.translations, translationDir)}` : ""}
          ${entry.senses.length > 1 || (entry.senses[0] && entry.senses[0].definition) ? `<div class="section-label">Source</div>${senseListHtml(entry.senses, sourceDir)}` : ""}
        </div>
      </div>`;
  }

  function morfixSuggestionsHtml(result) {
    return `
      <div class="suggestions-box">
        <div class="section-label">No exact match for "${escapeHtml(result.query)}" — did you mean</div>
        <div class="chip-row">
          ${result.corrections.map(w => `<button type="button" class="chip" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`).join("")}
        </div>
      </div>`;
  }

  function renderMorfix(result) {
    setTabCount("morfix", result.matched ? result.entries.length : 0);
    if (result.matched && result.entries.length) {
      els.resultsMorfix.innerHTML = result.entries.map(morfixEntryCardHtml).join("");
    } else if (result.corrections.length) {
      els.resultsMorfix.innerHTML = morfixSuggestionsHtml(result);
      els.resultsMorfix.querySelectorAll(".chip").forEach(chip => {
        chip.addEventListener("click", () => {
          els.input.value = chip.dataset.word;
          doSearch(chip.dataset.word);
        });
      });
    } else {
      els.resultsMorfix.innerHTML = `<div class="empty-state">No results for "${escapeHtml(result.query)}".</div>`;
    }
  }

  async function doMorfixSearch(word, { forceRefresh = false } = {}) {
    setTabCount("morfix", 0);
    els.statusMorfix.textContent = "Searching…";
    els.statusMorfix.classList.remove("error");
    els.refreshMorfix.hidden = true;

    if (!forceRefresh) {
      const cached = await getCachedSearchResult("morfix", word);
      if (cached) {
        state.morfix.lastRaw = null;
        state.morfix.lastResult = cached.result;
        els.viewRawMorfix.hidden = true;
        renderMorfix(cached.result);
        els.statusMorfix.textContent = `cached · retrieved ${formatCacheDate(cached.retrievedAt)}${cached.fromPi ? " · from your Pi" : ""}`;
        els.refreshMorfix.hidden = false;
        return;
      }
    }

    try {
      const { data, via } = await fetchMorfix(word);
      state.morfix.lastRaw = data;
      els.viewRawMorfix.hidden = false;
      const result = parseMorfixResponse(data);
      state.morfix.lastResult = result;
      renderMorfix(result);
      els.statusMorfix.textContent = `via ${via}`;
      await putCachedSearchResult("morfix", word, result);
    } catch (err) {
      const fallback = await tryHeadwordFallback("morfix", word);
      if (fallback) {
        state.morfix.lastRaw = null;
        state.morfix.lastResult = fallback.result;
        els.viewRawMorfix.hidden = true;
        renderMorfix(fallback.result);
        els.statusMorfix.textContent = `partial match from cached "${fallback.query}" search · retrieved ${formatCacheDate(fallback.retrievedAt)}`;
        els.refreshMorfix.hidden = false;
        return;
      }
      els.statusMorfix.textContent = err.message;
      els.statusMorfix.classList.add("error");
    }
  }

  // ---------- Pealim ----------
  // Content here travels through third-party CORS proxies, which could in
  // principle be compromised or return tampered HTML. Rather than trust and
  // inject that HTML wholesale, we parse it into plain data (search results)
  // or rebuild the conjugation table through an attribute/tag allowlist
  // (sanitizeNode below) before anything reaches the live page.

  async function fetchPealimPage(url) {
    const { data, via } = await fetchWithCorsFallback(url, {
      headers: {},
      parseAndValidate: async resp => {
        const text = await resp.text();
        return /Hebrew conjugation tables|pealim\.com/i.test(text) ? text : null;
      }
    });
    return { html: data, via };
  }

  function idbTxDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
  }

  // ---------- Shared cache on the Pi (optional) ----------
  // Layered on top of the device cache below. A search this device hasn't cached is
  // looked up on the Pi first (another device may have done it), and everything this
  // device saves is also sent to the Pi. It only runs while the relay answers its ping
  // and says it has the cache; otherwise this device's own cache works as before.
  // Records are the device cache's own records, and the same 3-month lifetime applies.
  const PI_CACHE_GET_TIMEOUT_MS = 5000;
  const PI_CACHE_PUT_TIMEOUT_MS = 20000;
  const PI_CACHE_POST_MAX_CHARS = 3000000;   // per upload, well under the relay's 10 MB limit
  const PI_CACHE_POST_MAX_RECORDS = 500;     // the relay's limit per kind of record per upload

  function piCacheOn() {
    return state.relayAvailable && state.relayCache && !!getRelayBase();
  }

  // A network-level failure means the relay has gone away (left the tailnet, Pi off).
  function piCacheNetworkFailure(err) {
    if (err && err.name !== "AbortError") { state.relayAvailable = false; renderRelayStatus(); }
  }

  // GET a cache path; the parsed JSON, or null for a miss or any failure.
  async function piCacheGet(path) {
    if (relayCheckPromise) await relayCheckPromise;
    if (!piCacheOn()) return null;
    try {
      const r = await fetchWithTimeout(`${getRelayBase()}/api/cache/${path}`, {}, PI_CACHE_GET_TIMEOUT_MS);
      return r.ok ? await r.json() : null;
    } catch (err) {
      piCacheNetworkFailure(err);
      return null;
    }
  }

  async function piCachePut(payload) {
    if (!piCacheOn()) return false;
    try {
      const r = await fetchWithTimeout(`${getRelayBase()}/api/cache/put`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      }, PI_CACHE_PUT_TIMEOUT_MS);
      return r.ok;
    } catch (err) {
      piCacheNetworkFailure(err);
      return false;
    }
  }

  // Splits records into uploads small enough for the relay: [{ [kind]: [...] }, ...]
  function batchBySize(list, kind) {
    const batches = [];
    let current = [], size = 0;
    for (const rec of list) {
      const len = JSON.stringify(rec).length;
      if (current.length && (size + len > PI_CACHE_POST_MAX_CHARS || current.length >= PI_CACHE_POST_MAX_RECORDS)) {
        batches.push({ [kind]: current });
        current = [];
        size = 0;
      }
      current.push(rec);
      size += len;
    }
    if (current.length) batches.push({ [kind]: current });
    return batches;
  }

  // Entries go first, so a search stored on the Pi never points at an entry that isn't there yet.
  function piUploadBatches(results, entries) {
    return [...batchBySize(entries || [], "entries"), ...batchBySize(results || [], "results")];
  }

  async function pushToPi(results, entries) {
    for (const batch of piUploadBatches(results, entries)) {
      if (!(await piCachePut(batch))) return false;
    }
    return true;
  }

  // Puts records fetched from the Pi into this device's own cache.
  async function storeCacheRecords(results, entries) {
    const db = await openSearchCacheDb();
    const tx = db.transaction(["results", "entries"], "readwrite");
    (results || []).forEach(r => tx.objectStore("results").put(r));
    (entries || []).forEach(e => tx.objectStore("entries").put(e));
    await idbTxDone(tx);
  }

  // Looks for this search on the Pi and copies it here. True if something fresh arrived.
  async function pullResultFromPi(source, word) {
    const bundle = await piCacheGet(`result?key=${encodeURIComponent(searchCacheKey(source, word))}`);
    const record = bundle && bundle.record;
    if (!record || typeof record.key !== "string" || isSearchCacheStale(record.retrievedAt)) return false;
    try {
      await storeCacheRecords([record], Array.isArray(bundle.entries) ? bundle.entries : []);
      return true;
    } catch (e) {
      return false;
    }
  }

  // The same for the partial-match fallback: entries filed under this headword.
  async function pullHeadwordFromPi(source, word) {
    const key = `${source}::${normalizeHeadwordKey(word)}`;
    const bundle = await piCacheGet(`headword?key=${encodeURIComponent(key)}`);
    const entries = bundle && Array.isArray(bundle.entries)
      ? bundle.entries.filter(e => e && typeof e.key === "string") : [];
    if (!entries.length) return false;
    try {
      await storeCacheRecords([], entries);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function refreshPiCacheStatus() {
    const el = els.relayCacheStatus;
    if (!el) return;
    els.relayCacheSend.disabled = !piCacheOn();
    if (!getRelayBase() || !state.relayAvailable) { el.textContent = ""; return; }
    if (!state.relayCache) {
      el.textContent = "This relay doesn't have the shared cache yet. Update and restart it.";
      return;
    }
    const s = await piCacheGet("stats");
    el.textContent = s
      ? `Shared cache: ${s.results} search${s.results === 1 ? "" : "es"} and ${s.entries} entr${s.entries === 1 ? "y" : "ies"} on the Pi.`
      : "Couldn't read the shared cache.";
  }

  // Sends everything fresh in this device's cache to the Pi (newest copy wins there).
  async function sendCacheToPi() {
    const btn = els.relayCacheSend;
    if (!piCacheOn()) {
      alert("The Pi relay isn't reachable right now. Connect to your tailnet and try again.");
      return;
    }
    const label = btn.textContent;
    btn.disabled = true;
    try {
      const fresh = r => r && !isSearchCacheStale(r.retrievedAt);
      const entries = (await getAllEntryRecords()).filter(fresh);
      const results = (await getAllCachedSearchResults()).filter(fresh);
      if (!entries.length && !results.length) {
        alert("This device has nothing cached yet.");
        return;
      }
      const batches = piUploadBatches(results, entries);
      let done = 0;
      for (const batch of batches) {
        btn.textContent = `Sending… ${++done}/${batches.length}`;
        if (!(await piCachePut(batch))) throw new Error("the Pi didn't accept an upload. Is the relay up to date?");
      }
      alert(`Sent ${results.length} search${results.length === 1 ? "" : "es"} and ${entries.length} entr${entries.length === 1 ? "y" : "ies"} to the Pi.`);
    } catch (e) {
      alert(`Couldn't send the cache: ${e.message}`);
    } finally {
      btn.textContent = label;
      await refreshPiCacheStatus();
    }
  }

  // ---------- Search results cache (IndexedDB) ----------
  // Caches the parsed results from each of the three live dictionary
  // lookups (not the raw response — just what's needed to re-render), so
  // re-searching the same word doesn't hit the network again. A cached
  // entry older than SEARCH_CACHE_STALE_MONTHS is treated as a miss,
  // erased, and replaced by a fresh live fetch (which then gets cached
  // again). Also used for Pealim's per-verb conjugation tables (source
  // "pealim-conj", keyed by the verb's dictUrl).
  //
  // For morfix/pealim/milog, a query's result is NOT stored as one big
  // self-contained blob. It's split into individual dictionary entries
  // (each stored once, keyed by its own headword, in the "entries" store)
  // plus a small "results" record per query that just lists which entry
  // keys it returned, in order, plus whatever top-level fields aren't
  // per-entry (Morfix's corrections list, Milog's "found" flag, etc). This
  // is what lets an overlapping search — "שלום" and "שלה" both returning
  // שָׁלָה — share one copy of that entry instead of storing it twice, and
  // it's also what powers the partial-match fallback below: since every
  // entry already lives at its own headword-keyed address, a query with no
  // cache entry of its own can still look up one specific word directly.
  const SEARCH_CACHE_DB_NAME = "milon-search-cache";
  const SEARCH_CACHE_DB_VERSION = 4;
  const SEARCH_CACHE_STALE_MONTHS = 3;
  const SEARCH_CACHE_DEDUP_SOURCES = new Set(["morfix", "pealim", "milog"]);
  let searchCacheDbPromise = null;

  function openSearchCacheDb() {
    if (searchCacheDbPromise) return searchCacheDbPromise;
    searchCacheDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(SEARCH_CACHE_DB_NAME, SEARCH_CACHE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("results")) db.createObjectStore("results", { keyPath: "key" });
        // Superseded by "entries" — drop it rather than leave a second,
        // now-pointless store behind.
        if (db.objectStoreNames.contains("headwords")) db.deleteObjectStore("headwords");
        // Keyed by each entry's OWN stable identifier from its source
        // dictionary (Pealim's dictUrl, Milog's entryUrl, Morfix's id) —
        // never by headword text. Two genuinely different entries can be
        // spelled identically (a noun and a name both שָׁלוֹם) or collide
        // once nikud is stripped for matching (שָׁלוֹם vs שִׁלּוּם both
        // reduce to ש-ל-ו-ם) — keying by text would silently merge them.
        // The non-unique "headwordKey" index below is what a typed search
        // query is actually looked up by; it can point at several entries.
        let entriesStore;
        if (!db.objectStoreNames.contains("entries")) {
          entriesStore = db.createObjectStore("entries", { keyPath: "key" });
        } else {
          entriesStore = req.transaction.objectStore("entries");
        }
        if (!entriesStore.indexNames.contains("headwordKey")) {
          entriesStore.createIndex("headwordKey", "headwordKey", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return searchCacheDbPromise;
  }

  function normalizeSearchCacheQuery(word) {
    return word.trim().toLowerCase();
  }

  function searchCacheKey(source, word) {
    return `${source}::${normalizeSearchCacheQuery(word)}`;
  }

  function isSearchCacheStale(retrievedAt) {
    const retrieved = new Date(retrievedAt);
    if (isNaN(retrieved.getTime())) return true;
    const staleBefore = new Date();
    staleBefore.setMonth(staleBefore.getMonth() - SEARCH_CACHE_STALE_MONTHS);
    return retrieved.getTime() < staleBefore.getTime();
  }

  // Nikud/cantillation marks (U+0591–U+05C7) sit on top of the base
  // Hebrew letters (U+05D0–U+05EA, outside this range) — stripping them
  // lets an unvocalized typed query ("שלה") match a vocalized headword
  // ("שָׁלָה"). No-op on non-Hebrew text.
  function stripHebrewPoints(str) {
    return String(str || "").replace(/[\u0591-\u05C7]/g, "");
  }
  function normalizeHeadwordKey(str) {
    return stripHebrewPoints(str).trim().toLowerCase();
  }

  // Splits one dictionary's already-parsed result into the pieces the
  // dedup storage needs: `extra` (whatever isn't per-entry — Morfix's
  // "matched"/corrections, Milog's "found") and `items`, one per entry,
  // each carrying the headword it should be keyed by and which array it
  // belongs to (relevant only for Milog's two-array shape).
  function decomposeResult(source, result) {
    if (source === "morfix") {
      const extra = { query: result.query, matched: result.matched, corrections: result.corrections };
      const items = (result.entries || []).map(e => ({
        headword: e.senses && e.senses[0] ? e.senses[0].displayText : "",
        kind: "entry",
        data: e
      }));
      return { extra, items };
    }
    if (source === "pealim") {
      const items = (result.entries || []).map(e => ({ headword: e.headword, kind: "entry", data: e }));
      return { extra: {}, items };
    }
    if (source === "milog") {
      const extra = { query: result.query, found: result.found };
      const items = (result.wordEntries || []).map(e => ({ headword: e.headword, kind: "word", data: e }))
        .concat((result.idioms || []).map(e => ({ headword: e.headword, kind: "idiom", data: e })));
      return { extra, items };
    }
    return { extra: {}, items: [] };
  }

  // The inverse of decomposeResult: rebuilds the exact shape renderMorfix/
  // renderPealim/renderMilog expect, from a query's stored `extra` plus
  // whichever entry items were found for it.
  function recomposeResult(source, extra, items) {
    if (source === "morfix") {
      return { ...extra, entries: items.map(i => i.data) };
    }
    if (source === "pealim") {
      return { entries: items.map(i => i.data) };
    }
    if (source === "milog") {
      return {
        ...extra,
        wordEntries: items.filter(i => i.kind === "word").map(i => i.data),
        idioms: items.filter(i => i.kind === "idiom").map(i => i.data)
      };
    }
    return null;
  }

  // The one stable identifier each source itself assigns to a dictionary
  // entry — never derived from the headword text, since that's exactly
  // what two distinct entries can share (a noun and a name both spelled
  // שָׁלוֹם; שָׁלוֹם and שִׁלּוּם collide once nikud is stripped for matching).
  function entryUniqueId(source, data) {
    if (source === "morfix") return data.id || "";
    if (source === "pealim") return data.dictUrl || "";
    if (source === "milog") return data.entryUrl || "";
    return "";
  }

  async function getEntryRecord(key) {
    try {
      const db = await openSearchCacheDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("entries", "readonly");
        const req = tx.objectStore("entries").get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return null;
    }
  }

  // All entries — could be more than one — that share this source+word's
  // normalized spelling, via the non-unique "headwordKey" index. This is
  // what a typed search query is actually looked up by, since the query
  // only has text to go on, not any entry's own unique dictionary ID.
  async function getEntriesByHeadword(source, word) {
    try {
      const db = await openSearchCacheDb();
      const headwordKey = `${source}::${normalizeHeadwordKey(word)}`;
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("entries", "readonly");
        const req = tx.objectStore("entries").index("headwordKey").getAll(headwordKey);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return [];
    }
  }

  // Returns { key, source, query, retrievedAt, result } for this
  // source+word, or null on a miss — including a stale hit, which is
  // deleted first so it can't be served again. For morfix/pealim/milog,
  // `result` is reconstructed on the fly from the shared "entries" store;
  // for anything else (pealim-conj, and any pre-dedup record still sitting
  // in an existing browser's cache from before this change), the record
  // already carries its `result` inline, and is returned as-is.
  async function getCachedSearchResult(source, word) {
    const local = await getLocalCachedSearchResult(source, word);
    if (local) return local;
    // Not on this device (or stale here): the Pi may have it from another device.
    if (await pullResultFromPi(source, word)) {
      const copied = await getLocalCachedSearchResult(source, word);
      if (copied) return { ...copied, fromPi: true };
    }
    return null;
  }

  async function getLocalCachedSearchResult(source, word) {
    try {
      const db = await openSearchCacheDb();
      const key = searchCacheKey(source, word);
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction("results", "readonly");
        const req = tx.objectStore("results").get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (!record) return null;
      if (isSearchCacheStale(record.retrievedAt)) {
        await deleteCachedSearchResult(source, word);
        return null;
      }
      if (record.result !== undefined) return record;
      const items = await Promise.all((record.itemKeys || []).map(k => getEntryRecord(k)));
      const result = recomposeResult(source, record.extra || {}, items.filter(Boolean));
      return { key: record.key, source: record.source, query: record.query, retrievedAt: record.retrievedAt, result };
    } catch (e) {
      return null; // IndexedDB unavailable — just treat it as a cache miss
    }
  }

  async function putCachedSearchResult(source, word, result) {
    try {
      const db = await openSearchCacheDb();
      const retrievedAt = new Date().toISOString();

      if (!SEARCH_CACHE_DEDUP_SOURCES.has(source)) {
        const record = { key: searchCacheKey(source, word), source, query: word.trim(), result, retrievedAt };
        const tx = db.transaction("results", "readwrite");
        tx.objectStore("results").put(record);
        await idbTxDone(tx);
        pushToPi([record], []);   // shared copy; not awaited, a search never waits on the Pi
        return;
      }

      const { extra, items } = decomposeResult(source, result);
      const tx = db.transaction(["results", "entries"], "readwrite");
      const entriesStore = tx.objectStore("entries");
      const entryRecords = [];
      const itemKeys = items.map((item, idx) => {
        const uid = entryUniqueId(source, item.data);
        // An entry with no ID the source itself gave us can't be reliably
        // deduped/shared, so it's scoped to this one query instead — still
        // stored and rendered correctly, just not shared with other
        // queries or reachable by the partial-match fallback.
        const key = uid
          ? `${source}::id::${uid}`
          : `${source}::__noid::${normalizeSearchCacheQuery(word)}::${idx}`;
        const normalizedHeadword = normalizeHeadwordKey(item.headword);
        const entryRecord = {
          key, source, headword: item.headword,
          headwordKey: normalizedHeadword ? `${source}::${normalizedHeadword}` : null,
          kind: item.kind, data: item.data, retrievedAt, sourceQuery: word.trim()
        };
        entriesStore.put(entryRecord);
        entryRecords.push(entryRecord);
        return key;
      });
      const resultRecord = {
        key: searchCacheKey(source, word),
        source,
        query: word.trim(),
        retrievedAt,
        extra,
        itemKeys
      };
      tx.objectStore("results").put(resultRecord);
      await idbTxDone(tx);
      pushToPi([resultRecord], entryRecords);   // shared copy; not awaited, a search never waits on the Pi
    } catch (e) { /* ignore — caching is best-effort, not critical to a search succeeding */ }
  }

  // Removes just this one query's "results" record. Deliberately doesn't
  // touch the shared "entries" store — other still-valid queries (or the
  // partial-match fallback) may still be pointing at the same entries.
  async function deleteCachedSearchResult(source, word) {
    try {
      const db = await openSearchCacheDb();
      const tx = db.transaction("results", "readwrite");
      tx.objectStore("results").delete(searchCacheKey(source, word));
      await idbTxDone(tx);
    } catch (e) { /* ignore */ }
  }

  async function clearSearchCache() {
    const db = await openSearchCacheDb();
    const tx = db.transaction(["results", "entries"], "readwrite");
    tx.objectStore("results").clear();
    tx.objectStore("entries").clear();
    await idbTxDone(tx);
  }

  async function getAllCachedSearchResults() {
    const db = await openSearchCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("results", "readonly");
      const req = tx.objectStore("results").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllEntryRecords() {
    const db = await openSearchCacheDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("entries", "readonly");
      const req = tx.objectStore("entries").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function searchCacheCount() {
    try {
      const db = await openSearchCacheDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("results", "readonly");
        const req = tx.objectStore("results").count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return 0;
    }
  }

  async function exportSearchCache() {
    const records = await getAllCachedSearchResults();
    if (!records.length) throw new Error("No cached search results yet — search for a few words first.");
    const entries = await getAllEntryRecords().catch(() => []);
    const payload = { format: "milon-search-cache", version: 4, exportedAt: new Date().toISOString(), results: records, entries };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dictionary-search-cache-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Imports a JSON file previously produced by exportSearchCache(). Merges
  // into whatever's already cached (put() overwrites matching keys, adds
  // new ones) — stale entries among the imported records will simply be
  // treated as misses (and replaced) the next time that word is searched.
  // A "results" record from either the old (inline `result`) or new
  // (`itemKeys`/`extra`) format is accepted as-is. An older export's
  // "headwords" pointers (before entries held real data) aren't something
  // the current store can use, so they're skipped — those words just
  // won't have partial-match fallback until searched for again directly.
  async function importSearchCache(jsonText) {
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (e) {
      throw new Error("That file isn't valid JSON.");
    }
    const records = payload && Array.isArray(payload.results) ? payload.results : null;
    if (!records) throw new Error("That file doesn't look like a search cache export.");
    const valid = records
      .filter(r => r && typeof r.key === "string" && r.source &&
        (r.result !== undefined || (r.itemKeys && r.extra !== undefined)))
      .map(r => ({
        key: r.key, source: r.source, query: r.query, retrievedAt: r.retrievedAt,
        ...(r.result !== undefined ? { result: r.result } : {}),
        ...(r.itemKeys ? { itemKeys: r.itemKeys, extra: r.extra } : {})
      }));
    if (!valid.length) throw new Error("No usable cache entries found in that file.");
    const entryRecords = Array.isArray(payload.entries) ? payload.entries : [];
    const validEntries = entryRecords.filter(r => r && typeof r.key === "string" && r.source && r.data !== undefined)
      .map(({ key, source, headword, headwordKey, kind, data, retrievedAt, sourceQuery }) => ({ key, source, headword, headwordKey, kind, data, retrievedAt, sourceQuery }));
    const db = await openSearchCacheDb();
    const tx = db.transaction(["results", "entries"], "readwrite");
    const store = tx.objectStore("results");
    valid.forEach(r => store.put(r));
    const entriesStore = tx.objectStore("entries");
    validEntries.forEach(r => entriesStore.put(r));
    await idbTxDone(tx);
    return { count: valid.length };
  }

  function formatCacheDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch (e) {
      return iso;
    }
  }

  // ---------- Partial match fallback ----------
  // The cache above is keyed by the literal query text, so searching
  // "שלום" and later "שלה" would otherwise be unrelated cache entries even
  // though a Morfix/Pealim/Milog search for "שלום" already returned שָׁלָה
  // as one of its matches. Because every entry is stored once at its own
  // headword-keyed address (see decomposeResult/putCachedSearchResult
  // above), a query with no cache entry of its own can still look that one
  // word up directly — a best-effort, clearly-labeled partial answer
  // rather than nothing, used only when a live fetch has genuinely failed.
  // It never overrides a real cache hit or a successful live search,
  // including one that legitimately found nothing.
  async function tryHeadwordFallback(source, word) {
    if (!SEARCH_CACHE_DEDUP_SOURCES.has(source)) return null;
    // Deliberately ALL entries sharing this spelling, not just one — the
    // whole reason entries are keyed by their own dictionary ID rather
    // than by headword text is that more than one genuinely distinct entry
    // (a noun and a name spelled the same; two words that differ only in
    // nikud) can share a single normalized headword.
    let entries = (await getEntriesByHeadword(source, word)).filter(e => !isSearchCacheStale(e.retrievedAt));
    if (!entries.length && await pullHeadwordFromPi(source, word)) {
      entries = (await getEntriesByHeadword(source, word)).filter(e => !isSearchCacheStale(e.retrievedAt));
    }
    if (!entries.length) return null;
    // Rendering each source's result needs certain top-level fields to be
    // present and truthy (Morfix's "matched", Milog's "found") — supply
    // sensible defaults here since there's no single parent query to pull
    // them from when assembling a standalone partial result.
    const extra = source === "morfix" ? { query: word, matched: true, corrections: [] }
      : source === "milog" ? { query: word, found: true }
      : {};
    const result = recomposeResult(source, extra, entries);
    if (!result) return null;
    const newest = entries.reduce((a, b) => (new Date(b.retrievedAt) > new Date(a.retrievedAt) ? b : a));
    return { result, query: newest.sourceQuery || newest.headword, retrievedAt: newest.retrievedAt };
  }

  function parsePealimSearchHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const entries = [];

    // Hebrew-script queries render a rich list with preview forms.
    const richContainer = doc.querySelector(".results-by-verb");
    if (richContainer) {
      richContainer.querySelectorAll(":scope > .verb-search-result").forEach(div => {
        const dataDiv = div.querySelector(".verb-search-data");
        if (!dataDiv) return;

        const lemmaMenukad = dataDiv.querySelector(".verb-search-lemma .menukad");
        const headword = lemmaMenukad ? lemmaMenukad.textContent.trim() : "";

        const linkEl = dataDiv.querySelector(".verb-search-lemma a");
        let dictUrl = "";
        if (linkEl) {
          try { dictUrl = new URL(linkEl.getAttribute("href"), "https://www.pealim.com").href; } catch (e) { /* ignore */ }
        }

        const rootEl = dataDiv.querySelector(".verb-search-root a");
        const root = rootEl ? rootEl.textContent.trim() : "";

        const posEl = dataDiv.querySelector(".verb-search-binyan");
        let partOfSpeech = "";
        if (posEl) {
          const clone = posEl.cloneNode(true);
          const label = clone.querySelector(".verb-search-label");
          if (label) label.remove();
          partOfSpeech = clone.textContent.trim();
        }
        const isVerb = /^verb/i.test(partOfSpeech);

        const meaningEl = dataDiv.querySelector(".verb-search-meaning");
        const meaning = meaningEl ? meaningEl.textContent.trim() : "";

        const buttonEl = dataDiv.querySelector(".verb-search-button a");
        const buttonLabel = buttonEl ? buttonEl.textContent.trim() : "";

        const forms = [];
        div.querySelectorAll(".verb-search-forms > .vf-search-result").forEach(f => {
          const hebrewContainer = f.querySelector(".vf-search-hebrew");
          if (!hebrewContainer) return;
          const transcriptionSourceEl = hebrewContainer.querySelector(".transcription");
          // Keep the sanitized markup (e.g. the bolded stress letter),
          // not just the plain text, so it can render the same way
          // pealim.com shows it.
          const transcription = transcriptionSourceEl ? sanitizedInnerHtml(transcriptionSourceEl) : "";
          const clone = hebrewContainer.cloneNode(true);
          const transcriptionEl = clone.querySelector(".transcription");
          if (transcriptionEl) transcriptionEl.remove();
          const audioEl = clone.querySelector(".audio-play");
          if (audioEl) audioEl.remove();
          const hebrewText = clone.textContent.trim();

          const tpgnEl = f.querySelector(".vf-search-tpgn");
          forms.push({
            hebrew: hebrewText,
            transcription,
            label: tpgnEl ? tpgnEl.textContent.trim() : ""
          });
        });

        entries.push({
          headword, dictUrl, root, partOfSpeech, isVerb, meaning,
          hasFullTable: /full conjugation|all forms/i.test(buttonLabel),
          forms, tableNode: null, expanded: false
        });
      });
    }

    // English/Latin-script queries render a simpler table instead — no
    // preview forms, and the row itself (not a labeled button) links out
    // to the dict page.
    const table = doc.querySelector("table.dict-table-t");
    if (table) {
      table.querySelectorAll("tbody tr").forEach(tr => {
        const lemmaEl = tr.querySelector(".dict-lemma .menukad");
        const headword = lemmaEl ? lemmaEl.textContent.trim() : "";
        const linkEl = tr.querySelector(".dict-lemma a");
        let dictUrl = "";
        if (linkEl) {
          try { dictUrl = new URL(linkEl.getAttribute("href"), "https://www.pealim.com").href; } catch (e) { /* ignore */ }
        }

        const cells = tr.querySelectorAll("td");
        const rootEl = cells[1] ? cells[1].querySelector("a") : null;
        const root = rootEl ? rootEl.textContent.trim() : "";
        const partOfSpeech = cells[2] ? cells[2].textContent.trim() : "";
        const isVerb = /^verb/i.test(partOfSpeech);
        const meaningEl = tr.querySelector(".dict-meaning");
        const meaning = meaningEl ? meaningEl.textContent.trim() : "";

        entries.push({
          headword, dictUrl, root, partOfSpeech, isVerb, meaning,
          hasFullTable: isVerb,
          forms: [], tableNode: null, expanded: false
        });
      });
    }

    return { entries };
  }

  // Allowlist-based sanitizer: rebuilds only these tags/attributes from the
  // fetched conjugation table, dropping everything else (scripts, images,
  // links, event-handler attributes) even if a proxy tampered with the body.
  const ALLOWED_TAGS = new Set(["table", "thead", "tbody", "tr", "th", "td", "div", "span", "b", "em", "strong"]);
  const ALLOWED_ATTRS = {
    table: ["class"], thead: [], tbody: [], tr: [],
    th: ["rowspan", "colspan", "class"], td: ["rowspan", "colspan", "class"],
    div: ["class", "id"], span: ["class"], b: [], em: [], strong: []
  };

  function sanitizeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const tag = node.tagName.toLowerCase();

    // No audio in this app — drop the pronunciation icon entirely.
    if (tag === "span" && node.classList.contains("audio-play")) return null;

    // Drop the per-conjugation English gloss entirely — not just its
    // wrapper — since it's not wanted in the table at all.
    if (tag === "div" && node.classList.contains("meaning")) return null;

    // aux-forms holds a leading sentence of explanatory text (e.g. "The
    // ending is usually unstressed in spoken language:") followed by the
    // alternate form itself. Pull that sentence out into a data-tooltip
    // attribute instead of displaying it inline — CSS shows it on hover.
    if (tag === "div" && node.classList.contains("aux-forms")) {
      let noteText = "";
      const childEls = [];
      node.childNodes.forEach(child => {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent.trim();
          if (t) noteText += (noteText ? " " : "") + t;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          childEls.push(child);
        }
      });
      const wrapper = document.createElement("div");
      wrapper.className = "aux-forms";
      if (noteText) wrapper.setAttribute("data-tooltip", noteText);
      childEls.forEach(child => {
        const cleaned = sanitizeNode(child);
        if (cleaned) wrapper.appendChild(cleaned);
      });
      return wrapper;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap disallowed elements: keep their sanitized children, drop the wrapper.
      const frag = document.createDocumentFragment();
      node.childNodes.forEach(child => {
        const cleaned = sanitizeNode(child);
        if (cleaned) frag.appendChild(cleaned);
      });
      return frag;
    }

    const el = document.createElement(tag);
    for (const attr of ALLOWED_ATTRS[tag] || []) {
      if (!node.hasAttribute(attr)) continue;
      el.setAttribute(attr, node.getAttribute(attr));
    }
    node.childNodes.forEach(child => {
      const cleaned = sanitizeNode(child);
      if (cleaned) el.appendChild(cleaned);
    });
    return el;
  }

  // Returns a sanitized HTML *string* for a node's contents (reusing the
  // same allowlist as the conjugation table), so markup like the bolded
  // stress-letter <b> tag pealim.com puts inside ".transcription" survives
  // instead of being flattened to plain text.
  function sanitizedInnerHtml(node) {
    const cleaned = sanitizeNode(node);
    if (!cleaned) return "";
    if (cleaned.nodeType === Node.ELEMENT_NODE) return cleaned.innerHTML;
    const container = document.createElement("div");
    container.appendChild(cleaned);
    return container.innerHTML;
  }

  function extractConjugationTableNode(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const table = doc.querySelector("table.conjugation-table");
    if (!table) return null;
    return sanitizeNode(table);
  }

  // ---------- Verb conjugation tables: split by tense, labeled on top ----------
  // The original table packs a "verb form" label column (Present/Past/
  // Future/Imperative/Infinitive), a "person" column, and 4 data columns
  // (singular/plural × masculine/feminine) into one wide table — too wide
  // for a phone screen even when split by tense. Pealim tags every cell
  // with an id like "PERF-2ms" (past tense, 2nd person, masculine,
  // singular), so instead of reshaping the original rows, we look cells
  // up by that id and rebuild our own compact layout: two columns
  // (singular / plural), one row per person+gender combination, with the
  // Hebrew pronoun (which isn't in the data at all — Hebrew grammar keys
  // off these slots structurally) shown right next to its form.
  const PRONOUNS = {
    "1s": ["אני"], "1p": ["אנחנו"],
    "2ms": ["אתה"], "2fs": ["את"], "2mp": ["אתם"], "2fp": ["אתן"],
    "3ms": ["הוא"], "3fs": ["היא"], "3mp": ["הם"], "3fp": ["הן"], "3p": ["הם", "הן"]
  };

  function pastLikeRows(prefix) {
    return [
      { sg: `${prefix}-1s`, pl: `${prefix}-1p`, sgP: PRONOUNS["1s"], plP: PRONOUNS["1p"] },
      { sg: `${prefix}-2ms`, pl: `${prefix}-2mp`, sgP: PRONOUNS["2ms"], plP: PRONOUNS["2mp"] },
      { sg: `${prefix}-2fs`, pl: `${prefix}-2fp`, sgP: PRONOUNS["2fs"], plP: PRONOUNS["2fp"] },
      { sg: `${prefix}-3ms`, pl: `${prefix}-3p`, sgP: PRONOUNS["3ms"], plP: [PRONOUNS["3p"][0]] },
      { sg: `${prefix}-3fs`, pl: `${prefix}-3p`, sgP: PRONOUNS["3fs"], plP: [PRONOUNS["3p"][1]] }
    ];
  }
  function futureLikeRows(prefix) {
    return [
      { sg: `${prefix}-1s`, pl: `${prefix}-1p`, sgP: PRONOUNS["1s"], plP: PRONOUNS["1p"] },
      { sg: `${prefix}-2ms`, pl: `${prefix}-2mp`, sgP: PRONOUNS["2ms"], plP: PRONOUNS["2mp"] },
      { sg: `${prefix}-2fs`, pl: `${prefix}-2fp`, sgP: PRONOUNS["2fs"], plP: PRONOUNS["2fp"] },
      { sg: `${prefix}-3ms`, pl: `${prefix}-3mp`, sgP: PRONOUNS["3ms"], plP: PRONOUNS["3mp"] },
      { sg: `${prefix}-3fs`, pl: `${prefix}-3fp`, sgP: PRONOUNS["3fs"], plP: PRONOUNS["3fp"] }
    ];
  }

  function presentLikeRows(prefix) {
    return [
      { sg: `${prefix}-ms`, pl: `${prefix}-mp`, sgP: ["אני", "אתה", "הוא"], plP: ["אנחנו", "אתם", "הם"] },
      { sg: `${prefix}-fs`, pl: `${prefix}-fp`, sgP: ["אני", "את", "היא"], plP: ["אנחנו", "אתן", "הן"] }
    ];
  }

  const VERB_TABLE_CONFIGS = [
    { heading: "Present tense", rows: presentLikeRows("AP") },
    { heading: "Past tense", rows: pastLikeRows("PERF") },
    { heading: "Future tense", rows: futureLikeRows("IMPF") },
    { heading: "Imperative", rows: [
        { sg: "IMP-2ms", pl: "IMP-2mp", sgP: ["(to a man)"], plP: ["(to men)"] },
        { sg: "IMP-2fs", pl: "IMP-2fp", sgP: ["(to a woman)"], plP: ["(to women)"] }
    ]},
    { heading: "Present tense (passive)", rows: presentLikeRows("passive-AP") },
    { heading: "Past tense (passive)", rows: pastLikeRows("passive-PERF") },
    { heading: "Future tense (passive)", rows: futureLikeRows("passive-IMPF") }
  ];

  function extractCellsById(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    // Passive forms sit in a *second* conjugation-table element, separate
    // from the active one — querySelector alone would silently miss it.
    const tables = doc.querySelectorAll("table.conjugation-table");
    if (!tables.length) return null;
    const cellsById = {};
    tables.forEach(table => {
      table.querySelectorAll("td.conj-td > div[id]").forEach(div => {
        cellsById[div.id] = div;
      });
    });
    return cellsById;
  }

  // Renders a single conjugation cell's content from either a live DOM node
  // (fetched fresh from pealim.com, sanitized against an allowlist) or a
  // {html: "..."} object pulled from the search-results cache
  // (already-sanitized markup, see serializeCellsById below). Both are used
  // interchangeably by buildPairCell/buildVerbTablesNode so the same
  // rendering code works regardless of where a verb's table data came from.
  function renderFormCell(raw) {
    if (!raw) return null;
    if (raw.nodeType === Node.ELEMENT_NODE) return sanitizeNode(raw);
    if (typeof raw.html === "string") return parseHtmlFragmentToNode(raw.html);
    return null;
  }

  // Turns a stored HTML fragment (already run through sanitizeNode when it
  // was cached, so this never executes scripts) back into a live DOM node.
  function parseHtmlFragmentToNode(html) {
    const tmp = document.createElement("template");
    tmp.innerHTML = html;
    return tmp.content.firstElementChild ? tmp.content.firstElementChild.cloneNode(true) : null;
  }

  // Converts a live cellsById map (raw, not-yet-sanitized DOM divs, as
  // returned by extractCellsById) into a plain, IndexedDB-storable object —
  // sanitized once up front so nothing unsafe ever reaches the cache.
  function serializeCellsById(cellsById) {
    const out = {};
    Object.keys(cellsById).forEach(id => {
      const sanitized = sanitizeNode(cellsById[id]);
      if (sanitized && sanitized.nodeType === Node.ELEMENT_NODE) out[id] = { html: sanitized.outerHTML };
    });
    return out;
  }

  function buildPairCell(id, pronouns, cellsById) {
    const td = document.createElement("td");
    td.className = "conj-pair-td";

    const pronounWrap = document.createElement("div");
    pronounWrap.className = "conj-pronoun";
    pronouns.forEach(p => {
      const line = document.createElement("div");
      line.textContent = p;
      pronounWrap.appendChild(line);
    });
    td.appendChild(pronounWrap);

    const sanitized = renderFormCell(cellsById[id]);
    if (sanitized) td.appendChild(sanitized);
    return td;
  }

  function buildVerbTablesNode(cellsById) {
    const container = document.createElement("div");

    VERB_TABLE_CONFIGS.forEach(cfg => {
      const rowsToRender = cfg.rows.filter(r => cellsById[r.sg] || cellsById[r.pl]);
      if (!rowsToRender.length) return;

      const heading = document.createElement("div");
      heading.className = "conj-group-heading";
      heading.textContent = cfg.heading;
      container.appendChild(heading);

      const table = document.createElement("table");
      table.className = "conj-pair-table";
      const tbody = document.createElement("tbody");

      rowsToRender.forEach(r => {
        const tr = document.createElement("tr");
        // dir="rtl" on the table means the first cell appended lands on
        // the right visually — singular first, so it reads right-to-left
        // the way the rest of the page does.
        tr.appendChild(buildPairCell(r.sg, r.sgP, cellsById));
        tr.appendChild(buildPairCell(r.pl, r.plP, cellsById));
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      container.appendChild(table);
    });

    if (cellsById["INF-L"]) {
      const heading = document.createElement("div");
      heading.className = "conj-group-heading";
      heading.textContent = "Infinitive";
      container.appendChild(heading);
      const wrap = document.createElement("div");
      wrap.className = "conj-infinitive-wrap";
      const sanitized = renderFormCell(cellsById["INF-L"]);
      if (sanitized) wrap.appendChild(sanitized);
      container.appendChild(wrap);
    }

    return container.children.length ? container : null;
  }

  function pealimEntryCardHtml(entry, index) {
    const formsHtml = entry.forms.length ? `<ul class="pealim-forms-list">${entry.forms.map(f => `
      <li>
        <div dir="rtl">
          <span class="pealim-form-hebrew">${escapeHtml(f.hebrew)}</span>
          ${f.transcription ? `<span class="pealim-form-transcription">${f.transcription}</span>` : ""}
        </div>
        ${f.label ? `<span class="pealim-form-label">${escapeHtml(f.label)}</span>` : ""}
      </li>`).join("")}</ul>` : "";

    return `

      <div class="entry-card">
        <div class="entry-tab">${entry.isVerb ? "VERB" : "WORD"}</div>
        <div class="entry-body">
          <div class="headword-row" dir="rtl">
            <span class="headword">${escapeHtml(entry.headword)}</span>
            ${entry.partOfSpeech ? `<span class="pos-tag">${escapeHtml(entry.partOfSpeech)}</span>` : ""}
          </div>
          ${entry.root ? `<div class="pealim-root">Root: ${escapeHtml(entry.root)}</div>` : ""}
          ${entry.meaning ? `<div class="sense-def" dir="ltr">${escapeHtml(entry.meaning)}</div>` : ""}
          ${formsHtml}
          ${entry.dictUrl ? `<button type="button" class="conj-toggle-btn" data-index="${index}">${entry.hasFullTable ? "View full conjugation" : "View all forms"}</button>
          <div class="conj-table-wrap" data-index="${index}" hidden></div>` : ""}
        </div>
      </div>`;
  }

  function renderPealim(result) {
    setTabCount("pealim", result.entries.length);
    if (result.entries.length) {
      els.resultsPealim.innerHTML = result.entries.map((e, i) => pealimEntryCardHtml(e, i)).join("");
    } else {
      els.resultsPealim.innerHTML = `<div class="empty-state">No results.</div>`;
    }
  }

  // aux-forms tooltip: a real fixed-position element (not a CSS ::after)
  // so it can be positioned by actual viewport space rather than being
  // trapped and clipped inside the table's scrolling container.
  function showAuxTooltip(target) {
    const text = target.getAttribute("data-tooltip");
    if (!text) return;
    els.hoverTooltip.textContent = text;
    els.hoverTooltip.hidden = false;

    const margin = 8;
    const rect = target.getBoundingClientRect();
    const tw = els.hoverTooltip.offsetWidth;
    const th = els.hoverTooltip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer below the target; flip above if there isn't room.
    let top = rect.bottom + margin;
    if (top + th > vh - margin) {
      const above = rect.top - th - margin;
      top = above >= margin ? above : margin;
    }

    // Center horizontally on the target, then clamp within the viewport
    // so it never gets cut off against the left/right edges.
    let left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(margin, Math.min(left, vw - tw - margin));

    els.hoverTooltip.style.top = `${top}px`;
    els.hoverTooltip.style.left = `${left}px`;
  }

  function hideAuxTooltip() {
    els.hoverTooltip.hidden = true;
  }

  els.resultsPealim.addEventListener("mouseover", e => {
    const target = e.target.closest(".aux-forms[data-tooltip]");
    if (target) showAuxTooltip(target);
  });
  els.resultsPealim.addEventListener("mouseout", e => {
    const target = e.target.closest(".aux-forms[data-tooltip]");
    if (target && !target.contains(e.relatedTarget)) hideAuxTooltip();
  });
  // Scrolling the results column moves the target under a fixed-position
  // tooltip without firing mouseout, so just hide it defensively.
  document.addEventListener("scroll", hideAuxTooltip, true);

  els.resultsPealim.addEventListener("click", async e => {
    const btn = e.target.closest(".conj-toggle-btn");
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    const entry = state.pealim.lastResult && state.pealim.lastResult.entries[idx];
    if (!entry) return;
    const wrap = els.resultsPealim.querySelector(`.conj-table-wrap[data-index="${idx}"]`);

    if (entry.expanded) {
      entry.expanded = false;
      wrap.hidden = true;
      btn.textContent = entry.hasFullTable ? "View full conjugation" : "View all forms";
      return;
    }

    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Loading…";
    let cacheNote = null;
    try {
      if (!entry.tableNode) {
        if (entry.dictUrl) {
          const cached = await getCachedSearchResult("pealim-conj", entry.dictUrl);
          if (cached) {
            if (cached.result.kind === "verb") entry.tableNode = buildVerbTablesNode(cached.result.cells);
            else if (cached.result.kind === "table") entry.tableNode = parseHtmlFragmentToNode(cached.result.html);
            else entry.tableNode = null;
            cacheNote = `cached · retrieved ${formatCacheDate(cached.retrievedAt)}${cached.fromPi ? " · from your Pi" : ""}`;
          } else {
            const { html } = await fetchPealimPage(entry.dictUrl);
            state.pealim.lastRawHtml = html;
            els.viewRawPealim.hidden = false;
            if (entry.isVerb) {
              const cellsById = extractCellsById(html);
              entry.tableNode = cellsById ? buildVerbTablesNode(cellsById) : null;
              await putCachedSearchResult("pealim-conj", entry.dictUrl,
                cellsById ? { kind: "verb", cells: serializeCellsById(cellsById) } : { kind: "none" });
            } else {
              const tableNode = extractConjugationTableNode(html);
              entry.tableNode = tableNode;
              await putCachedSearchResult("pealim-conj", entry.dictUrl,
                tableNode ? { kind: "table", html: tableNode.outerHTML } : { kind: "none" });
            }
          }
        }
      }
      wrap.innerHTML = "";
      if (entry.tableNode) {
        wrap.appendChild(entry.tableNode.cloneNode(true));
        if (cacheNote) {
          const note = document.createElement("div");
          note.className = "conj-cache-note";
          note.textContent = cacheNote;
          wrap.insertBefore(note, wrap.firstChild);
        }
      } else {
        wrap.textContent = "Couldn't find a conjugation table on that page.";
      }
      wrap.hidden = false;
      entry.expanded = true;
      btn.textContent = "Hide";
    } catch (err) {
      wrap.textContent = err.message;
      wrap.hidden = false;
    } finally {
      btn.disabled = false;
      if (btn.textContent === "Loading…") btn.textContent = originalLabel;
    }
  });

  async function doPealimSearch(word, { forceRefresh = false } = {}) {
    setTabCount("pealim", 0);
    els.statusPealim.textContent = "Searching…";
    els.statusPealim.classList.remove("error");
    els.refreshPealim.hidden = true;

    if (!forceRefresh) {
      const cached = await getCachedSearchResult("pealim", word);
      if (cached) {
        state.pealim.lastRawHtml = null;
        state.pealim.lastResult = cached.result;
        els.viewRawPealim.hidden = true;
        renderPealim(cached.result);
        els.statusPealim.textContent = `cached · retrieved ${formatCacheDate(cached.retrievedAt)}${cached.fromPi ? " · from your Pi" : ""}`;
        els.refreshPealim.hidden = false;
        return;
      }
    }

    try {
      const url = `https://www.pealim.com/search/?q=${encodeURIComponent(word)}`;
      const { html, via } = await fetchPealimPage(url);
      state.pealim.lastRawHtml = html;
      els.viewRawPealim.hidden = false;
      const result = parsePealimSearchHtml(html);
      state.pealim.lastResult = result;
      renderPealim(result);
      els.statusPealim.textContent = `via ${via}`;
      await putCachedSearchResult("pealim", word, result);
    } catch (err) {
      const fallback = await tryHeadwordFallback("pealim", word);
      if (fallback) {
        state.pealim.lastRawHtml = null;
        state.pealim.lastResult = fallback.result;
        els.viewRawPealim.hidden = true;
        renderPealim(fallback.result);
        els.statusPealim.textContent = `partial match from cached "${fallback.query}" search · retrieved ${formatCacheDate(fallback.retrievedAt)}`;
        els.refreshPealim.hidden = false;
        return;
      }
      els.statusPealim.textContent = err.message;
      els.statusPealim.classList.add("error");
    }
  }

  // ---------- Milog ----------
  // Parser verified against a real fetch of https://milog.co.il/שלום. Every
  // entry (word-sense AND idiom alike) lives in a <div class="sr_e">. The
  // headword link is <a class="sr_e_t">; word-sense entries have the POS/root
  // info as a nested <span> INSIDE that same anchor (idioms don't — that's
  // the reliable classifier). Each numbered sense is a ".sr_e_para" with
  // ".sr_e_index" (the "1."), ".sr_e_txt" (definition, with nested
  // ".sr_example" spans for quoted examples), and optional ".sr_e_trans"
  // links for English glosses. The results count lives in ".sr_below_text".
  // NOTE: this was only checked against a noun search page (שלום) — verbs,
  // the entry-detail page (parseMilogEntryHtml below), and the no-results
  // case are still unverified guesses. Use "View raw response" to check
  // those and adjust as needed.

  async function fetchMilogPage(url) {
    const { data, via } = await fetchWithCorsFallback(url, {
      headers: {},
      parseAndValidate: async resp => {
        const text = await resp.text();
        return /מילוג|milog/i.test(text) ? text : null;
      }
    });
    return { html: data, via };
  }

  function parseMilogSearchHtml(html, query) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    const countLine = doc.querySelector(".sr_below_text");
    const noResults = !countLine || /לא\s*(התקבלו|נמצאו)/.test(countLine.textContent);

    const wordEntries = [];
    const idioms = [];

    doc.querySelectorAll(".sr_e").forEach(entryEl => {
      const titleAnchor = entryEl.querySelector("a.sr_e_t");
      if (!titleAnchor) return;

      let entryUrl = "";
      try { entryUrl = new URL(titleAnchor.getAttribute("href"), "https://milog.co.il").href; } catch (e) { /* ignore */ }

      // The POS/root/binyan span sits inside the anchor for word entries;
      // idioms have plain text with no nested span at all. Verbs pack both
      // root ("שורש: הל\"כ") and binyan ("בניין: פעל") into the same span
      // as the POS, comma-separated — split both out so the POS badge just
      // shows the part of speech and the grammar line shows root + binyan.
      const posSpan = titleAnchor.querySelector("span");
      let headword = titleAnchor.textContent.trim();
      let posTag = "";
      let grammarLine = "";

      if (posSpan) {
        const fullPos = posSpan.textContent.trim();
        headword = headword.replace(posSpan.textContent, "").replace(/[-–]\s*$/, "").trim();
        const rootMatch = fullPos.match(/שורש:\s*[^\s,]+/);
        const binyanMatch = fullPos.match(/בניין:\s*[^\s,]+/);
        grammarLine = [rootMatch ? rootMatch[0] : "", binyanMatch ? binyanMatch[0] : ""].filter(Boolean).join(" · ");
        posTag = fullPos
          .replace(/,?\s*שורש:\s*[^\s,]+/, "")
          .replace(/,?\s*בניין:\s*[^\s,]+/, "")
          .trim();
      }

      const paras = Array.from(entryEl.querySelectorAll(".sr_e_para"));

      const buildDef = p => {
        const txtEl = p.querySelector(".sr_e_txt");
        if (!txtEl) return null;
        const clone = txtEl.cloneNode(true);
        const examples = Array.from(clone.querySelectorAll(".sr_example")).map(ex => ex.textContent.trim());
        clone.querySelectorAll(".sr_example").forEach(ex => ex.remove());
        const text = clone.textContent.trim();
        const glosses = Array.from(p.querySelectorAll(".sr_e_trans a")).map(a => a.textContent.trim());
        return { text, examples, glosses };
      };

      if (posSpan) {
        const definitions = paras.map(buildDef).filter(Boolean);

        // The search-results page truncates entries with many senses, e.g.
        // "ראו 4 פירושים נוספים" ("see 4 more definitions") linking back to
        // this same entry's own page. Surface that as a hint rather than
        // silently showing an incomplete list.
        const showMoreLink = entryEl.querySelector(".sr_show_more");
        const moreMatch = showMoreLink ? showMoreLink.textContent.match(/\d+/) : null;

        wordEntries.push({
          headword,
          entryUrl,
          posTag,
          grammarLine,
          definitions,
          hasMore: !!showMoreLink,
          moreCount: moreMatch ? parseInt(moreMatch[0], 10) : 0,
          expandData: null
        });
      } else {
        // Idioms can have multiple numbered sub-senses of their own (e.g.
        // "הוֹלֵךְ ופוחת" = both "diminishing" AND "morally declining"),
        // same .sr_e_para/.sr_e_index structure as a word entry's senses —
        // collect all of them, not just the first.
        const subDefs = paras.map(buildDef).filter(Boolean);
        idioms.push({ headword, entryUrl, subDefs });
      }
    });

    return { query, found: !noResults && (wordEntries.length > 0 || idioms.length > 0), wordEntries, idioms };
  }

  // Parses an individual entry page (milog.co.il/word/e_####). Verified
  // against a real fetch of https://milog.co.il/שלום/e_2839. Every section
  // (definitions/synonyms/idioms/grammar) is a <div class="ent_area">, and
  // which section it is can be told apart by the URL suffix on its heading
  // link: bare "/e_####" = definitions, "/נרדפות" = synonyms, "/ביטויים" =
  // idioms, "/דקדוק" = grammar. All sections share the same
  // .ent_para/.ent_para_index/.ent_para_text markup. Milog's "show more"
  // idioms (wrapped in .ent_hidden, revealed on click in the real site) are
  // still present in the raw HTML — just CSS-hidden — so querySelectorAll
  // picks them up too; a single fetch really does get everything.
  // NOTE: no "antonyms" section was observed for שלום — that part of the
  // original mockup design was speculative and isn't implemented here.
  function parseMilogEntryHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    let definitions = [];
    const synonyms = [];
    const idioms = [];
    const grammar = [];

    doc.querySelectorAll(".ent_area").forEach(areaEl => {
      const titleLink = areaEl.querySelector(".ent_bar_title a");
      const href = titleLink ? (titleLink.getAttribute("href") || "") : "";
      let kind = "definitions";
      if (/\/נרדפות(\/|\?|$)/.test(href)) kind = "synonyms";
      else if (/\/ביטויים(\/|\?|$)/.test(href)) kind = "idioms";
      else if (/\/דקדוק(\/|\?|$)/.test(href)) kind = "grammar";

      const paras = Array.from(areaEl.querySelectorAll(".ent_para"));

      if (kind === "definitions") {
        definitions = paras.map(p => {
          const txtEl = p.querySelector(".ent_para_text");
          if (!txtEl) return null;
          const clone = txtEl.cloneNode(true);
          const examples = Array.from(clone.querySelectorAll(".ent_example")).map(ex => ex.textContent.trim());
          clone.querySelectorAll(".ent_example").forEach(ex => ex.remove());
          return { text: clone.textContent.trim(), examples };
        }).filter(Boolean);
      } else if (kind === "synonyms") {
        paras.forEach(p => {
          const idxEl = p.querySelector(".ent_para_index");
          const txtEl = p.querySelector(".ent_para_text");
          if (!txtEl || !txtEl.textContent.trim()) return;
          synonyms.push({ senseNum: idxEl ? idxEl.textContent.trim() : "", text: txtEl.textContent.trim() });
        });
      } else if (kind === "idioms") {
        paras.forEach(p => {
          const titleA = p.querySelector(".ent_para_title a");
          const txtEl = p.querySelector(".ent_para_text");
          if (!titleA || !txtEl) return;
          let entryUrl = "";
          try { entryUrl = new URL(titleA.getAttribute("href"), "https://milog.co.il").href; } catch (e) { /* ignore */ }
          const headword = titleA.textContent.trim();
          const definition = txtEl.textContent.trim().replace(headword, "").replace(/^\s*[-–]\s*/, "").trim();
          idioms.push({ headword, entryUrl, definition });
        });
      } else if (kind === "grammar") {
        paras.forEach(p => {
          const titleEl = p.querySelector(".ent_para_title");
          const txtEl = p.querySelector(".ent_para_text");
          if (!txtEl) return;
          const label = titleEl ? titleEl.textContent.trim() : "";
          // Grammar rows are either plain text ("מין - זכר") or a
          // comma-separated list of linked inflected forms, where each
          // link's title attribute holds a plain-language gloss of that
          // form (e.g. title="רבים" for the plural, title="השלום שלו" for
          // "his peace").
          const forms = Array.from(txtEl.querySelectorAll("a.in_link")).map(a => ({
            text: a.textContent.trim(),
            gloss: a.getAttribute("title") || ""
          }));
          let value = "";
          if (!forms.length) {
            const clone = txtEl.cloneNode(true);
            const t = clone.querySelector(".ent_para_title");
            if (t) t.remove();
            value = clone.textContent.trim().replace(/^\s*[-–]\s*/, "").trim();
          }
          grammar.push({ label, value, forms });
        });
      }
    });

    return { definitions, synonyms, idioms, grammar };
  }

  function milogIdiomsGridHtml(idioms) {
    if (!idioms.length) return "";
    return `
      <div class="milog-idiom-block" dir="rtl">
        <div class="section-label">Idioms &amp; expressions &middot; tap to search</div>
        <ul class="milog-idiom-list">
          ${idioms.map(idiom => `
            <li data-word="${escapeHtml(idiom.headword)}">
              <span class="milog-phrase-head">${escapeHtml(idiom.headword)}</span>
              ${idiom.subDefs.length > 1
                ? idiom.subDefs.map((d, i) => `<span class="milog-phrase-def">${i + 1}. ${escapeHtml(d.text)}</span>`).join("")
                : (idiom.subDefs[0] ? `<span class="milog-phrase-def">${escapeHtml(idiom.subDefs[0].text)}</span>` : "")}
            </li>`).join("")}
        </ul>
      </div>`;
  }

  function milogExpandPanelHtml() {
    return `<div class="milog-expand-panel" dir="rtl"><div class="milog-expand-loading">Loading…</div></div>`;
  }

  function milogDefinitionListHtml(definitions) {
    if (!definitions.length) return `<div class="empty-state" style="padding:20px;">No definitions parsed from this entry.</div>`;
    return `
      <ul class="sense-list" dir="rtl">
        ${definitions.map(d => `
          <li>
            <span class="sense-display">${escapeHtml(d.text)}</span>
            ${d.examples.length ? `<span class="sense-def">${d.examples.map(escapeHtml).join(" · ")}</span>` : ""}
            ${d.glosses.length ? `<ul class="gloss-sublist">${d.glosses.map(g => `<li class="sense-gloss">${escapeHtml(g)}</li>`).join("")}</ul>` : ""}
          </li>`).join("")}
      </ul>`;
  }

  function milogWordEntryCardHtml(entry, index) {
    return `
      <div class="entry-card" data-milog-index="${index}">
        <div class="entry-tab">MILOG</div>
        <div class="entry-body">
          <div class="headword-row milog-expandable" data-expand-index="${index}" dir="rtl">
            <span class="headword">${escapeHtml(entry.headword)}</span>
            ${entry.posTag ? `<span class="pos-tag">${escapeHtml(entry.posTag)}</span>` : ""}
            <span class="milog-expand-hint">tap for more</span>
            <span class="milog-expand-chevron">▾</span>
          </div>
          ${entry.grammarLine ? `<div class="milog-root" dir="rtl">${escapeHtml(entry.grammarLine)}</div>` : ""}
          ${milogDefinitionListHtml(entry.definitions)}
          ${entry.hasMore ? `<div class="milog-expand-hint" style="margin-top:8px; text-transform:none; font-size:0.78rem;">+${entry.moreCount} more definitions — tap headword for the full entry</div>` : ""}
          ${milogExpandPanelHtml()}
        </div>
      </div>`;
  }

  function milogGrammarRowHtml(g, rowIndex) {
    if (!g.forms.length) {
      return `<div class="milog-grammar-plain-row" dir="rtl"><span class="milog-conj-tense-label">${escapeHtml(g.label)}</span><span>${escapeHtml(g.value)}</span></div>`;
    }
    const truncateAt = 6;
    const shown = g.forms.slice(0, truncateAt);
    const rest = g.forms.slice(truncateAt);
    const formChip = f => `<span class="milog-conj-form">${escapeHtml(f.text)}${f.gloss ? `<span class="milog-person-tag">${escapeHtml(f.gloss)}</span>` : ""}</span>`;
    return `
      <div class="milog-conj-group" dir="rtl">
        <div class="milog-conj-tense-label">${escapeHtml(g.label)}</div>
        <div class="milog-conj-forms-row">
          ${shown.map(formChip).join("")}
          ${rest.length ? `<span class="milog-collapsed-forms" data-row="${rowIndex}">${rest.map(formChip).join("")}</span>` : ""}
        </div>
        ${rest.length ? `<button type="button" class="milog-show-all-btn" data-toggle-row="${rowIndex}">show all ${g.forms.length}</button>` : ""}
      </div>`;
  }

  function renderMilog(result) {
    setTabCount("milog", result.found ? result.wordEntries.length : 0);
    if (!result.found) {
      els.resultsMilog.innerHTML = `<div class="empty-state">No results for "${escapeHtml(result.query)}".</div>`;
      return;
    }
    const cards = result.wordEntries.map((entry, i) => milogWordEntryCardHtml(entry, i)).join("");
    const idiomsHtml = milogIdiomsGridHtml(result.idioms);
    els.resultsMilog.innerHTML = cards + idiomsHtml || `<div class="empty-state">No results for "${escapeHtml(result.query)}".</div>`;

    // Idiom rows re-run a fresh search, matching the mockup's tap-to-search behavior.
    els.resultsMilog.querySelectorAll(".milog-idiom-list li[data-word]").forEach(li => {
      li.addEventListener("click", () => {
        els.input.value = li.dataset.word;
        doSearch(li.dataset.word);
      });
    });

    // Click-to-expand: fetches the entry's own page (grammar/synonyms/full
    // idiom list) on first click, then just toggles open/closed after that.
    els.resultsMilog.querySelectorAll(".headword-row.milog-expandable").forEach(row => {
      row.addEventListener("click", async () => {
        const idx = Number(row.dataset.expandIndex);
        const entry = result.wordEntries[idx];
        const card = row.closest(".entry-card");
        const panel = card.querySelector(".milog-expand-panel");
        const chevron = row.querySelector(".milog-expand-chevron");
        const nowOpen = !panel.classList.contains("open");
        panel.classList.toggle("open", nowOpen);
        chevron.classList.toggle("open", nowOpen);
        if (!nowOpen || entry.expandData || !entry.entryUrl) return;
        panel.innerHTML = `<div class="milog-expand-loading">Loading…</div>`;
        try {
          const { html } = await fetchMilogPage(entry.entryUrl);
          const parsed = parseMilogEntryHtml(html);
          entry.expandData = parsed;
          panel.innerHTML = `
            ${entry.hasMore && parsed.definitions.length ? `
            <div class="milog-subsection">
              <div class="section-label">All definitions (${parsed.definitions.length})</div>
              ${milogDefinitionListHtml(parsed.definitions)}
            </div>` : ""}
            ${parsed.grammar.length ? `
            <div class="milog-subsection">
              <div class="section-label">Grammar</div>
              ${parsed.grammar.map((g, i) => milogGrammarRowHtml(g, i)).join("")}
            </div>` : ""}
            ${parsed.synonyms.length ? `
            <div class="milog-subsection">
              <div class="section-label">Synonyms (by sense)</div>
              ${parsed.synonyms.map(s => `<div class="milog-synonym-row">${s.senseNum ? `<span class="milog-synonym-sense-num">${escapeHtml(s.senseNum)}</span>` : ""}${escapeHtml(s.text)}</div>`).join("")}
            </div>` : ""}
            ${parsed.idioms.length ? `
            <div class="milog-subsection">
              <div class="section-label">All expressions (${parsed.idioms.length}) &middot; tap to search</div>
              <div class="milog-full-phrase-grid">
                ${parsed.idioms.map(idm => `<span class="chip" data-word="${escapeHtml(idm.headword)}">${escapeHtml(idm.headword)}</span>`).join("")}
              </div>
            </div>` : ""}
            ${!parsed.grammar.length && !parsed.synonyms.length && !parsed.idioms.length ? `<div class="milog-expand-error">Couldn't parse anything useful from this entry page — try "View raw response" and adjust the parser.</div>` : ""}
          `;
          panel.querySelectorAll("[data-toggle-row]").forEach(btn => {
            if (!btn.dataset.label) btn.dataset.label = btn.textContent;
            btn.addEventListener("click", e => {
              e.stopPropagation();
              const rowSpan = panel.querySelector(`.milog-collapsed-forms[data-row="${btn.dataset.toggleRow}"]`);
              const nowOpen = rowSpan.classList.toggle("open");
              btn.textContent = nowOpen ? "show less" : btn.dataset.label;
            });
          });
          panel.querySelectorAll(".chip[data-word]").forEach(chip => {
            chip.addEventListener("click", e => {
              e.stopPropagation();
              els.input.value = chip.dataset.word;
              doSearch(chip.dataset.word);
            });
          });
        } catch (err) {
          panel.innerHTML = `<div class="milog-expand-error">${escapeHtml(err.message)}</div>`;
        }
      });
    });
  }

  async function doMilogSearch(word, { forceRefresh = false } = {}) {
    setTabCount("milog", 0);
    els.statusMilog.textContent = "Searching…";
    els.statusMilog.classList.remove("error");
    els.refreshMilog.hidden = true;

    if (!forceRefresh) {
      const cached = await getCachedSearchResult("milog", word);
      if (cached) {
        state.milog.lastRawHtml = null;
        state.milog.lastResult = cached.result;
        els.viewRawMilog.hidden = true;
        renderMilog(cached.result);
        els.statusMilog.textContent = `cached · retrieved ${formatCacheDate(cached.retrievedAt)}${cached.fromPi ? " · from your Pi" : ""}`;
        els.refreshMilog.hidden = false;
        return;
      }
    }

    try {
      const url = `https://milog.co.il/${encodeURIComponent(word)}`;
      const { html, via } = await fetchMilogPage(url);
      state.milog.lastRawHtml = html;
      els.viewRawMilog.hidden = false;
      const result = parseMilogSearchHtml(html, word);
      state.milog.lastResult = result;
      renderMilog(result);
      els.statusMilog.textContent = `via ${via}`;
      await putCachedSearchResult("milog", word, result);
    } catch (err) {
      const fallback = await tryHeadwordFallback("milog", word);
      if (fallback) {
        state.milog.lastRawHtml = null;
        state.milog.lastResult = fallback.result;
        els.viewRawMilog.hidden = true;
        renderMilog(fallback.result);
        els.statusMilog.textContent = `partial match from cached "${fallback.query}" search · retrieved ${formatCacheDate(fallback.retrievedAt)}`;
        els.refreshMilog.hidden = false;
        return;
      }
      els.statusMilog.textContent = err.message;
      els.statusMilog.classList.add("error");
    }
  }

  // Milog's search only works reliably for Hebrew terms — English queries
  // reliably error out (not just return no results), so skip the call
  // entirely rather than let it fail every time.
  function hasLatinLetters(str) {
    return /[a-zA-Z]/.test(str);
  }

  // ---------- Search orchestration ----------
  async function doSearch(word) {
    word = word.trim();
    if (!word) {
      resetMorfixColumn();
      resetPealimColumn();
      resetMilogColumn();
      return;
    }
    els.goButton.disabled = true;
    const tasks = [];
    if (state.enabled.morfix) tasks.push(doMorfixSearch(word));
    if (state.enabled.pealim) tasks.push(doPealimSearch(word));
    if (state.enabled.milog) {
      if (hasLatinLetters(word)) {
        resetMilogColumn();
        els.statusMilog.textContent = "Milog only searches Hebrew terms — skipped for this query.";
      } else {
        tasks.push(doMilogSearch(word));
      }
    }
    await Promise.allSettled(tasks);
    els.goButton.disabled = false;
  }

  // ---------- English-keyboard -> Hebrew (Israeli SI-1452 layout) ----------
  const HEB_KEYMAP = {
    q: "/", w: "'", e: "ק", r: "ר", t: "א", y: "ט", u: "ו", i: "ן", o: "ם", p: "פ",
    a: "ש", s: "ד", d: "ג", f: "כ", g: "ע", h: "י", j: "ח", k: "ל", l: "ך", ";": "ף", "'": ",",
    z: "ז", x: "ס", c: "ב", v: "ה", b: "נ", n: "מ", m: "צ", ",": "ת", ".": "ץ", "/": ".",
    "`": ";"
  };
  const kbToggle = document.getElementById("kb-toggle");
  let hebrewTyping = false;
  try { hebrewTyping = localStorage.getItem("hebrewTyping") === "1"; } catch (e) {}

  function renderKbToggle() {
    kbToggle.textContent = hebrewTyping ? "עב" : "EN";
    kbToggle.setAttribute("aria-pressed", String(hebrewTyping));
    kbToggle.title = hebrewTyping
      ? "Typing Hebrew from an English keyboard — click or type ~ to switch off"
      : "Type Hebrew on an English keyboard (Israeli layout) — click or type ~ to switch on";
  }
  renderKbToggle();

  function toggleHebrewTyping() {
    hebrewTyping = !hebrewTyping;
    try { localStorage.setItem("hebrewTyping", hebrewTyping ? "1" : "0"); } catch (e) {}
    renderKbToggle();
  }

  kbToggle.addEventListener("click", () => {
    toggleHebrewTyping();
    els.input.focus();
  });

  function toHebrewKeys(text) {
    return Array.from(text).map(ch => HEB_KEYMAP[ch.toLowerCase()] ?? ch).join("");
  }

  els.input.addEventListener("beforeinput", e => {
    // "~" (Shift + backtick) flips between English and Hebrew typing; the character itself is not inserted
    if (e.inputType === "insertText" && e.data === "~") {
      e.preventDefault();
      toggleHebrewTyping();
      return;
    }
    if (!hebrewTyping || e.isComposing) return;
    if (e.inputType !== "insertText" && e.inputType !== "insertFromPaste") return;
    const raw = e.data ?? (e.dataTransfer ? e.dataTransfer.getData("text/plain") : "");
    if (!raw) return;
    const converted = toHebrewKeys(raw);
    if (converted === raw) return;
    e.preventDefault();
    const el = els.input;
    el.setRangeText(converted, el.selectionStart, el.selectionEnd, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  els.form.addEventListener("submit", e => {
    e.preventDefault();
    doSearch(els.input.value);
  });

  // "Refresh" link shown next to a cached result — forces a live re-fetch
  // for just that one dictionary, bypassing (and then overwriting) the cache.
  els.refreshMorfix.addEventListener("click", () => {
    if (els.input.value.trim()) doMorfixSearch(els.input.value, { forceRefresh: true });
  });
  els.refreshPealim.addEventListener("click", () => {
    if (els.input.value.trim()) doPealimSearch(els.input.value, { forceRefresh: true });
  });
  els.refreshMilog.addEventListener("click", () => {
    if (els.input.value.trim()) doMilogSearch(els.input.value, { forceRefresh: true });
  });

  // ---------- Pi relay: check on load and whenever the network may have changed ----------
  if (window.PI_HOSTED) els.relayUrlField.placeholder = "Leave blank: this page is served by your Pi";
  window.addEventListener("online", checkRelay);
  window.addEventListener("offline", () => { state.relayAvailable = false; renderRelayStatus(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkRelay();
  });
  checkRelay();
})();