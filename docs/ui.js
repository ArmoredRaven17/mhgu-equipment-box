/* MHGU Equipment Box — grid, paging, selection and the detail panel.
 *
 * The 100 cells of a page are built once and repainted in place; changing page
 * or editing a slot never rebuilds the grid's DOM.
 */
window.UI = (function () {
  "use strict";
  const DB = window.DB, BOX = window.BOX, EDIT = window.EDIT;
  const $ = id => document.getElementById(id);
  const esc = EDIT.esc;

  const PAGE = BOX.PAGE_SIZE, COLS = BOX.COLS;

  let kind = "player";
  let page = 0;
  let selected = null;      // flat index shown in the detail panel
  let cursor = null;        // keyboard / operation anchor
  let anchor = null;        // alt+click range anchor
  let multiSelect = false;
  const selection = new Set();
  let pendingOp = null;     // "move" | "copy" while choosing a destination
  let toastFn = () => {};

  const flat = i => page * PAGE + i;
  const onPage = f => f >= page * PAGE && f < (page + 1) * PAGE;
  const totalPages = () => BOX.totalPages(kind);

  // ── Grid ───────────────────────────────────────────────────────────────
  const cells = [];
  function buildGrid() {
    const grid = $("grid");
    grid.innerHTML = "";
    cells.length = 0;
    for (let i = 0; i < PAGE; i++) {
      const el = document.createElement("div");
      el.className = "box-cell empty";
      el.dataset.i = String(i);
      const img = document.createElement("img");
      img.className = "cell-icon hidden";
      img.alt = "";
      // Deliberately not loading="lazy": a page is only ever 100 on-screen cells,
      // and a lazy image whose src is set while it is still display:none never
      // starts loading at all.
      const slot = document.createElement("span");
      slot.className = "cell-slot";
      const lv = document.createElement("span");
      lv.className = "cell-lv hidden";
      const deco = document.createElement("span");
      deco.className = "cell-deco hidden";
      el.appendChild(img); el.appendChild(slot); el.appendChild(lv); el.appendChild(deco);
      grid.appendChild(el);
      cells.push({ el: el, img: img, slot: slot, lv: lv, deco: deco });
    }
  }

  function paintCell(i) {
    const c = cells[i];
    if (!c) return;
    const f = flat(i);
    const e = f < BOX.sizeOf(kind) ? BOX.get(kind, f) : undefined;
    const cls = ["box-cell"];

    if (e === undefined) {
      // Past the end of this box — only possible if a page is partly out of range.
      c.el.className = "box-cell empty";
      c.el.style.visibility = "hidden";
      return;
    }
    c.el.style.visibility = "";

    if (!e) {
      cls.push("empty");
      c.img.classList.add("hidden");
      c.slot.textContent = String(f);
      c.lv.classList.add("hidden");
      c.deco.classList.add("hidden");
      c.el.title = `Slot ${f} — empty (double-click to add)`;
    } else {
      const known = DB.isKnown(e.equip_type, e.equip_id);
      const rar = DB.rarityOf(e);
      cls.push("filled", "rarity-" + rar);
      if (e.equip_type === 6) cls.push("talisman");
      if (!known) cls.push("unknown");
      if (DB.isTransmogged(e)) cls.push("transmog");

      const icon = DB.iconPath(e.equip_type, rar);
      if (icon) { c.img.src = icon; c.img.classList.remove("hidden"); }
      else c.img.classList.add("hidden");
      c.slot.textContent = "";

      const max = DB.maxLevel(e.equip_type, e.equip_id);
      if (max > 1) {
        c.lv.textContent = String(e.level + 1);
        c.lv.classList.toggle("max", e.level + 1 >= max);
        c.lv.classList.remove("hidden");
      } else c.lv.classList.add("hidden");

      const used = DB.decoUsed(e.decorations);
      if (used) { c.deco.textContent = "◆".repeat(Math.min(3, e.decorations.filter(Boolean).length)); c.deco.classList.remove("hidden"); }
      else c.deco.classList.add("hidden");

      c.el.title = `Slot ${f} — ` + (DB.isTransmogged(e)
        ? `${DB.displayName(e)} [Visual: ${DB.transmogName(e)}]`
        : DB.displayName(e));
    }

    if (multiSelect && selection.has(f)) cls.push(cursor === f ? "cursor-selected" : "multi-selected");
    else if (cursor === f && anchor !== f) cls.push("cursor");
    if (anchor === f) cls.push("anchor");
    if (!multiSelect && selected === f && e) cls.push("selected");
    if (pendingOp && cursor === f) cls.push("op-source");
    c.el.className = cls.join(" ");
  }

  function paintPage() {
    for (let i = 0; i < PAGE; i++) paintCell(i);
    $("pageIndicator").textContent = `Page ${page + 1} / ${totalPages()}`;
    updateCapacity();
  }
  function repaint(f) { if (onPage(f)) paintCell(f - page * PAGE); }

  function updateCapacity() {
    const used = BOX.usedCount(kind), size = BOX.sizeOf(kind);
    $("capacityPill").textContent = `${used.toLocaleString("en-US")} / ${size.toLocaleString("en-US")} slots`;
    $("capacityPill").title = `${(size - used).toLocaleString("en-US")} free in the ${kind === "palico" ? "Palico" : "hunter"} box`;
  }

  function goPage(p) {
    const n = totalPages();
    page = ((p % n) + n) % n;
    paintPage();
  }
  function showIndex(f) {
    const p = Math.floor(f / PAGE);
    if (p !== page) { page = p; paintPage(); }
  }

  function setKind(k) {
    if (k === kind) return;
    kind = k;
    page = 0;
    selected = null; cursor = null; anchor = null;
    selection.clear(); pendingOp = null;
    if (multiSelect) toggleMultiSelect();
    $("boxSwitch").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.box === k));
    paintPage();
    renderDetail();
    updateHints();
  }

  // ── Interaction ────────────────────────────────────────────────────────
  function onCellClick(f, ev) {
    const e = BOX.get(kind, f);

    if (multiSelect) {
      if (pendingOp) { applyOp(pendingOp, f); return; }
      cursor = f;
      // Shift and Ctrl drop the selection straight onto a destination, without
      // going via the Move / Copy buttons — the editor's shortcut for the same.
      if (ev.shiftKey && selection.size) { anchor = null; applyOp("move", f); return; }
      if ((ev.ctrlKey || ev.metaKey) && selection.size) { anchor = null; applyOp("copy", f); return; }
      if (ev.altKey && anchor !== null) {
        const lo = Math.min(anchor, f), hi = Math.max(anchor, f);
        for (let i = lo; i <= hi; i++) selection.add(i);
        anchor = null;
      } else if (ev.altKey) {
        anchor = f;
      } else {
        anchor = null;
        if (selection.has(f)) selection.delete(f);
        else if (e) selection.add(f);
      }
      paintPage();
      updateHints();
      return;
    }

    if (ev.shiftKey && cursor !== null && cursor !== f) {
      BOX.swap(kind, cursor, f);
      const from = cursor;
      cursor = f; anchor = null;
      repaint(from); repaint(f);
      select(f);
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && cursor !== null && cursor !== f) {
      if (!BOX.get(kind, cursor)) return;
      const doCopy = () => { BOX.copy(kind, cursor, f); repaint(f); select(f); };
      if (e) {
        confirm("Overwrite slot?", `Slot ${f} holds <strong>${esc(DB.displayName(e))}</strong>. Replace it?`, doCopy);
      } else doCopy();
      return;
    }
    if (ev.altKey) { anchor = f; cursor = f; paintPage(); return; }

    anchor = null;
    cursor = f;
    select(f);
  }

  function select(f) {
    selected = BOX.get(kind, f) ? f : null;
    paintPage();
    renderDetail();
  }

  function applyOp(op, dst) {
    const list = Array.from(selection);
    if (!list.length) { pendingOp = null; updateHints(); return; }
    const apply = () => {
      const n = op === "move"
        ? BOX.moveSelection(kind, list, dst)
        : BOX.copySelection(kind, list, dst);
      selection.clear();
      pendingOp = null;
      anchor = null;
      paintPage();
      renderDetail();
      updateHints();
      toastFn(`${n} slot${n === 1 ? "" : "s"} ${op === "move" ? "moved" : "copied"}.`);
    };
    // Warn only when something already there would be disturbed.
    const sorted = list.slice().sort((a, b) => a - b);
    const srcSet = new Set(sorted);
    let hit = 0;
    for (let k = 0; k < sorted.length; k++) {
      const d = dst + k;
      if (d >= BOX.sizeOf(kind)) break;
      if (!srcSet.has(d) && BOX.get(kind, d)) hit++;
    }
    if (hit) {
      confirm(op === "move" ? "Move onto occupied slots?" : "Overwrite occupied slots?",
        op === "move"
          ? `<strong>${hit}</strong> item(s) already there will be swapped back into the slots you are moving from.`
          : `<strong>${hit}</strong> item(s) already there will be overwritten.`,
        apply);
    } else apply();
  }

  function toggleMultiSelect() {
    multiSelect = !multiSelect;
    selection.clear();
    anchor = null;
    pendingOp = null;
    if (multiSelect) selected = null;
    $("selectMode").classList.toggle("active", multiSelect);
    $("selectMode").textContent = multiSelect ? "Done" : "Select Mode";
    paintPage();
    renderDetail();
    updateHints();
  }

  // ── Hints ──────────────────────────────────────────────────────────────
  function updateHints() {
    const hint = $("selectHint");
    if (!multiSelect) { hint.classList.add("hidden"); hint.innerHTML = ""; }
    else if (pendingOp) {
      hint.classList.remove("hidden");
      hint.innerHTML = `${pendingOp === "move" ? "Moving" : "Copying"} ${selection.size} item(s) — click a destination slot or `;
      hint.appendChild(btn("Cancel", () => { pendingOp = null; paintPage(); updateHints(); }));
    } else if (selection.size) {
      hint.classList.remove("hidden");
      hint.innerHTML = `${selection.size} selected — `;
      hint.appendChild(btn("Delete", () => {
        const n = selection.size;
        confirm("Delete selection?", `Empty <strong>${n}</strong> slot(s)? This cannot be undone.`, () => {
          const removed = BOX.deleteSelection(kind, Array.from(selection));
          selection.clear();
          paintPage(); renderDetail(); updateHints();
          toastFn(`${removed} slot(s) emptied.`);
        });
      }));
      hint.appendChild(btn("Move", () => { pendingOp = "move"; paintPage(); updateHints(); }));
      hint.appendChild(btn("Copy", () => { pendingOp = "copy"; paintPage(); updateHints(); }));
      hint.appendChild(btn("Save Selection", () => {
        const n = BOX.copyToClipboard(kind, Array.from(selection));
        selection.clear(); paintPage(); updateHints(); syncClipboard();
        toastFn(`${n} item(s) saved to the clipboard.`);
      }));
      hint.appendChild(btn("Cut Selection", () => {
        const n = BOX.cutToClipboard(kind, Array.from(selection));
        selection.clear(); paintPage(); renderDetail(); updateHints(); syncClipboard();
        toastFn(`${n} item(s) cut to the clipboard.`);
      }));
      hint.appendChild(btn("Deselect All", () => { selection.clear(); anchor = null; paintPage(); updateHints(); }));
    } else {
      hint.classList.remove("hidden");
      hint.innerHTML = "Click filled slots to select · <kbd>Alt</kbd>+click sets a range anchor";
    }
    $("undoSort").classList.toggle("hidden", !BOX.canUndoSort());
  }
  function btn(label, fn) {
    const b = document.createElement("button");
    b.className = "nav-btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }
  function syncClipboard() {
    const n = BOX.clipboardSize();
    $("pasteBtn").disabled = !n;
    $("clearClipBtn").disabled = !n;
    $("pasteBtn").textContent = n ? `Paste Selection (${n})` : "Paste Selection";
    $("pasteBtn").title = n
      ? `Paste ${n} saved item(s) into empty slots, starting from the cursor`
      : "Save a selection in Select Mode first";
  }

  // ── Detail panel ───────────────────────────────────────────────────────
  function renderDetail() {
    const panel = $("detailPanel");
    if (selected === null) {
      panel.innerHTML = `<div class="detail-empty"><span>Click a slot to inspect</span>
        <span class="detail-hint">Double-click an empty slot to add equipment</span></div>`;
      return;
    }
    const e = BOX.get(kind, selected);
    if (!e) { panel.innerHTML = ""; return; }

    const t = e.equip_type;
    const rar = DB.rarityOf(e);
    const known = DB.isKnown(t, e.equip_id);
    const icon = DB.iconPath(t, rar);
    let h = "";

    h += `<div class="detail-icon-wrap">${icon ? `<img src="${icon}" alt="">` : ""}</div>`;
    h += `<div class="detail-type">${esc(DB.typeName(t))}</div>`;

    if (DB.isTransmogged(e)) {
      h += `<div class="detail-names-row">
        <div class="detail-name-card"><div class="detail-name-card-label">Stat</div>
          <div class="detail-name">${esc(DB.displayName(e))}</div></div>
        <div class="detail-name-card-arrow">→</div>
        <div class="detail-name-card transmog-card"><div class="detail-name-card-label">Visual</div>
          <div class="detail-name">${esc(DB.transmogName(e))}</div></div></div>`;
    } else {
      h += `<div class="detail-name">${esc(DB.displayName(e))}</div>`;
    }

    h += `<div class="detail-actions">
      <button class="btn" data-act="edit">Edit</button>`;
    if (DB.isArmor(t) && DB.genderPair(t, e.equip_id)) h += `<button class="btn" data-act="gender" title="Swap to the opposite-gender counterpart">♂ ⇄ ♀</button>`;
    h += `<button class="btn danger" data-act="clear">Clear</button></div>`;

    h += `<div class="detail-section-title">Slot</div>`;
    h += row("Box position", `#${selected}`);
    if (!known) h += `<div class="detail-note">This id isn't in the equipment tables — it is kept in place exactly as saved.</div>`;

    if (t !== 6 && !DB.isPalico(t)) {
      const max = DB.maxLevel(t, e.equip_id);
      h += row("Level", max > 1 ? `LV ${e.level + 1} / ${max}` : "LV 1");
    }
    if (rar > 0) h += row("Rarity", `<span class="rarity-badge rarity-${rar}">${DB.rarityLabel(rar)}</span>`, true);
    if (DB.isArmor(t)) {
      const g = DB.genderOf(t, e.equip_id);
      h += row("Gender", g === 0 ? "Male" : g === 1 ? "Female" : "Both");
    }

    // Talisman rolls
    if (t === 6 && e.talisman) {
      h += `<div class="detail-section-title">Talisman skills</div>`;
      let any = false;
      [[e.talisman.skill1_id, e.talisman.skill1_pts], [e.talisman.skill2_id, e.talisman.skill2_pts]]
        .forEach(([id, pts]) => {
          if (!id || !pts) return;
          any = true;
          h += row(DB.skillName(id), signed(pts), true);
        });
      if (!any) h += `<div class="detail-note">No skills rolled.</div>`;
    }

    // Decorations and what they contribute. Palico gear can never take any, so
    // it gets no section rather than an empty one.
    // Kinsect (Insect Glaive)
    if (DB.isIG(t) && e.kinsect_id) {
      const kd = DB.kinsect(e.kinsect_id);
      const st = e.kinsect_stats || DB.defaultKinsectStats(e.kinsect_id);
      h += `<div class="detail-section-title">Kinsect</div>`;
      if (kd) {
        h += `<div class="ks-name">${esc(kd.n)} <span class="ks-type">(${esc(kd.t)})</span></div>`;
        h += EDIT.radarSvg(st);
        const els = DB.ksElements(st);
        if (els.length) h += `<div class="ks-elements">` + els.map(el =>
          `<span class="ks-el" style="color:${el.color}">${el.name} Lv.${el.lv + 1}</span>`).join("") + `</div>`;
        h += row("Kinsect level", `${DB.ksLevel(st, e.kinsect_id)} / ${DB.KS_MAX_LEVEL}`);
        h += row("Power", String(DB.powerStat(st[DB.KS.powerLv])));
        h += row("Weight", String(DB.weightStat(st[DB.KS.weightLv])));
        h += row("Speed", String(DB.speedStat(st[DB.KS.speedLv])));
        if (kd.ks) h += row("Kinsect skills", esc(kd.ks.join(", ")));
        if (kd.es) h += row("Extract skills", esc(kd.es.join(", ")));
      } else h += `<div class="detail-note">Unknown kinsect #${e.kinsect_id}.</div>`;
    }

    // Bowgun attachments
    if (DB.isBowgun(t)) {
      const bg = e.bowgun_attachments || { mod_bit: 0, variable_zoom: false };
      h += `<div class="detail-section-title">Attachments</div>`;
      h += row("Mod", DB.bowgunModLabel(bg.mod_bit, DB.isLBG(t)));
      h += row("Scope", bg.variable_zoom ? "Variable Zoom" : "Fixed Zoom");
    }

    if (!DB.isPalico(t)) {
      const cap = DB.entryDecoSlots(e);
      h += `<div class="detail-section-title">Decorations</div>`;
      if (!cap) h += `<div class="detail-note">No decoration slots.</div>`;
      else {
        const used = DB.decoUsed(e.decorations);
        h += row("Deco slots", "●".repeat(Math.min(used, cap)) + "○".repeat(Math.max(0, cap - used)), true);
        for (let i = 0; i < 3; i++) {
          const d = e.decorations[i];
          if (!d && i >= cap) continue;
          h += row(`Slot ${i + 1}`, d ? esc(DB.decoName(d)) : "—");
        }
        const skills = DB.decoSkills(e.decorations);
        if (skills.size) {
          h += `<div class="detail-section-title">Skills from decorations</div>`;
          Array.from(skills.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .forEach(([name, pts]) => { h += row(esc(name), signed(pts), true); });
        }
      }
    }

    panel.innerHTML = h;
    panel.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "edit") openEditor(selected);
      else if (act === "clear") {
        BOX.clear(kind, selected);
        const f = selected;
        selected = null;
        repaint(f); renderDetail(); updateCapacity();
      } else if (act === "gender") {
        const other = DB.genderPair(t, e.equip_id);
        if (!other) return;
        const next = BOX.cloneEntry(e);
        next.equip_id = other;
        next.level = Math.min(next.level, DB.maxLevel(t, other) - 1);
        BOX.set(kind, selected, next);
        repaint(selected); renderDetail();
      }
    }));
  }
  const signed = n => `<span class="${n > 0 ? "pos" : n < 0 ? "neg" : ""}">${n > 0 ? "+" : ""}${n}</span>`;
  const row = (k, v, raw) =>
    `<div class="stat-row"><span class="k">${raw ? k : esc(k)}</span><span class="v">${raw ? v : esc(v)}</span></div>`;

  // ── Editing ────────────────────────────────────────────────────────────
  function openEditor(f) {
    EDIT.open(kind, f, BOX.get(kind, f), (at, entry) => {
      BOX.set(kind, at, entry);
      selected = entry ? at : null;
      cursor = at;
      repaint(at);
      renderDetail();
      updateCapacity();
    });
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  const NAV = {
    ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS,
    a: -1, d: 1, w: -COLS, s: COLS,
  };
  function onKey(ev) {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement ||
        ev.target instanceof HTMLTextAreaElement) return;
    if (document.querySelector(".modal:not(.hidden)")) return;
    const k = ev.key;

    if (k === "q" || k === "Q") { goPage(page - 1); return; }
    if (k === "e" || k === "E") { goPage(page + 1); return; }
    if (ev.shiftKey && (k === "s" || k === "S")) { toggleMultiSelect(); return; }

    const step = NAV[k] !== undefined ? NAV[k] : NAV[k.toLowerCase()];
    if (step !== undefined && !(ev.shiftKey && k.toLowerCase() === "s")) {
      ev.preventDefault();
      const from = cursor === null ? page * PAGE : cursor;
      const next = Math.max(0, Math.min(BOX.sizeOf(kind) - 1, from + step));
      cursor = next;
      showIndex(next);
      if (!multiSelect) select(next); else paintPage();
      return;
    }
    if (k === "Enter" && cursor !== null) { ev.preventDefault(); openEditor(cursor); return; }
    if (k === "Delete" && cursor !== null && !multiSelect && BOX.get(kind, cursor)) {
      BOX.clear(kind, cursor);
      if (selected === cursor) selected = null;
      repaint(cursor); renderDetail(); updateCapacity();
    }
  }

  // ── Confirm dialog ─────────────────────────────────────────────────────
  let confirmYes = null;
  function confirm(title, html, onYes) {
    $("confirmTitle").textContent = title;
    $("confirmBody").innerHTML = `<p>${html}</p>`;
    confirmYes = onYes;
    $("confirmModal").classList.remove("hidden");
  }

  // ── Init ───────────────────────────────────────────────────────────────
  function init(opts) {
    toastFn = (opts && opts.toast) || (() => {});
    buildGrid();

    $("grid").addEventListener("click", ev => {
      const el = ev.target.closest(".box-cell");
      if (!el) return;
      const f = flat(Number(el.dataset.i));
      if (f < BOX.sizeOf(kind)) onCellClick(f, ev);
    });
    $("grid").addEventListener("dblclick", ev => {
      const el = ev.target.closest(".box-cell");
      if (!el || multiSelect) return;
      const f = flat(Number(el.dataset.i));
      if (f < BOX.sizeOf(kind)) openEditor(f);
    });

    $("boxSwitch").querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => setKind(b.dataset.box)));
    $("prevPage").addEventListener("click", () => goPage(page - 1));
    $("nextPage").addEventListener("click", () => goPage(page + 1));
    $("selectMode").addEventListener("click", toggleMultiSelect);

    // Sorting
    const sortKey = $("sortKey"), sortDir = $("sortDir"), applySort = $("applySort");
    let dir = "asc";
    const syncSort = () => {
      const on = !!sortKey.value;
      sortDir.disabled = !on;
      applySort.disabled = !on;
    };
    sortKey.addEventListener("change", syncSort);
    sortDir.addEventListener("click", () => {
      dir = dir === "asc" ? "desc" : "asc";
      sortDir.textContent = dir === "asc" ? "Asc ↑" : "Desc ↓";
    });
    applySort.addEventListener("click", () => {
      if (!sortKey.value) return;
      const go = () => {
        const n = BOX.sortBox(kind, sortKey.value, dir);
        page = 0;
        selection.clear(); selected = null; cursor = null; anchor = null;
        paintPage(); renderDetail(); updateHints();
        toastFn(`Sorted ${n} item(s).`);
      };
      if (BOX.settings.confirmSort) {
        confirm("Confirm sort",
          "Sorting compacts every filled slot to the front of the box in the chosen order. You can undo it once.",
          go);
      } else go();
    });
    $("undoSort").addEventListener("click", () => {
      if (BOX.undoSort()) {
        page = 0; selected = null; cursor = null;
        paintPage(); renderDetail(); updateHints();
        toastFn("Sort undone.");
      }
    });

    // Clipboard
    $("pasteBtn").addEventListener("click", () => {
      const n = BOX.pasteClipboard(kind, cursor === null ? 0 : cursor);
      paintPage(); updateCapacity();
      toastFn(n ? `Pasted ${n} item(s).` : "No empty slots to paste into.");
    });
    $("clearClipBtn").addEventListener("click", () => {
      BOX.clearClipboard(); syncClipboard(); toastFn("Saved selection cleared.");
    });

    $("clearBoxBtn").addEventListener("click", () => {
      const used = BOX.usedCount(kind);
      if (!used) { toastFn("This box is already empty."); return; }
      confirm("Empty this box?",
        `Remove all <strong>${used}</strong> item(s) from the ${kind === "palico" ? "Palico" : "hunter"} box? This cannot be undone.`,
        () => {
          for (let i = 0; i < BOX.sizeOf(kind); i++) BOX.clear(kind, i);
          selected = null; cursor = null; selection.clear();
          paintPage(); renderDetail();
          toastFn("Box emptied.");
        });
    });

    // Confirm dialog wiring
    $("confirmOk").addEventListener("click", () => {
      $("confirmModal").classList.add("hidden");
      const fn = confirmYes; confirmYes = null;
      if (fn) fn();
    });
    $("confirmCancel").addEventListener("click", () => {
      $("confirmModal").classList.add("hidden"); confirmYes = null;
    });
    $("confirmModal").addEventListener("click", ev => {
      if (ev.target.id === "confirmModal" && BOX.settings.backdropClose) {
        $("confirmModal").classList.add("hidden"); confirmYes = null;
      }
    });

    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      if (!$("confirmModal").classList.contains("hidden")) {
        $("confirmModal").classList.add("hidden"); confirmYes = null; return;
      }
      if (EDIT.isOpen()) { EDIT.tryClose(); return; }
      if (pendingOp) { pendingOp = null; paintPage(); updateHints(); return; }
      document.querySelectorAll(".modal:not(.hidden)").forEach(m => m.classList.add("hidden"));
    });

    // Grid sizing is entirely CSS (container query units on .box-grid-area) —
    // measuring the chrome from JS and writing a custom property back fed the
    // ResizeObserver its own output and hung the page.
    BOX.on("change", () => { updateCapacity(); });

    syncSort();
    syncClipboard();
    paintPage();
    renderDetail();
    updateHints();
  }

  // Called after a whole-box change (load, import, reset).
  function refresh() {
    page = 0;
    selected = null; cursor = null; anchor = null;
    selection.clear(); pendingOp = null;
    paintPage(); renderDetail(); updateHints(); syncClipboard();
  }

  return { init, refresh, paintPage, confirm, get kind() { return kind; } };
})();
