/* MHGU Equipment Box — data lookups. No state, no DOM.
 *
 * Everything here reads the window.EQ_* globals emitted by scripts/build-data.mjs
 * and mirrors the save editor's own helpers (src/types/data.ts) so that a slot
 * shows the same name, rarity and slot count as it would in the editor.
 */
window.DB = (function () {
  "use strict";
  const NAMES = window.EQ_NAMES, RARITY = window.EQ_RARITY, SLOTS = window.EQ_SLOTS;
  const LEVELS = window.EQ_LEVELS, SK = window.EQ_SKILLS, GENDER = window.EQ_GENDER;

  // ── Equipment types ────────────────────────────────────────────────────
  // 0 empty · 1-5 armor · 6 talisman · 7-21 weapons (12 unused) · 22-24 Palico.
  const TYPE_NAME = {
    0: "—", 1: "Head", 2: "Chest", 3: "Arms", 4: "Waist", 5: "Legs", 6: "Talisman",
    7: "Great Sword", 8: "Sword & Shield", 9: "Hammer", 10: "Lance", 11: "Heavy Bowgun",
    13: "Light Bowgun", 14: "Long Sword", 15: "Switch Axe", 16: "Gunlance", 17: "Bow",
    18: "Dual Blades", 19: "Hunting Horn", 20: "Insect Glaive", 21: "Charge Blade",
    22: "Palico Weapon", 23: "Palico Helmet", 24: "Palico Armor",
  };
  const TYPE_SLUG = {
    1: "armor_head", 2: "armor_body", 3: "armor_arms", 4: "armor_waist", 5: "armor_legs",
    6: "talisman",
    7: "great_sword", 8: "sword_and_shield", 9: "hammer", 10: "lance", 11: "heavy_bowgun",
    13: "light_bowgun", 14: "long_sword", 15: "switch_axe", 16: "gunlance", 17: "bow",
    18: "dual_blades", 19: "hunting_horn", 20: "insect_glaive", 21: "charge_blade",
    22: "knife", 23: "palico_head", 24: "palico_body",
  };
  const ARMOR_TYPES = [1, 2, 3, 4, 5];
  // The order the editor's type dropdown uses — in-game weapon order, not numeric.
  const WEAPON_TYPES = [7, 14, 8, 18, 9, 19, 10, 16, 15, 21, 20, 13, 11, 17];
  const PALICO_TYPES = [22, 23, 24];
  const PLAYER_TYPES = ARMOR_TYPES.concat([6], WEAPON_TYPES);

  // In-game box sort order (EquipBox.tsx TYPE_SORT_ORDER).
  const SORT_POS = {
    7: 0, 14: 1, 8: 2, 18: 3, 9: 4, 19: 5,
    10: 6, 16: 7, 15: 8, 21: 9, 20: 10, 13: 11, 11: 12, 17: 13,
    1: 14, 2: 15, 3: 16, 4: 17, 5: 18,
    6: 19,
    22: 20, 23: 21, 24: 22,
  };

  const isArmor = t => t >= 1 && t <= 5;
  const isWeapon = t => t >= 7 && t <= 21 && t !== 12;
  const isPalico = t => t >= 22 && t <= 24;
  const isTalisman = t => t === 6;
  const typeName = t => TYPE_NAME[t] || `Type ${t}`;
  const typeSortPos = t => (SORT_POS[t] !== undefined ? SORT_POS[t] : 99);

  // Which name/rarity bucket a type lives in.
  function bucket(t) {
    if (isArmor(t)) return "a";
    if (isWeapon(t)) return "w";
    if (isPalico(t)) return "p";
    return null;
  }
  const nameTable = t => (bucket(t) ? NAMES[bucket(t)][t] || {} : {});

  // ── Names ──────────────────────────────────────────────────────────────
  function baseName(type, id) {
    if (isTalisman(type)) return NAMES.t[id] || `Talisman R${id}`;
    const n = nameTable(type)[id];
    return n !== undefined ? n : null;
  }
  // Weapons are renamed part-way up their upgrade tree, so the name shown depends
  // on the level. `level` is 0-based, as stored.
  function nameAtLevel(type, id, level) {
    const base = baseName(type, id);
    if (base === null || !isWeapon(type)) return base;
    const renames = (LEVELS.wNames[type] || {})[id];
    if (!renames) return base;
    let name = base;
    const lv1 = (level || 0) + 1;
    for (let i = 0; i < renames.length; i++) if (renames[i][0] <= lv1) name = renames[i][1];
    return name;
  }
  // Every name a weapon goes by, for the search picker.
  function chainName(type, id) {
    const base = baseName(type, id);
    if (base === null || !isWeapon(type)) return base;
    const renames = (LEVELS.wNames[type] || {})[id];
    if (!renames || !renames.length) return base;
    return [base].concat(renames.map(r => r[1])).join(" / ");
  }
  // An id we have no name for still occupies its slot — show it rather than drop it.
  const unknownName = (type, id) => `${typeName(type)} #${id}`;
  function displayName(e) {
    if (!e || !e.equip_type) return "";
    const n = nameAtLevel(e.equip_type, e.equip_id, e.level);
    return n === null ? unknownName(e.equip_type, e.equip_id) : n;
  }
  function transmogName(e) {
    if (!e || !e.transmog_id) return "";
    const n = nameAtLevel(e.equip_type, e.transmog_id, e.transmog_level);
    return n === null ? unknownName(e.equip_type, e.transmog_id) : n;
  }
  const isKnown = (type, id) => baseName(type, id) !== null;
  const isTransmogged = e => !!e && isArmor(e.equip_type) && e.transmog_id !== 0;

  // ── Rarity ─────────────────────────────────────────────────────────────
  // Talismans are the odd one out: the equip_id *is* the rarity (1-10).
  function rarityOf(e) {
    if (!e || !e.equip_type) return 0;
    if (isTalisman(e.equip_type)) return Math.min(10, Math.max(0, e.equip_id));
    const b = bucket(e.equip_type);
    if (!b) return 0;
    return (RARITY[b][e.equip_type] || {})[e.equip_id] || 0;
  }
  const rarityLabel = r => (r >= 11 ? "X" : String(r));

  // ── Icons ──────────────────────────────────────────────────────────────
  const iconSuffix = r => (r >= 11 ? "_rX" : r >= 1 ? "_r" + r : "");
  function iconPath(type, rarity) {
    const slug = TYPE_SLUG[type];
    if (!slug) return null;
    return `assets/icons/icon_${slug}${iconSuffix(rarity || 0)}.png`;
  }

  // ── Upgrade levels ─────────────────────────────────────────────────────
  // Returns the number of levels the piece has (1 = no upgrades). Palico gear
  // and talismans have none.
  function maxLevel(type, id) {
    if (isArmor(type)) return (LEVELS.aMax[type] || {})[id] || 1;
    if (isWeapon(type)) return (LEVELS.wMax[type] || {})[id] || 1;
    return 1;
  }

  // ── Decoration slots ───────────────────────────────────────────────────
  // Armor carries a flat count. Weapons gain slots as they upgrade, stored
  // run-length encoded as [[fromLevel, slots], …]. Talismans store the count on
  // the entry itself, since it is rolled rather than fixed.
  function decoSlots(type, id, level1) {
    if (isArmor(type)) return (SLOTS.a[type] || {})[id] || 0;
    if (isWeapon(type)) {
      const runs = (SLOTS.w[type] || {})[id];
      if (!runs) return 0;
      const lv = level1 && level1 > 0 ? level1 : Infinity;
      let n = 0;
      for (let i = 0; i < runs.length; i++) { if (runs[i][0] > lv) break; n = runs[i][1]; }
      return n;
    }
    return 0;
  }
  function entryDecoSlots(e) {
    if (!e || !e.equip_type) return 0;
    if (isTalisman(e.equip_type)) return e.deco_slots || 0;
    return decoSlots(e.equip_type, e.equip_id, (e.level || 0) + 1);
  }

  // ── Decorations ────────────────────────────────────────────────────────
  // deco[itemId] = [name, slotCost, primarySkill|null, secondarySkill|null]
  // where a skill is [name, points].
  const decoInfo = itemId => SK.deco[itemId] || null;
  const decoName = itemId => (SK.deco[itemId] ? SK.deco[itemId][0] : "");
  const decoSlotCost = itemId => (SK.deco[itemId] ? SK.deco[itemId][1] : 0);
  // Slots consumed by what is currently socketed.
  function decoUsed(decorations) {
    let n = 0;
    for (let i = 0; i < decorations.length; i++) n += decoSlotCost(decorations[i]);
    return n;
  }
  // Every decoration, cheapest-fitting first — the picker filters this by budget.
  function decoList(maxCost) {
    const out = [];
    for (const id in SK.deco) {
      const d = SK.deco[id];
      if (maxCost !== undefined && d[1] > maxCost) continue;
      out.push([Number(id), d[0]]);
    }
    out.sort((a, b) => a[1].localeCompare(b[1]));
    return out;
  }
  // Skill points a set of decorations contributes, merged by skill name.
  function decoSkills(decorations) {
    const merged = new Map();
    for (const itemId of decorations) {
      const d = SK.deco[itemId];
      if (!d) continue;
      for (const s of [d[2], d[3]]) if (s) merged.set(s[0], (merged.get(s[0]) || 0) + s[1]);
    }
    return merged;
  }

  // ── Skills ─────────────────────────────────────────────────────────────
  const skillName = id => SK.sk[id] || (id ? `Skill #${id}` : "");
  function skillList() {
    const out = [];
    for (const id in SK.sk) out.push([Number(id), SK.sk[id]]);
    out.sort((a, b) => a[1].localeCompare(b[1]));
    return out;
  }

  // ── Talismans ──────────────────────────────────────────────────────────
  // A charm's equip_id (1-10) maps to one of four tiers, each with its own table
  // of legal skill/point ranges per slot. Same tables the editor rolls against.
  const TALISMAN_TIER = [null, "mystery", "mystery", "shining", "shining",
    "timeworn", "timeworn", "timeworn", "enduring", "enduring", "enduring"];
  function charmRange(equipId, skillId, slot) {
    if (skillId <= 0) return [0, 0];
    const tier = TALISMAN_TIER[equipId];
    if (!tier) return [0, 0];
    const table = SK.charm[tier];
    if (!table || skillId >= table.length) return [0, 0];
    const e = table[skillId];
    return slot === 1 ? [e[0], e[1]] : [e[2], e[3]];
  }
  function clampPts(pts, range) {
    const min = range[0], max = range[1];
    if (min === 0 && max === 0) return 0;
    if (pts === 0 && min > 0) return min;
    return Math.min(max, Math.max(min, pts));
  }
  // Skills that can legally appear in a given slot for a given charm rarity.
  function charmSkills(equipId, slot) {
    const tier = TALISMAN_TIER[equipId];
    const out = [];
    if (!tier) return out;
    const table = SK.charm[tier];
    if (!table) return out;
    for (let id = 1; id < table.length; id++) {
      const r = charmRange(equipId, id, slot);
      if (r[0] === 0 && r[1] === 0) continue;
      out.push([id, skillName(id)]);
    }
    out.sort((a, b) => a[1].localeCompare(b[1]));
    return out;
  }
  const talismanList = () => Object.keys(NAMES.t).map(id => [Number(id), NAMES.t[id]]);

  // ── Gender ─────────────────────────────────────────────────────────────
  // 0 male, 1 female, 2 neutral (the default — only non-neutral is stored).
  function genderOf(type, id) {
    if (!isArmor(type)) return 2;
    const g = (GENDER.g[type] || {})[id];
    return g === undefined ? 2 : g;
  }
  function genderPair(type, id) {
    if (!isArmor(type)) return 0;
    return (GENDER.pair[type] || {})[id] || 0;
  }

  // ── Pickers ────────────────────────────────────────────────────────────
  // {id: label} for the typeahead. Weapons use their whole rename chain so that
  // searching for a final-form name finds the tree that becomes it.
  function pickerDb(type) {
    const table = nameTable(type);
    const out = {};
    if (isWeapon(type)) for (const id in table) out[id] = chainName(type, Number(id));
    else for (const id in table) out[id] = table[id];
    return out;
  }

  return {
    TYPE_NAME, TYPE_SLUG, ARMOR_TYPES, WEAPON_TYPES, PALICO_TYPES, PLAYER_TYPES,
    isArmor, isWeapon, isPalico, isTalisman, typeName, typeSortPos, bucket,
    baseName, nameAtLevel, chainName, displayName, transmogName, unknownName,
    isKnown, isTransmogged,
    rarityOf, rarityLabel, iconPath,
    maxLevel, decoSlots, entryDecoSlots,
    decoInfo, decoName, decoSlotCost, decoUsed, decoList, decoSkills,
    skillName, skillList,
    charmRange, clampPts, charmSkills, talismanList,
    genderOf, genderPair, pickerDb,
  };
})();
