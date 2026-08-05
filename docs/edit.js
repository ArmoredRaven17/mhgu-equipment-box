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
        draft.kinsect_id = null; draft.kinsect_stats = null;
        draft.bowgun_attachments = null;
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
        syncKinsect();
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
    if (DB.isIG(t) && draft.equip_id) renderKinsect(body);
    if (DB.isBowgun(t) && draft.equip_id) renderBowgun(body);
  }

  // Keep the kinsect legal for the glaive now selected: DLC glaives force their
  // own kinsect, and a kinsect from the wrong tree (Cutting vs Blunt) has to go.
  function syncKinsect() {
    if (!DB.isIG(draft.equip_type) || !draft.equip_id) {
      draft.kinsect_id = null; draft.kinsect_stats = null;
      return;
    }
    const locked = DB.lockedKinsectId(draft.equip_id);
    if (locked) {
      if (draft.kinsect_id !== locked) {
        draft.kinsect_id = locked;
        draft.kinsect_stats = DB.defaultKinsectStats(locked);
      }
      return;
    }
    const allowed = DB.kinsectOptions(draft.equip_id);
    const ok = draft.kinsect_id && allowed.some(o => o[0] === draft.kinsect_id);
    if (!ok) {
      const first = allowed.length ? allowed[0][0] : 0;
      draft.kinsect_id = first || null;
      draft.kinsect_stats = first ? DB.defaultKinsectStats(first) : null;
    } else if (!draft.kinsect_stats) {
      draft.kinsect_stats = DB.defaultKinsectStats(draft.kinsect_id);
    }
  }

  function renderKinsect(body) {
    syncKinsect();
    const fs = document.createElement("fieldset");
    fs.className = "edit-group";
    fs.innerHTML = "<legend>Kinsect</legend>";

    const locked = DB.lockedKinsectId(draft.equip_id);
    const kd = DB.kinsect(draft.kinsect_id);
    if (locked) {
      const note = document.createElement("div");
      note.className = "ks-locked";
      note.textContent = `${kd ? kd.n : "?"} (${kd ? kd.t : "?"}) — fixed to this glaive`;
      fs.appendChild(note);
    } else {
      fs.appendChild(field("Kinsect", selectEl(
        DB.kinsectOptions(draft.equip_id), draft.kinsect_id || 0,
        v => {
          draft.kinsect_id = v;
          draft.kinsect_stats = DB.defaultKinsectStats(v);   // stats reset to the new insect's floor
          dirtyDraft = true;
          render();
        })));
    }

    const stats = draft.kinsect_stats || DB.defaultKinsectStats(draft.kinsect_id);
    const KS = DB.KS;
    const min = DB.ksMinBytes(kd);
    const pwsUsed = DB.KS_PWS.reduce((n, i) => n + stats[i], 0);
    const elemUsed = DB.KS_ELEMENTS.reduce((n, e) => n + stats[e.idx], 0);

    const head = document.createElement("div");
    head.className = "ks-level-row";
    head.innerHTML = `<span>Kinsect level</span><strong>${DB.ksLevel(stats, draft.kinsect_id)}</strong>`;
    fs.appendChild(head);
    fs.appendChild(radarEl(stats));

    const grid = document.createElement("div");
    grid.className = "ks-stat-grid";
    // Power / weight / speed share one pool; the elements share another.
    [["Power", KS.powerLv, DB.powerStat, min[0]],
     ["Weight", KS.weightLv, DB.weightStat, min[1]],
     ["Speed", KS.speedLv, DB.speedStat, min[2]]]
      .forEach(([label, idx, toStat, floor]) => {
        grid.appendChild(ksRow(label, idx, stats, floor,
          Math.min(DB.KS_PWS_MAX, stats[idx] + Math.max(0, DB.KS_PWS_POOL - pwsUsed)),
          toStat(stats[idx])));
      });
    DB.KS_ELEMENTS.forEach(e => {
      grid.appendChild(ksRow(e.name, e.idx, stats, 0,
        Math.min(DB.KS_ELEM_MAX, stats[e.idx] + Math.max(0, DB.KS_ELEM_POOL - elemUsed)), null, e.color));
    });
    fs.appendChild(grid);

    const pools = document.createElement("div");
    pools.className = "slots-used";
    pools.textContent = `Power/Weight/Speed: ${pwsUsed} / ${DB.KS_PWS_POOL} · Elements: ${elemUsed} / ${DB.KS_ELEM_POOL}`;
    fs.appendChild(pools);

    if (kd && (kd.ks || kd.es)) {
      const sk = document.createElement("div");
      sk.className = "edit-hint";
      const parts = [];
      if (kd.ks) parts.push("Kinsect skills: " + kd.ks.join(", "));
      if (kd.es) parts.push("Extract skills: " + kd.es.join(", "));
      sk.textContent = parts.join(" · ");
      fs.appendChild(sk);
    }
    body.appendChild(fs);
  }

  // One stat row: a level spinner, one-based like the game shows it, plus the
  // derived stat value where there is one.
  function ksRow(label, idx, stats, floor, ceiling, statValue, color) {
    const row = document.createElement("div");
    row.className = "ks-stat-row";
    const name = document.createElement("span");
    name.className = "ks-stat-name";
    name.textContent = label;
    if (color) name.style.color = color;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = String(floor + 1);
    inp.max = String(ceiling + 1);
    inp.value = String(stats[idx] + 1);
    inp.addEventListener("change", () => {
      const want = (parseInt(inp.value, 10) || 1) - 1;
      draft.kinsect_stats = DB.ksSet(stats, draft.kinsect_id, idx, Math.max(floor, want));
      dirtyDraft = true;
      render();
    });
    const val = document.createElement("span");
    val.className = "ks-stat-val";
    val.textContent = statValue === null || statValue === undefined ? "" : String(statValue);
    row.appendChild(name); row.appendChild(inp); row.appendChild(val);
    return row;
  }

  function radarEl(stats) {
    const wrap = document.createElement("div");
    wrap.innerHTML = radarSvg(stats);
    return wrap.firstElementChild;
  }

  // The editor's three-axis radar, redrawn as inline SVG. Power, weight and
  // speed each get an axis; the shape is tinted by whichever dominates.
  function radarSvg(stats) {
    const cx = 80, cy = 84, r = 52, MAX = 240;
    const power = DB.powerStat(stats[DB.KS.powerLv]);
    const weight = DB.weightStat(stats[DB.KS.weightLv]);
    const speed = DB.speedStat(stats[DB.KS.speedLv]);
    const color = power >= weight && power >= speed
      ? { fill: "rgba(220,100,160,0.35)", stroke: "rgba(240,120,180,0.85)", dot: "#e878c0" }
      : weight >= speed
        ? { fill: "rgba(210,120,40,0.35)", stroke: "rgba(240,150,50,0.85)", dot: "#e09030" }
        : { fill: "rgba(200,200,200,0.35)", stroke: "rgba(230,230,230,0.85)", dot: "#d0d0d0" };
    const axes = [
      { label: "P", value: power, angle: -Math.PI / 2 },
      { label: "W", value: weight, angle: -Math.PI / 2 + 2 * Math.PI / 3 },
      { label: "S", value: speed, angle: -Math.PI / 2 + 4 * Math.PI / 3 },
    ];
    const pt = (frac, a) => [cx + frac * r * Math.cos(a), cy + frac * r * Math.sin(a)];
    const poly = frac => axes.map(a => pt(frac, a.angle).join(",")).join(" ");
    let svg = `<svg viewBox="0 10 160 120" class="kinsect-radar" aria-hidden="true">`;
    [0.25, 0.5, 0.75, 1].forEach(f => {
      svg += `<polygon points="${poly(f)}" fill="none" stroke="${f === 1 ? "#333" : "#222"}" stroke-width="${f === 1 ? 1 : 0.5}"/>`;
    });
    axes.forEach(a => {
      const p = pt(1, a.angle);
      svg += `<line x1="${cx}" y1="${cy}" x2="${p[0]}" y2="${p[1]}" stroke="#2a2a3a" stroke-width="1"/>`;
    });
    svg += `<polygon points="${axes.map(a => pt(a.value / MAX, a.angle).join(",")).join(" ")}"
      fill="${color.fill}" stroke="${color.stroke}" stroke-width="1.5"/>`;
    axes.forEach(a => {
      const p = pt(a.value / MAX, a.angle);
      svg += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${color.dot}"/>`;
    });
    axes.forEach(a => {
      const lx = cx + (r + 10) * Math.cos(a.angle), ly = cy + (r + 10) * Math.sin(a.angle);
      const anchor = Math.cos(a.angle) > 0.3 ? "start" : Math.cos(a.angle) < -0.3 ? "end" : "middle";
      const dy = Math.sin(a.angle) > 0.3 ? "0.9em" : Math.sin(a.angle) < -0.3 ? "-0.2em" : "0.35em";
      svg += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dy="${dy}" font-size="10" fill="#999">${a.label}</text>`;
    });
    return svg + "</svg>";
  }

  function renderBowgun(body) {
    if (!draft.bowgun_attachments) draft.bowgun_attachments = { mod_bit: 0, variable_zoom: false };
    const bg = draft.bowgun_attachments;
    const fs = document.createElement("fieldset");
    fs.className = "edit-group";
    fs.innerHTML = "<legend>Bowgun Attachments</legend>";
    fs.appendChild(field("Mod", selectEl(
      DB.bowgunModOptions(draft.equip_type), bg.mod_bit,
      v => { bg.mod_bit = v; dirtyDraft = true; updateSaveState(); })));
    fs.appendChild(field("Scope", selectEl(
      [[0, "Fixed Zoom"], [1, "Variable Zoom"]], bg.variable_zoom ? 1 : 0,
      v => { bg.variable_zoom = v === 1; dirtyDraft = true; updateSaveState(); })));
    const note = document.createElement("div");
    note.className = "edit-hint";
    note.style.margin = "6px 0 0";
    note.textContent = DB.isLBG(draft.equip_type)
      ? "Silencer and Long Barrel are Light Bowgun mods."
      : "Power Barrel and Shield are Heavy Bowgun mods.";
    fs.appendChild(note);
    body.appendChild(fs);
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
      // Never let a kinsect or a bowgun mod survive onto a piece that cannot
      // carry one — a type change followed by Save would otherwise smuggle it in.
      if (out && !DB.isIG(out.equip_type)) { out.kinsect_id = null; out.kinsect_stats = null; }
      if (out && !DB.isBowgun(out.equip_type)) out.bowgun_attachments = null;
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

  return { init, open, close, isOpen, tryClose, nameSearch, esc, radarSvg };
})();
