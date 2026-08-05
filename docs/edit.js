/* MHGU Equipment Box — the slot editor and its typeahead.
 *
 * A port of the save editor's EquipEditModal: pick a type, then a piece, then
 * its upgrade level, decorations, transmog appearance and — for talismans — the
 * rolled skills. Everything is edited on a draft copy so Cancel really cancels.
 */
window.EDIT = (function () {
  "use strict";
  const DB = window.DB, BOX = window.BOX;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, m =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  // ── Typeahead ──────────────────────────────────────────────────────────
  // Ported from NameSearch.tsx: filtering shows the closest 12, browsing shows
  // the first 80 with a count of what is hidden.
  const MAX_FILTERED = 12, MAX_BROWSE = 80;

  function nameSearch(host, opts) {
    const entries = opts.entries;             // [[id, label], …]
    const byId = new Map(entries);
    let value = opts.value || 0;
    let active = -1;

    host.classList.add("name-search");
    host.innerHTML = "";
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = opts.placeholder || "Type to search or browse…";
    input.value = value ? (byId.get(value) || "") : "";
    if (opts.disabled) input.disabled = true;
    const list = document.createElement("ul");
    list.className = "name-search-list hidden";
    host.appendChild(input);
    host.appendChild(list);

    function results() {
      const q = input.value.trim().toLowerCase();
      const filtered = q ? entries.filter(e => e[1].toLowerCase().includes(q)) : entries;
      const shown = filtered.slice(0, q ? MAX_FILTERED : MAX_BROWSE);
      return { shown: shown, hidden: filtered.length - shown.length };
    }
    function render() {
      const r = results();
      active = -1;
      if (!r.shown.length) { list.classList.add("hidden"); return; }
      let html = r.shown.map(e => `<li data-id="${e[0]}">${esc(e[1])}</li>`).join("");
      if (r.hidden > 0) html += `<li class="ns-overflow">${r.hidden} more — type to filter</li>`;
      list.innerHTML = html;
      list.classList.remove("hidden");
    }
    const close = () => { list.classList.add("hidden"); active = -1; };
    function pick(id) {
      value = id;
      input.value = byId.get(id) || "";
      close();
      if (opts.onChange) opts.onChange(id);
    }

    input.addEventListener("focus", render);
    input.addEventListener("input", () => {
      render();
      // Clearing the box clears the selection, matching the editor.
      if (input.value === "" && value !== 0) { value = 0; if (opts.onChange) opts.onChange(0); }
    });
    input.addEventListener("keydown", e => {
      const items = [].slice.call(list.querySelectorAll("li[data-id]"));
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!items.length) return;
        e.preventDefault();
        active = e.key === "ArrowDown"
          ? (active + 1) % items.length
          : (active - 1 + items.length) % items.length;
        items.forEach((li, i) => li.classList.toggle("active", i === active));
        items[active].scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key === "Enter" && items.length) {
        e.preventDefault();
        pick(Number(items[active >= 0 ? active : 0].dataset.id));
      }
    });
    list.addEventListener("mousedown", e => {
      const li = e.target.closest("li[data-id]");
      if (li) { e.preventDefault(); pick(Number(li.dataset.id)); }
    });
    document.addEventListener("mousedown", e => { if (!host.contains(e.target)) close(); });

    return {
      get value() { return value; },
      set(id) { value = id; input.value = id ? (byId.get(id) || "") : ""; },
      focus() { input.focus(); },
    };
  }

  // ── Modal ──────────────────────────────────────────────────────────────
  let draft = null, ctx = null, onCommit = null, dirtyDraft = false;

  const TYPE_OPTIONS = kind => (kind === "palico" ? DB.PALICO_TYPES : DB.PLAYER_TYPES);

  function open(kind, index, entry, commit) {
    ctx = { kind: kind, index: index };
    onCommit = commit;
    dirtyDraft = false;
    draft = entry ? BOX.cloneEntry(entry) : BOX.makeEntry(0, 0);
    $("editTitle").textContent = `Edit slot #${index}`;
    $("editOverlay").classList.add("hidden");
    $("editModal").classList.remove("hidden");
    render();
  }
  function close() {
    $("editModal").classList.add("hidden");
    draft = null; ctx = null; onCommit = null;
  }
  const isOpen = () => !$("editModal").classList.contains("hidden");

  // Slots the piece offers right now. Talismans carry their own rolled count.
  const capacity = () => DB.entryDecoSlots(draft);
  const usedSlots = () => DB.decoUsed(draft.decorations);

  function render() {
    const body = $("editBody");
    body.innerHTML = "";
    const t = draft.equip_type;

    // Type
    const types = TYPE_OPTIONS(ctx.kind);
    body.appendChild(field("Type", selectEl(
      [[0, "— empty —"]].concat(types.map(x => [x, DB.typeName(x)])),
      t,
      v => {
        draft.equip_type = v;
        draft.equip_id = v === 6 ? 1 : 0;
        draft.level = 0;
        draft.transmog_id = 0; draft.transmog_level = 0;
        draft.decorations = [0, 0, 0];
        draft.deco_slots = 0;
        draft.talisman = v === 6 ? { skill1_id: 0, skill1_pts: 0, skill2_id: 0, skill2_pts: 0 } : null;
        dirtyDraft = true;
        render();
      })));

    if (t === 0) { updateSaveState(); return; }
    if (t === 6) renderTalisman(body);
    else renderPiece(body);
    // Palico gear has no decoration slots at all, so it gets no section —
    // an empty "no slots" box would just be noise.
    if (!DB.isPalico(t)) renderDecos(body);
    updateSaveState();
  }

  function renderPiece(body) {
    const t = draft.equip_type;
    const isW = DB.isWeapon(t);

    const f = field(isW ? "Weapon" : "Name", null);
    const host = document.createElement("div");
    f.appendChild(host);
    body.appendChild(f);
    nameSearch(host, {
      entries: pickerEntries(t),
      value: draft.equip_id,
      placeholder: "Type to search…",
      onChange: id => {
        draft.equip_id = id;
        draft.level = 0;
        // A different piece can offer fewer slots — drop what no longer fits.
        trimDecos();
        dirtyDraft = true;
        render();
      },
    });

    // Level. Palico gear has none; everything else shows 1..max.
    if (!DB.isPalico(t) && draft.equip_id) {
      const max = DB.maxLevel(t, draft.equip_id);
      const opts = [];
      for (let lv = 1; lv <= max; lv++) {
        const label = isW ? `${DB.nameAtLevel(t, draft.equip_id, lv - 1)} LV${lv}` : `LV ${lv}`;
        opts.push([lv - 1, label + (lv === max && max > 1 ? " (max)" : "")]);
      }
      body.appendChild(field(`Level — ${max} total`, selectEl(opts, draft.level, v => {
        applyLevel(v);
      })));
    }

    if (DB.isArmor(t) && draft.equip_id) renderTransmog(body);
  }

  // Lowering a level can leave fewer decoration slots than are socketed. The
  // editor warns before dropping them; losing a fitted deco to a stray click on
  // a dropdown would be a nasty way to lose work.
  function applyLevel(newLevel) {
    const before = draft.level;
    draft.level = newLevel;
    const cap = capacity();
    if (usedSlots() > cap) {
      const lost = [];
      const kept = draft.decorations.slice();
      let used = 0;
      for (let i = 0; i < 3; i++) {
        const cost = DB.decoSlotCost(kept[i]);
        if (!kept[i]) continue;
        if (used + cost > cap) { lost.push(DB.decoName(kept[i])); kept[i] = 0; }
        else used += cost;
      }
      draft.level = before;   // hold until confirmed
      confirmOverlay(
        `Lowering to <strong>LV ${newLevel + 1}</strong> leaves fewer decoration slots than are
         currently socketed. These will be removed:`,
        lost,
        () => {
          draft.level = newLevel;
          draft.decorations = kept;
          dirtyDraft = true;
          render();
        },
        () => render());
      return;
    }
    dirtyDraft = true;
    render();
  }

  function renderTransmog(body) {
    const fs = document.createElement("fieldset");
    fs.className = "edit-group transmog";
    fs.innerHTML = "<legend>Visual (Transmog)</legend>";
    const f = field("Appearance", null);
    const host = document.createElement("div");
    f.appendChild(host);
    fs.appendChild(f);
    nameSearch(host, {
      entries: pickerEntries(draft.equip_type),
      value: draft.transmog_id,
      placeholder: "Same as stat armor (no transmog)",
      onChange: id => {
        draft.transmog_id = id;
        draft.transmog_level = 0;
        dirtyDraft = true;
        render();
      },
    });
    if (draft.transmog_id) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "nav-btn";
      clear.textContent = "Clear Visual";
      clear.addEventListener("click", () => {
        draft.transmog_id = 0; draft.transmog_level = 0; dirtyDraft = true; render();
      });
      fs.appendChild(clear);
    }
    const note = document.createElement("div");
    note.className = "edit-hint";
    note.textContent = "Blademaster / Gunner restrictions are not enforced, so any appearance can go on any piece.";
    fs.appendChild(note);
    body.appendChild(fs);
  }

  function renderTalisman(body) {
    const fs = document.createElement("fieldset");
    fs.className = "edit-group";
    fs.innerHTML = "<legend>Talisman</legend>";

    // The charm's equip_id is its rarity, and it decides which skills and point
    // ranges are legal — so changing it re-clamps both skills.
    fs.appendChild(field("Rarity", selectEl(
      DB.talismanList().map(([id, name]) => [id, `${name} (R${id})`]),
      draft.equip_id,
      v => {
        draft.equip_id = v;
        clampTalisman();
        dirtyDraft = true;
        render();
      })));

    const tal = draft.talisman;
    [1, 2].forEach(slot => {
      const idKey = slot === 1 ? "skill1_id" : "skill2_id";
      const ptKey = slot === 1 ? "skill1_pts" : "skill2_pts";
      const other = slot === 1 ? tal.skill2_id : tal.skill1_id;

      const f = field(`Skill ${slot}`, null);
      const host = document.createElement("div");
      f.appendChild(host);
      fs.appendChild(f);
      nameSearch(host, {
        entries: [[0, "— none —"]].concat(DB.charmSkills(draft.equip_id, slot).filter(s => s[0] !== other)),
        value: tal[idKey],
        placeholder: "Type to search…",
        onChange: id => {
          tal[idKey] = id;
          if (id === 0) tal[ptKey] = 0;
          else tal[ptKey] = DB.clampPts(tal[ptKey], DB.charmRange(draft.equip_id, id, slot));
          dirtyDraft = true;
          render();
        },
      });

      const range = DB.charmRange(draft.equip_id, tal[idKey], slot);
      const usable = !(range[0] === 0 && range[1] === 0);
      const label = tal[idKey] === 0
        ? `Skill ${slot} Points`
        : usable
          ? `Skill ${slot} Points (${range[0]} to ${range[1]})`
          : `Skill ${slot} Points — unavailable in slot ${slot} for this rarity`;
      const inp = document.createElement("input");
      inp.type = "number";
      inp.value = String(tal[ptKey]);
      inp.disabled = tal[idKey] === 0 || !usable;
      if (usable) { inp.min = String(range[0]); inp.max = String(range[1]); }
      inp.addEventListener("change", () => {
        tal[ptKey] = DB.clampPts(parseInt(inp.value, 10) || 0, range);
        inp.value = String(tal[ptKey]);
        dirtyDraft = true;
        updateSaveState();
      });
      fs.appendChild(field(label, inp));
    });

    const slots = document.createElement("input");
    slots.type = "number";
    slots.min = "0"; slots.max = "3";
    slots.value = String(draft.deco_slots || 0);
    slots.addEventListener("change", () => {
      draft.deco_slots = Math.max(0, Math.min(3, parseInt(slots.value, 10) || 0));
      trimDecos();
      dirtyDraft = true;
      render();
    });
    fs.appendChild(field("Deco Slots (0–3)", slots));
    body.appendChild(fs);
  }

  function clampTalisman() {
    const tal = draft.talisman;
    if (!tal) return;
    [[1, "skill1_id", "skill1_pts"], [2, "skill2_id", "skill2_pts"]].forEach(([slot, idKey, ptKey]) => {
      if (!tal[idKey]) { tal[ptKey] = 0; return; }
      const r = DB.charmRange(draft.equip_id, tal[idKey], slot);
      if (r[0] === 0 && r[1] === 0) { tal[idKey] = 0; tal[ptKey] = 0; return; }
      tal[ptKey] = DB.clampPts(tal[ptKey], r);
    });
  }

  function renderDecos(body) {
    const cap = capacity();
    const fs = document.createElement("fieldset");
    fs.className = "edit-group";
    fs.innerHTML = "<legend>Decorations</legend>";
    if (!cap) {
      const n = document.createElement("div");
      n.className = "edit-hint";
      n.style.margin = "0";
      n.textContent = draft.equip_type === 6
        ? "Set this talisman's deco slots above to socket decorations."
        : "This piece has no decoration slots.";
      fs.appendChild(n);
      body.appendChild(fs);
      return;
    }
    for (let i = 0; i < 3; i++) {
      const current = draft.decorations[i];
      // Budget for this slot is what is free plus whatever this slot already holds.
      const budget = cap - usedSlots() + DB.decoSlotCost(current);
      const f = field(`Slot ${i + 1}`, null);
      const host = document.createElement("div");
      f.appendChild(host);
      fs.appendChild(f);
      nameSearch(host, {
        entries: [[0, "— empty —"]].concat(DB.decoList(budget)),
        value: current,
        placeholder: budget > 0 ? "Type to search…" : "No room left",
        onChange: id => { draft.decorations[i] = id; dirtyDraft = true; render(); },
      });
    }
    const used = document.createElement("div");
    used.className = "slots-used" + (usedSlots() > cap ? " over" : "");
    used.textContent = `Slots used: ${usedSlots()} / ${cap}`;
    fs.appendChild(used);
    body.appendChild(fs);
  }

  // Drop socketed decorations that no longer fit, cheapest-last.
  function trimDecos() {
    const cap = capacity();
    let used = 0;
    for (let i = 0; i < 3; i++) {
      const cost = DB.decoSlotCost(draft.decorations[i]);
      if (!draft.decorations[i]) continue;
      if (used + cost > cap) draft.decorations[i] = 0;
      else used += cost;
    }
  }

  function pickerEntries(type) {
    const db = DB.pickerDb(type);
    const out = [];
    for (const id in db) out.push([Number(id), db[id]]);
    out.sort((a, b) => a[1].localeCompare(b[1]));
    return out;
  }

  // ── Field helpers ──────────────────────────────────────────────────────
  function field(labelText, control) {
    const wrap = document.createElement("div");
    wrap.className = "edit-field";
    const label = document.createElement("label");
    label.textContent = labelText;
    wrap.appendChild(label);
    if (control) wrap.appendChild(control);
    return wrap;
  }
  function selectEl(options, value, onChange) {
    const sel = document.createElement("select");
    sel.innerHTML = options.map(([v, l]) =>
      `<option value="${v}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("");
    sel.addEventListener("change", () => onChange(Number(sel.value)));
    return sel;
  }

  // Save is refused where the editor refuses it: a piece with no id, or a
  // talisman with no first skill, would be meaningless in the box.
  function saveBlockedReason() {
    if (!draft || draft.equip_type === 0) return null;
    if (draft.equip_type === 6) return draft.talisman && draft.talisman.skill1_id ? null : "A talisman needs a Skill 1.";
    return draft.equip_id ? null : "Pick a piece first.";
  }
  function updateSaveState() {
    const btn = $("editSave");
    const reason = saveBlockedReason();
    btn.disabled = !!reason;
    btn.title = reason || "";
  }

  function confirmOverlay(html, list, onYes, onNo) {
    const ov = $("editOverlay");
    ov.innerHTML = `<p>${html}</p>` +
      (list && list.length ? `<ul class="modal-lost-list">${list.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : "") +
      `<div class="row gap"><button class="btn danger" data-yes>Continue</button>
       <button class="btn" data-no>Cancel</button></div>`;
    ov.classList.remove("hidden");
    ov.querySelector("[data-yes]").addEventListener("click", () => { ov.classList.add("hidden"); onYes(); });
    ov.querySelector("[data-no]").addEventListener("click", () => { ov.classList.add("hidden"); if (onNo) onNo(); });
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  function init() {
    $("editSave").addEventListener("click", () => {
      if (saveBlockedReason()) return;
      const out = draft.equip_type === 0 ? null : BOX.cloneEntry(draft);
      // Keep the stored slot count in step for non-talismans, so a saved box
      // still reads correctly if the tables ever move under it.
      if (out && out.equip_type !== 6) out.deco_slots = DB.entryDecoSlots(out);
      const commit = onCommit, at = ctx.index;
      close();
      commit(at, out);
    });
    $("editClear").addEventListener("click", () => {
      const commit = onCommit, at = ctx.index;
      close();
      commit(at, null);
    });
    $("editCancel").addEventListener("click", tryClose);
    $("editModal").addEventListener("click", e => {
      if (e.target.id === "editModal" && BOX.settings.backdropClose) tryClose();
    });
  }
  function tryClose() {
    if (!dirtyDraft) { close(); return; }
    confirmOverlay("You have unsaved changes to this slot. Discard them?", null, close);
  }

  return { init, open, close, isOpen, tryClose, nameSearch, esc };
})();
