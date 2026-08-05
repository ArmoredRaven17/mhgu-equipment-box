/* MHGU Equipment Box — the box model. No DOM.
 *
 * Two fixed-length arrays of slots, one per box. A slot holds either null or an
 * entry; the entry's position in the array *is* its box index, which is why
 * nothing here stores one. Everything the UI does to the box goes through here.
 */
window.BOX = (function () {
  "use strict";
  const DB = window.DB;

  const PLAYER_SIZE = 2000;   // EQUIP_BOX_CAPACITY
  const PALICO_SIZE = 1000;   // PALICO_EQUIP_BOX_CAPACITY
  const PAGE_SIZE = 100;      // 10 x 10, as in-game
  const COLS = 10;

  const SAVE_APP = "mhgu-equipment-box";
  const SAVE_VERSION = 1;
  const TRACKER_APP = "mhgu-collection-tracker";
  // When the open file is a collection-tracker save, the box lives under this
  // key inside it and everything else in the envelope is carried through
  // untouched, so one file can hold both apps' data.
  const BOX_KEY = "box";
  // The collection tracker is a sibling path on the same origin, so both apps
  // share one localStorage. They keep one document between them under the
  // tracker's historical key — the name is legacy, the contents are shared.
  const AUTOSAVE_KEY = "mhgu-tracker-autosave";
  const LEGACY_BOX_KEY = "mhgu-box-autosave";   // read once, to migrate; never deleted
  const LOCAL_ENABLED_KEY = "mhgu-box-local";
  const SETTINGS_KEY = "mhgu-box-settings";

  const boxes = {
    player: new Array(PLAYER_SIZE).fill(null),
    palico: new Array(PALICO_SIZE).fill(null),
  };
  const sizeOf = kind => (kind === "palico" ? PALICO_SIZE : PLAYER_SIZE);

  const settings = { confirmSort: true, backdropClose: false, syncCollection: true };
  let localSaveEnabled = true;
  try { localSaveEnabled = localStorage.getItem(LOCAL_ENABLED_KEY) !== "0"; } catch (e) {}
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")); } catch (e) {}
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} };

  let dirty = false;
  const listeners = { dirty: [], change: [] };
  const on = (evt, fn) => listeners[evt].push(fn);
  const emit = (evt, arg) => listeners[evt].forEach(fn => fn(arg));

  // Anything that mutates the box funnels through here so autosave and the
  // dirty indicator can never drift out of step with the data.
  function touched() {
    if (!dirty) { dirty = true; emit("dirty", true); }
    scheduleAutosave();
    emit("change");
  }
  function clearDirty() { dirty = false; emit("dirty", false); }
  const isDirty = () => dirty;

  // ── Entries ────────────────────────────────────────────────────────────
  function makeEntry(type, id) {
    return {
      equip_type: type, equip_id: id, level: 0,
      transmog_id: 0, transmog_level: 0,
      decorations: [0, 0, 0], deco_slots: 0, talisman: null,
      kinsect_id: null, kinsect_stats: null, bowgun_attachments: null,
    };
  }
  function cloneEntry(e) {
    if (!e) return null;
    return {
      equip_type: e.equip_type, equip_id: e.equip_id, level: e.level,
      transmog_id: e.transmog_id, transmog_level: e.transmog_level,
      decorations: e.decorations.slice(0, 3),
      deco_slots: e.deco_slots,
      talisman: e.talisman ? Object.assign({}, e.talisman) : null,
      kinsect_id: e.kinsect_id,
      kinsect_stats: e.kinsect_stats ? e.kinsect_stats.slice() : null,
      bowgun_attachments: e.bowgun_attachments ? Object.assign({}, e.bowgun_attachments) : null,
    };
  }

  const get = (kind, i) => boxes[kind][i] || null;
  const all = kind => boxes[kind];
  const usedCount = kind => boxes[kind].reduce((n, e) => n + (e ? 1 : 0), 0);
  const totalPages = kind => Math.ceil(sizeOf(kind) / PAGE_SIZE);

  function set(kind, i, entry) {
    if (i < 0 || i >= sizeOf(kind)) return;
    boxes[kind][i] = entry ? cloneEntry(entry) : null;
    touched();
  }
  function clear(kind, i) { set(kind, i, null); }

  function swap(kind, a, b) {
    const arr = boxes[kind];
    const t = arr[a]; arr[a] = arr[b]; arr[b] = t;
    touched();
  }
  function copy(kind, src, dst) {
    boxes[kind][dst] = cloneEntry(boxes[kind][src]);
    touched();
  }

  const firstEmpty = (kind, from) => {
    const arr = boxes[kind];
    for (let i = from || 0; i < arr.length; i++) if (!arr[i]) return i;
    return -1;
  };
  function emptyCount(kind, from) {
    const arr = boxes[kind];
    let n = 0;
    for (let i = from || 0; i < arr.length; i++) if (!arr[i]) n++;
    return n;
  }

  // ── Bulk moves ─────────────────────────────────────────────────────────
  // Move a selection so it lands contiguously from dstStart. Anything displaced
  // is pushed back into the vacated source slots rather than destroyed, which is
  // what the editor does and what makes the operation reversible by eye.
  function moveSelection(kind, indices, dstStart) {
    const arr = boxes[kind];
    const src = indices.slice().sort((a, b) => a - b);
    const picked = src.map(i => arr[i]);
    const dst = src.map((_, k) => dstStart + k).filter(i => i < arr.length);
    if (!dst.length) return 0;

    const srcSet = new Set(src), dstSet = new Set(dst);
    const displaced = [];
    for (const i of dst) if (!srcSet.has(i) && arr[i]) displaced.push(arr[i]);

    for (const i of src) if (!dstSet.has(i)) arr[i] = null;
    for (let k = 0; k < dst.length; k++) arr[dst[k]] = picked[k];
    // Backfill the now-free source slots with whatever we pushed out.
    let d = 0;
    for (const i of src) {
      if (d >= displaced.length) break;
      if (!arr[i]) arr[i] = displaced[d++];
    }
    touched();
    return dst.length;
  }
  function copySelection(kind, indices, dstStart) {
    const arr = boxes[kind];
    const src = indices.slice().sort((a, b) => a - b);
    let n = 0;
    for (let k = 0; k < src.length; k++) {
      const dst = dstStart + k;
      if (dst >= arr.length) break;
      arr[dst] = cloneEntry(arr[src[k]]);
      n++;
    }
    touched();
    return n;
  }
  function deleteSelection(kind, indices) {
    const arr = boxes[kind];
    let n = 0;
    for (const i of indices) if (arr[i]) { arr[i] = null; n++; }
    if (n) touched();
    return n;
  }

  // ── Clipboard ──────────────────────────────────────────────────────────
  let clipboard = [];
  function copyToClipboard(kind, indices) {
    const src = indices.slice().sort((a, b) => a - b);
    clipboard = src.map(i => cloneEntry(boxes[kind][i])).filter(Boolean);
    return clipboard.length;
  }
  function cutToClipboard(kind, indices) {
    const n = copyToClipboard(kind, indices);
    deleteSelection(kind, indices);
    return n;
  }
  function pasteClipboard(kind, from) {
    if (!clipboard.length) return 0;
    let at = from || 0, placed = 0;
    for (const e of clipboard) {
      const i = firstEmpty(kind, at);
      if (i < 0) break;
      boxes[kind][i] = cloneEntry(e);
      at = i + 1;
      placed++;
    }
    if (placed) touched();
    return placed;
  }
  const clipboardSize = () => clipboard.length;
  const clearClipboard = () => { clipboard = []; };

  // ── Sorting ────────────────────────────────────────────────────────────
  // Filled slots compact to the front in the chosen order; empties follow.
  // Sort is destructive and cannot be undone from the box itself, so a single
  // snapshot is kept for one level of undo.
  let sortUndo = null;
  const SORT_KEYS = ["type", "rarity", "name", "id", "ingame"];
  function sortBox(kind, key, dir) {
    const arr = boxes[kind];
    sortUndo = { kind: kind, snapshot: arr.slice() };
    const filled = arr.filter(Boolean);
    // Decorate-sort-undecorate: displayName walks a weapon's rename chain, which
    // is far too costly to redo inside a comparator across 2000 entries.
    const keyed = filled.map(e => ({
      e: e,
      type: DB.typeSortPos(e.equip_type),
      rarity: DB.rarityOf(e),
      name: DB.displayName(e),
      id: e.equip_id,
    }));
    const sign = dir === "desc" ? -1 : 1;
    keyed.sort((a, b) => {
      let diff = 0;
      if (key === "type") diff = a.type - b.type;
      else if (key === "rarity") diff = a.rarity - b.rarity;
      else if (key === "name") diff = a.name.localeCompare(b.name);
      else if (key === "id") diff = a.id - b.id;
      else if (key === "ingame") { diff = a.type - b.type; if (!diff) diff = a.rarity - b.rarity; }
      if (!diff && key !== "name" && key !== "ingame") diff = a.name.localeCompare(b.name);
      if (!diff && key === "ingame") diff = a.id - b.id;
      return diff * sign;
    });
    for (let i = 0; i < arr.length; i++) arr[i] = i < keyed.length ? keyed[i].e : null;
    touched();
    return keyed.length;
  }
  const canUndoSort = () => !!sortUndo;
  function undoSort() {
    if (!sortUndo) return false;
    boxes[sortUndo.kind] = sortUndo.snapshot;
    sortUndo = null;
    touched();
    return true;
  }

  // ── Save / load ────────────────────────────────────────────────────────
  // Sparse and keyed by slot index: a box is mostly empty in normal use, and
  // writing 2000 nulls would dwarf the actual content.
  function packEntry(e) {
    const o = { t: e.equip_type, id: e.equip_id };
    if (e.level) o.lv = e.level;
    if (e.transmog_id) { o.tm = e.transmog_id; if (e.transmog_level) o.tmLv = e.transmog_level; }
    if (e.decorations.some(Boolean)) o.d = e.decorations.slice(0, 3);
    if (e.deco_slots) o.ds = e.deco_slots;
    if (e.talisman) o.tal = [e.talisman.skill1_id, e.talisman.skill1_pts, e.talisman.skill2_id, e.talisman.skill2_pts];
    if (e.kinsect_id) {
      o.k = e.kinsect_id;
      // Trailing zeros in the 23-byte block carry no meaning; drop them.
      if (e.kinsect_stats) {
        const s = e.kinsect_stats.slice();
        while (s.length && !s[s.length - 1]) s.pop();
        if (s.length) o.ks = s;
      }
    }
    if (e.bowgun_attachments) {
      const b = e.bowgun_attachments;
      if (b.mod_bit || b.variable_zoom) o.bg = [b.mod_bit | 0, b.variable_zoom ? 1 : 0];
    }
    return o;
  }
  function unpackEntry(o) {
    if (!o || typeof o !== "object" || !Number.isInteger(o.t) || o.t === 0) return null;
    const e = makeEntry(o.t, Number.isInteger(o.id) ? o.id : 0);
    e.level = Number.isInteger(o.lv) ? o.lv : 0;
    e.transmog_id = Number.isInteger(o.tm) ? o.tm : 0;
    e.transmog_level = Number.isInteger(o.tmLv) ? o.tmLv : 0;
    if (Array.isArray(o.d)) for (let i = 0; i < 3; i++) e.decorations[i] = Number.isInteger(o.d[i]) ? o.d[i] : 0;
    e.deco_slots = Number.isInteger(o.ds) ? o.ds : 0;
    if (Array.isArray(o.tal) && o.tal.length === 4)
      e.talisman = { skill1_id: o.tal[0] | 0, skill1_pts: o.tal[1] | 0, skill2_id: o.tal[2] | 0, skill2_pts: o.tal[3] | 0 };
    if (Number.isInteger(o.k) && o.k > 0) {
      e.kinsect_id = o.k;
      const s = new Array(DB.KS_BYTES).fill(0);
      if (Array.isArray(o.ks))
        for (let i = 0; i < DB.KS_BYTES; i++) s[i] = Number.isInteger(o.ks[i]) ? o.ks[i] : 0;
      e.kinsect_stats = s;
    }
    if (Array.isArray(o.bg) && o.bg.length === 2)
      e.bowgun_attachments = { mod_bit: o.bg[0] | 0, variable_zoom: !!o.bg[1] };
    return e;
  }
  // The envelope of a tracker file this box came from, minus its `box` key.
  // Null when working in the box's own format.
  let host = null;
  const isHosted = () => host !== null;

  function boxPayload() {
    const out = {};
    for (const kind of ["player", "palico"]) {
      const entries = {};
      const arr = boxes[kind];
      for (let i = 0; i < arr.length; i++) if (arr[i]) entries[i] = packEntry(arr[i]);
      out[kind] = { size: arr.length, entries: entries };
    }
    return out;
  }
  function serializeSave() {
    const payload = boxPayload();
    // Hosted in a tracker file: hand back that whole file with only the box
    // section rewritten, so the collection half survives untouched.
    if (host) {
      const out = Object.assign({}, host);
      out[BOX_KEY] = Object.assign({ version: SAVE_VERSION }, payload);
      return out;
    }
    return Object.assign(
      { app: SAVE_APP, version: SAVE_VERSION, savedAt: new Date().toISOString(),
        settings: Object.assign({}, settings) },
      payload);
  }
  // A tracker file is a valid box file too — the box just lives one level in.
  const isTrackerFile = obj => !!obj && typeof obj === "object" && obj.app === TRACKER_APP;
  // Where the box data sits in either format.
  const boxSectionOf = obj => (isTrackerFile(obj) ? obj[BOX_KEY] : obj);

  function validateSave(obj) {
    if (!obj || typeof obj !== "object") return "Not a valid file.";
    if (obj.app !== SAVE_APP && !isTrackerFile(obj))
      return "This file isn't an MHGU Equipment Box or Collection Tracker save.";
    if (!Number.isInteger(obj.version) || (obj.app === SAVE_APP && obj.version > SAVE_VERSION))
      return "This save was made with a newer version.";
    // A tracker file with no box section yet is fine — it just opens empty.
    const section = boxSectionOf(obj);
    if (isTrackerFile(obj) && section == null) return null;
    if (section == null || typeof section !== "object") return "Box data is malformed.";
    for (const kind of ["player", "palico"]) {
      const b = section[kind];
      if (b == null) continue;
      if (typeof b !== "object" || typeof b.entries !== "object" || b.entries === null) return "Box data is malformed.";
      for (const k in b.entries) {
        if (!/^\d+$/.test(k)) return "Box data is malformed.";
        const e = b.entries[k];
        if (!e || typeof e !== "object" || !Number.isInteger(e.t)) return "Box data is malformed.";
      }
    }
    if (section.player == null && section.palico == null) return "Save file contains no box data.";
    return null;
  }
  // `adopt` is false when restoring from browser storage: that document is
  // shared with the tracker and is always tracker-shaped, but which *file*
  // format Save writes should follow the file you opened, not what happens to
  // be in localStorage.
  function applySave(obj, opts) {
    const section = boxSectionOf(obj) || {};
    // Remember the rest of a tracker envelope so saving writes it back whole.
    if (opts && opts.adopt === false) {
      // leave host as it is
    } else if (isTrackerFile(obj)) {
      host = Object.assign({}, obj);
      delete host[BOX_KEY];
    } else {
      host = null;
    }
    for (const kind of ["player", "palico"]) {
      const arr = boxes[kind];
      arr.fill(null);
      const b = section[kind];
      if (!b || !b.entries) continue;
      for (const k in b.entries) {
        const i = Number(k);
        if (i < 0 || i >= arr.length) continue;   // a box that shrank; drop the overflow
        arr[i] = unpackEntry(b.entries[k]);
      }
    }
    if (obj.settings && typeof obj.settings === "object")
      for (const k in settings) if (typeof obj.settings[k] === "boolean") settings[k] = obj.settings[k];
    saveSettings();
    sortUndo = null;
    emit("change");
  }
  // ── Box -> collection ──────────────────────────────────────────────────
  // Anything sitting in the box is something you have, so the box can mark the
  // collection. Strictly a union: it never un-owns anything, because the box is
  // a subset of a collection (gear can be equipped, or simply not stored here).
  // Talismans are skipped — they are rolled, and have no tracker category.
  function derivedOwned() {
    const owned = { w: {}, a: {}, p: {} }, levelsOut = { w: {}, a: {}, p: {} };
    let talismans = 0;
    const byType = {};
    for (const k in TRACKER_TYPE) byType[TRACKER_TYPE[k]] = k;
    for (const kind of ["player", "palico"]) {
      for (const e of boxes[kind]) {
        if (!e) continue;
        if (e.equip_type === 6) { talismans++; continue; }
        const key = byType[e.equip_type];
        if (!key) continue;
        const [k, cat] = key.split(":");
        (owned[k][cat] || (owned[k][cat] = new Set())).add(e.equip_id);
        const lv = (e.level || 0) + 1;   // the tracker counts from 1
        const map = levelsOut[k][cat] || (levelsOut[k][cat] = {});
        if (!map[e.equip_id] || lv > map[e.equip_id]) map[e.equip_id] = lv;
      }
    }
    return { owned, levels: levelsOut, talismans };
  }
  // Merge into a document's collection without removing anything already there.
  // `levelsFollowBox` makes the box authoritative for the level of a piece it
  // holds, so lowering one here is reflected rather than ratcheting upward.
  function mergeOwnedInto(doc, derived, levelsFollowBox) {
    let added = 0;
    doc.owned = doc.owned || { w: {}, a: {}, p: {} };
    doc.levels = doc.levels || { w: {}, a: {}, p: {} };
    for (const k of ["w", "a", "p"]) {
      doc.owned[k] = doc.owned[k] || {};
      doc.levels[k] = doc.levels[k] || {};
      for (const cat in derived.owned[k]) {
        const have = new Set(Array.isArray(doc.owned[k][cat]) ? doc.owned[k][cat] : []);
        for (const id of derived.owned[k][cat]) if (!have.has(id)) { have.add(id); added++; }
        doc.owned[k][cat] = [...have].sort((a, b) => a - b);
      }
      for (const cat in derived.levels[k]) {
        const map = doc.levels[k][cat] || (doc.levels[k][cat] = {});
        for (const id in derived.levels[k][cat]) {
          const lv = derived.levels[k][cat][id];
          if (levelsFollowBox || !map[id] || lv > map[id]) map[id] = lv;
        }
      }
    }
    return added;
  }

  // Adopt a tracker file as the host without disturbing the current box —
  // so a box laid out here can be saved back into the file the collection
  // came from.
  function adoptHost(obj) {
    if (!isTrackerFile(obj)) return false;
    host = Object.assign({}, obj);
    delete host[BOX_KEY];
    touched();
    return true;
  }
  // Go back to writing a standalone box file. Otherwise, once a tracker file is
  // open there is no way out of it short of opening a box file you already have.
  function detachHost() {
    if (!host) return false;
    host = null;
    touched();
    return true;
  }
  // And the way in. Opening a standalone box file drops the association, so
  // without this a box that started life as its own file could never become a
  // shared one — saving it again just produced another file the tracker
  // refuses. Takes the collection from the shared browser document when there
  // is one, so attaching doesn't blank out a collection that already exists.
  function attachHost() {
    if (host) return false;
    const stored = readStored(AUTOSAVE_KEY);
    if (isTrackerFile(stored)) {
      host = Object.assign({}, stored);
      delete host[BOX_KEY];
    } else {
      host = { app: TRACKER_APP, version: 2, showDummy: false, settings: {},
               owned: { w: {}, a: {}, p: {} }, levels: { w: {}, a: {}, p: {} } };
    }
    touched();
    return true;
  }
  function reset() {
    boxes.player.fill(null);
    boxes.palico.fill(null);
    sortUndo = null;
    clipboard = [];
    touched();
  }

  // ── Browser storage ────────────────────────────────────────────────────
  let autosaveTimer = null;
  function scheduleAutosave() {
    if (!localSaveEnabled) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(flushAutosave, 500);
  }
  const readStored = key => {
    let raw;
    try { raw = localStorage.getItem(key); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };
  // Read-modify-write: pull the current shared document, replace only the box
  // section, put it back. The collection half is never written from a cached
  // copy, so the tracker in another tab cannot be reverted by this one.
  function flushAutosave() {
    if (!localSaveEnabled) return;
    let doc = readStored(AUTOSAVE_KEY);
    if (!doc || typeof doc !== "object")
      doc = { app: TRACKER_APP, version: 2, owned: { w: {}, a: {}, p: {} }, levels: { w: {}, a: {}, p: {} } };
    doc[BOX_KEY] = Object.assign({ version: SAVE_VERSION }, boxPayload());
    // Keep the collection in step. Additive on ids — a box export can be partial
    // (hunter and Palico are separate files), so nothing is ever un-owned from
    // here — but authoritative on the level of anything the box actually holds.
    if (settings.syncCollection) {
      const derived = derivedOwned();
      mergeOwnedInto(doc, derived, true);
      if (host) mergeOwnedInto(host, derived, true);
    }
    doc.savedAt = new Date().toISOString();
    try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(doc)); } catch (e) {}
  }
  function readLocalSave() {
    const doc = readStored(AUTOSAVE_KEY);
    const hasBox = doc && doc[BOX_KEY] && !validateSave(doc);
    if (hasBox) {
      const s = doc[BOX_KEY];
      const any = ["player", "palico"].some(k => s[k] && s[k].entries && Object.keys(s[k].entries).length);
      if (any) return doc;
    }
    // Nothing in the shared document yet — fall back to a box saved by an
    // earlier build under its own key. It migrates on the next write, and the
    // old key is left alone as a backup.
    const legacy = readStored(LEGACY_BOX_KEY);
    if (!legacy || validateSave(legacy)) return null;
    const any = ["player", "palico"].some(k => legacy[k] && legacy[k].entries && Object.keys(legacy[k].entries).length);
    return any ? legacy : null;
  }
  function setLocalSaveEnabled(v) {
    localSaveEnabled = v;
    try {
      localStorage.setItem(LOCAL_ENABLED_KEY, v ? "1" : "0");
      if (v) scheduleAutosave(); else clearLocalSave();
    } catch (e) {}
  }
  const isLocalSaveEnabled = () => localSaveEnabled;
  // Drop only the box out of the shared document — the collection in it belongs
  // to the tracker, and clearing the box here must not take it too. The key is
  // deleted outright only when there is no collection left to keep.
  function clearLocalSave() {
    clearTimeout(autosaveTimer);
    const doc = readStored(AUTOSAVE_KEY);
    try {
      if (!doc || typeof doc !== "object") { localStorage.removeItem(AUTOSAVE_KEY); return; }
      delete doc[BOX_KEY];
      const keeps = Object.keys(doc).some(k => k === "owned" || k === "levels" || k === "settings");
      if (keeps) localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(doc));
      else localStorage.removeItem(AUTOSAVE_KEY);
    } catch (e) {}
  }

  // ── Collection-tracker import ──────────────────────────────────────────
  // The tracker's ids are the game's own, the same ones this app uses, so the
  // only translation needed is category key -> equip_type.
  const TRACKER_TYPE = {
    "a:head": 1, "a:chest": 2, "a:arms": 3, "a:waist": 4, "a:legs": 5,
    "w:great_sword": 7, "w:sword_and_shield": 8, "w:hammer": 9, "w:lance": 10,
    "w:heavy_bowgun": 11, "w:light_bowgun": 13, "w:long_sword": 14, "w:switch_axe": 15,
    "w:gunlance": 16, "w:bow": 17, "w:dual_blades": 18, "w:hunting_horn": 19,
    "w:insect_glaive": 20, "w:charge_blade": 21,
    "p:weapon": 22, "p:head": 23, "p:body": 24,
  };
  // Flatten a tracker save into placeable items, in in-game box order.
  // `unspecified` decides what an owned-but-unlevelled piece becomes: "min" (LV1)
  // or "max". The tracker's levels are 1-based; ours are 0-based.
  // Place as many as will fit, never displacing what is already there.

  return {
    PLAYER_SIZE, PALICO_SIZE, PAGE_SIZE, COLS, SORT_KEYS,
    sizeOf, totalPages, get, all, set, clear, usedCount, emptyCount, firstEmpty,
    makeEntry, cloneEntry,
    swap, copy, moveSelection, copySelection, deleteSelection,
    copyToClipboard, cutToClipboard, pasteClipboard, clipboardSize, clearClipboard,
    sortBox, canUndoSort, undoSort,
    serializeSave, validateSave, applySave, reset,
    isTrackerFile, boxSectionOf, isHosted, adoptHost, detachHost, attachHost,
    isDirty, clearDirty, on,
    scheduleAutosave, flushAutosave, readLocalSave,
    setLocalSaveEnabled, isLocalSaveEnabled, clearLocalSave,
    settings, saveSettings,
    TRACKER_TYPE,
  };
})();
