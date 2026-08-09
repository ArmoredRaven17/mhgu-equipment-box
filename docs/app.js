/* MHGU Equipment Box — wiring, theme, file I/O and boot.
 *
 * db.js / box.js / edit.js / ui.js hold the substance; this file connects them
 * to the chrome and starts everything.
 */
(function () {
  "use strict";
  const DB = window.DB, BOX = window.BOX, EDIT = window.EDIT, UI = window.UI;
  const $ = id => document.getElementById(id);
  if (!window.EQ_NAMES || !DB) {
    document.body.innerHTML = "<p style='padding:20px'>Failed to load equipment data.</p>";
    return;
  }
  const THEME_KEY = "mhgu-box-theme";
  const fmt = n => n.toLocaleString("en-US");

  // ── Toast ──────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), ms || 2600);
  }

  // ── Theme ──────────────────────────────────────────────────────────────
  // Same palette as the collection tracker, so the two apps sit together.
  const THEME_COLORS = [
    ["Teostra", "#570B0B"], ["Rathalos", "#b51717"],
    ["Tetsucabra", "#c65900"], ["Agnaktor", "#fc933e"],
    ["Tigrex", "#C8A319"], ["Rajang", "#f1d364"],
    ["Deviljho", "#0B570F"], ["Rathian", "#3a9b3f"],
    ["Astalos", "#14503d"], ["Zinogre", "#2dae85"],
    ["Zamtrios", "#005984"], ["Plesioth", "#0080c1"],
    ["Brachydios", "#0B2757"], ["Lagiacrus", "#0b3f97"],
    ["G. Magala", "#1F0B57", "Gore Magala"], ["Nerscylla", "#4e2fa2"],
    ["Y. Garuga", "#62008f", "Yian Garuga"], ["Chameleos", "#8e50ab"],
    ["Mizutsune", "#D84696"], ["Congalala", "#ce79a8"],
    ["Duramboros", "#5a411f"], ["Diablos", "#997c54"],
    ["Barroth", "#B57C45"], ["Bulldrome", "#cfaa87"],
    ["K. Daora", "#505358", "Kushala Daora"], ["Valstrax", "#aeb5c1"],
    ["Forbidden", "#1E2025", "Question Mark"],
  ];
  const COLORS_HEX = Object.fromEntries(THEME_COLORS.map(([name, hex]) => [hex.toUpperCase(), name]));
  const COLORS_ICON = Object.fromEntries(THEME_COLORS.filter(c => c[2]).map(([name, , icon]) => [name, icon]));
  const FALLBACK_ICON = "assets/MonsterIcons/MHGU-Question_Mark_Icon.webp";
  const monsterIcon = name => name ? "assets/MonsterIcons/MHGU-" + name.replace(/ /g, "_") + "_Icon.webp" : FALLBACK_ICON;

  const hexRgb = h => { h = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
  const clamp01 = n => Math.max(0, Math.min(1, n));
  const rgbToHsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    if (d === 0) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6;
    return [h, s, l];
  };
  const hslToRgb = ([h, s, l]) => {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    const hi = Math.floor(h * 6) % 6;
    const [r, g, b] = hi === 0 ? [c, x, 0] : hi === 1 ? [x, c, 0] : hi === 2 ? [0, c, x]
      : hi === 3 ? [0, x, c] : hi === 4 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map(v => clamp(v * 255));
  };
  const darken = (rgb, f) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l * f)]); };
  const lighten = (rgb, b) => { const [h, s, l] = rgbToHsl(rgb); return hslToRgb([h, s, clamp01(l + (1 - l) * b)]); };
  const cssRgb = rgb => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const toWhite = (rgb, t) => rgb.map(v => clamp(v + (255 - v) * t));
  // WCAG relative luminance, for deciding whether a surface takes light or dark
  // text. Not the same as HSL lightness: green at L=.5 is far brighter than blue
  // at L=.5, and the themes span both.
  const relLum = rgb => {
    const [r, g, b] = rgb.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    return .2126 * r + .7152 * g + .0722 * b;
  };

  function applyTheme(hex) {
    const c = hexRgb(hex), r = document.documentElement.style;
    r.setProperty("--bg", cssRgb(darken(c, .70)));
    r.setProperty("--bg1", cssRgb(darken(c, .80)));
    r.setProperty("--grid-bg", cssRgb(darken(c, .35)));
    r.setProperty("--content-bg", cssRgb(darken(c, .55)));
    r.setProperty("--panel-bg", cssRgb(darken(c, .40)));
    r.setProperty("--bg2", cssRgb(darken(c, .95)));
    // The box toolbar. --bg2 is only 5% off the raw theme colour, which left the
    // toolbar washed out on the lighter themes. Deriving its own factor rather
    // than mixing --bg2 toward black keeps the ordering true on every theme:
    // these are all lightness scalings of one colour, so .80 < .85 < .95 holds
    // whatever the theme, and the toolbar stays between the actions strip
    // beneath it (--bg1) and the panels (--bg2). A fixed mix does not — on the
    // lightest themes --bg1 and --bg2 are close enough that it overshoots.
    r.setProperty("--nav-bg", cssRgb(darken(c, .85)));
    // Toolbar controls, lifted off that bar toward white. A proportional step
    // like the one above would be 10% of whatever the theme is, which on the
    // dark themes is a couple of luminance points and invisible; adding white
    // gives a near-constant gap at both ends of the range. The label colour has
    // to follow, because on the pale themes — yellow worst at 1.29:1 — a fixed
    // near-white --text on these was unreadable.
    const bg2 = darken(c, .95), ctrl = toWhite(bg2, .15);
    r.setProperty("--control-bg", cssRgb(ctrl));
    r.setProperty("--control-bg-hover", cssRgb(toWhite(bg2, .28)));
    // .19 is where the two candidates give equal contrast — solve
    // 1.05/(L+.05) = (L+.05)/(Ldark+.05) — not .5, which is the intuitive guess
    // and leaves every mid-luminance theme on light text when dark text would
    // read far better. Worst case at the crossover is ~4.3:1.
    r.setProperty("--control-text", relLum(ctrl) > .19 ? "#14141a" : "#f3f3f3");
    r.setProperty("--accent", cssRgb(darken(c, .7)));
    r.setProperty("--accent-hover", cssRgb(lighten(c, .4)));
    try { localStorage.setItem(THEME_KEY, hex); } catch (e) {}
    document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("sel", s.dataset.hex === hex));
    // The title icon follows the theme, as in the collection tracker — the
    // monster the colour is named after, not a fixed weapon.
    const titleIcon = document.querySelector(".title-icon");
    if (titleIcon) {
      const name = COLORS_HEX[hex.toUpperCase()];
      titleIcon.src = name ? monsterIcon(COLORS_ICON[name] || name) : FALLBACK_ICON;
    }
  }
  function buildSwatches() {
    const wrap = $("swatches");
    wrap.innerHTML = "";
    for (const [name, hex, iconOverride] of THEME_COLORS) {
      const d = document.createElement("div");
      d.className = "swatch";
      d.dataset.hex = hex;
      d.style.background = hex;
      d.title = name;
      d.innerHTML = `<img class="swatch-icon" src="${monsterIcon(iconOverride || name)}" alt=""><span>${name}</span>`;
      d.addEventListener("click", () => applyTheme(hex));
      wrap.appendChild(d);
    }
  }

  // ── File save / load ───────────────────────────────────────────────────
  const supportsFsApi = "showSaveFilePicker" in window;
  const JSON_TYPES = [{ description: "JSON", accept: { "application/json": [".json"] } }];
  // Working inside a tracker file? Then Save writes that file back, so suggest
  // its name rather than the box's.
  const saveName = () => (BOX.isHosted() ? "mhgu-collection.json" : "mhgu-equipment-box.json");
  const saveOpts = () => ({ suggestedName: saveName(), types: JSON_TYPES });
  let fileHandle = null;

  async function saveToFile(forceNew) {
    const data = JSON.stringify(BOX.serializeSave(), null, 2);
    if (supportsFsApi) {
      try {
        if (forceNew || !fileHandle) fileHandle = await window.showSaveFilePicker(saveOpts());
        const w = await fileHandle.createWritable();
        await w.write(data);
        await w.close();
        BOX.clearDirty();
        toast("Saved.");
        return;
      } catch (e) { if (e && e.name === "AbortError") return; /* else fall through */ }
    }
    downloadBlob(data, saveName());
    BOX.clearDirty();
    toast("Downloaded save file.");
  }
  function downloadBlob(data, name) {
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function openFile() {
    if (supportsFsApi) {
      try {
        const [h] = await window.showOpenFilePicker({ types: JSON_TYPES });
        fileHandle = h;
        loadFromText(await (await h.getFile()).text());
        return;
      } catch (e) { if (e && e.name === "AbortError") return; }
    }
    $("importFile").click();
  }
  function loadFromText(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { toast("That file isn't valid JSON."); return; }
    const err = BOX.validateSave(obj);
    if (err) { toast(err); return; }
    // A tracker file carries the box in its own section, and everything else in
    // it is preserved when this app saves — so one file can serve both.
    const hosted = BOX.isTrackerFile(obj);
    const hadBox = hosted && !!BOX.boxSectionOf(obj);
    BOX.applySave(obj);
    BOX.clearDirty();
    UI.refresh();
    syncSettingToggles();
    if (hosted && !hadBox)
      toast("Collection Tracker file opened — it has no box in it yet. Lay one out and Save to put it in there.", 5200);
    else if (hosted) toast("Box loaded from your Collection Tracker file.");
    else toast("Box loaded.");
  }

  // ── Settings toggles ───────────────────────────────────────────────────
  function bindToggle(id, get, set) {
    const el = $(id);
    const sync = () => el.setAttribute("aria-checked", get() ? "true" : "false");
    sync();
    el.addEventListener("click", () => { set(!get()); sync(); });
    return sync;
  }
  const toggleSyncs = [];
  function syncSettingToggles() { toggleSyncs.forEach(f => f()); }

  // ── Modals ─────────────────────────────────────────────────────────────
  function bindModal(btnId, modalId, closeId) {
    $(btnId).addEventListener("click", () => $(modalId).classList.remove("hidden"));
    $(closeId).addEventListener("click", () => $(modalId).classList.add("hidden"));
    // Deliberately not behind the backdrop-close setting. That setting exists to
    // stop a stray click discarding an edit, and there is nothing to discard in
    // About, Settings or Controls — so these always close the easy way.
    $(modalId).addEventListener("click", e => {
      if (e.target.id === modalId) $(modalId).classList.add("hidden");
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────
  EDIT.init();
  UI.init({ toast: toast });

  BOX.on("dirty", on => {
    $("dirtyDot").classList.toggle("hidden", !on);
    document.title = (on ? "● " : "") + "MHGU Equipment Box";
  });

  $("saveBtn").addEventListener("click", () => saveToFile(false));
  $("saveAsBtn").addEventListener("click", () => saveToFile(true));
  $("openBtn").addEventListener("click", () => openFile());
  $("importFile").addEventListener("change", function () {
    const f = this.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = e => loadFromText(e.target.result);
    r.readAsText(f);
    this.value = "";
  });

  bindModal("aboutBtn", "aboutModal", "aboutClose");
  bindModal("linksBtn", "linksModal", "linksClose");
  bindModal("settingsBtn", "settingsModal", "settingsClose");
  bindModal("helpBtn", "helpModal", "helpClose");

  // Which file Save writes, and the way back out of a shared one.
  function syncFileMode() {
    const hosted = BOX.isHosted();
    $("fileModeLabel").textContent = hosted
      ? "Shared with your Collection Tracker file"
      : "Standalone box file";
    $("fileModeHint").textContent = hosted
      ? "Save writes the whole file back — your collection is kept exactly as it was, with the box stored alongside it."
      : "Save writes an equipment box file of its own.";
    $("detachBtn").classList.toggle("hidden", !hosted);
    $("attachBtn").classList.toggle("hidden", hosted);
  }
  $("settingsBtn").addEventListener("click", syncFileMode);
  $("detachBtn").addEventListener("click", () => {
    BOX.detachHost();
    fileHandle = null;   // don't write a box file over the collection file
    syncFileMode();
    toast("Save will now write a standalone box file.");
  });
  $("attachBtn").addEventListener("click", () => {
    BOX.attachHost();
    fileHandle = null;   // a different file now; make Save ask where
    syncFileMode();
    toast("Save will now write one file holding both the collection and the box.", 4200);
  });


  toggleSyncs.push(bindToggle("localSaveToggle", BOX.isLocalSaveEnabled, v => {
    BOX.setLocalSaveEnabled(v);
    toast(v ? "Saving your box in this browser." : "Browser save turned off and cleared.");
  }));
  toggleSyncs.push(bindToggle("syncCollectionToggle",
    () => BOX.settings.syncCollection,
    v => {
      BOX.settings.syncCollection = v;
      BOX.saveSettings();
      if (v) { BOX.flushAutosave(); toast("The collection will follow the box from now on."); }
      else toast("The box will no longer update the collection.");
    }));
  toggleSyncs.push(bindToggle("confirmSortToggle",
    () => BOX.settings.confirmSort,
    v => { BOX.settings.confirmSort = v; BOX.saveSettings(); }));
  toggleSyncs.push(bindToggle("backdropCloseToggle",
    () => BOX.settings.backdropClose,
    v => { BOX.settings.backdropClose = v; BOX.saveSettings(); }));

  $("clearLocalBtn").addEventListener("click", () => {
    // Clearing storage alone achieves nothing: the box is still in memory and
    // the next autosave writes it straight back. Reset both.
    UI.confirm("Clear your box from this browser?",
      "This erases the stored copy and empties what's currently laid out. Boxes you've saved to a file are not affected.",
      () => {
        BOX.clearLocalSave();
        BOX.reset();
        BOX.clearDirty();
        UI.refresh();
        toast("Browser save cleared.");
      });
  });

  window.addEventListener("beforeunload", e => {
    if (BOX.isLocalSaveEnabled()) { BOX.flushAutosave(); return; }
    if (BOX.isDirty()) { e.preventDefault(); e.returnValue = ""; }
  });
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveToFile(false); }
  });

  buildSwatches();
  let savedTheme = "#1E2025";
  try { savedTheme = localStorage.getItem(THEME_KEY) || savedTheme; } catch (e) {}
  applyTheme(savedTheme);

  // Restore whatever was here last time.
  (function loadFromBrowser() {
    const obj = BOX.readLocalSave();
    if (!obj) return;
    if (BOX.isLocalSaveEnabled()) {
      BOX.applySave(obj, { adopt: false });
      BOX.clearDirty();
      UI.refresh();
      syncSettingToggles();
      toast("Box loaded from this browser.");
      return;
    }
    $("restoreBanner").classList.remove("hidden");
    $("restoreYes").addEventListener("click", () => {
      BOX.applySave(obj, { adopt: false }); BOX.clearDirty(); UI.refresh(); syncSettingToggles();
      $("restoreBanner").classList.add("hidden");
    });
    $("restoreNo").addEventListener("click", () => $("restoreBanner").classList.add("hidden"));
  })();

  // Custom-font repaint fix (controls can clip before the font loads)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    document.body.style.opacity = "0.999";
    requestAnimationFrame(() => { document.body.style.opacity = ""; });
  });
})();
