/*
 * Regenerates docs/data/*.js from the mhgu-editor repo's data assets.
 *
 *   node scripts/build-data.mjs "C:/Coding Repos/mhgu-editor" [--tracker <path>]
 *
 * The editor's assets are the same ones its Equipment Box UI reads, so the ids
 * here are the game's own and line up 1:1 with the collection tracker's catalog
 * (verified: Head 1 = Leather Headgear, Great Sword 11 = Iron Sword, …). That is
 * what lets the tracker-save import be a straight id mapping.
 *
 * Nothing from the editor is copied verbatim — only the fields this app needs,
 * re-emitted in its own schema. See NOTICE.md for attribution.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "docs", "data");

const argv = process.argv.slice(2);
const positional = argv.filter(a => !a.startsWith("--"));
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

const EDITOR = positional[0];
if (!EDITOR) {
  console.error('Usage: node scripts/build-data.mjs "<path to mhgu-editor>" [--tracker <path to mhgu-collection-tracker>]');
  process.exit(1);
}
const ASSETS = join(EDITOR, "src", "assets");
const TRACKER = flag("--tracker") || resolve(EDITOR, "..", "mhgu-collection-tracker");

const read = name => JSON.parse(readFileSync(join(ASSETS, name), "utf8"));

// ── Source data ────────────────────────────────────────────────────────────
const ARMOR = read("armor.json");                    // {Head:{id:name},…}
const ARMOR_RARITY = read("armor_rarity.json");
const ARMOR_SLOTS = read("armor_slots.json");        // keyed by equip_type
const WEAPONS = read("weapons.json");                // {"Great Sword":{id:name},…}
const WEAPON_RARITY = read("weapon_rarity.json");
const WEAPON_LEVELS = read("weapon_levels.json");    // [type][id][level] = {name, slots}
const PALICO_WEAPONS = read("palico_weapons.json");
const PALICO_HEAD = read("palico_head.json");
const PALICO_ARMOR = read("palico_armor.json");
const PALICO_RARITY = read("palico_rarity.json");    // {Weapon,Head,Armor}
const TALISMAN_NAMES = read("talisman.json");
const CHARM_TABLE = read("talisman_charm_table.json");
const SKILLS = read("skills.json");
const ITEMS = read("items.json");
const DECORATIONS = read("mhgu_decorations.json");
const GENDER_MAP = read("gender_armor_map.json");
const NON_CRAFTABLE = read("non_craftable_armor.json");
const MHGU_ARMORS = read("mhgu_armors.json");

// Armor upgrade levels come from the game's own tables by way of the collection
// tracker's generator — more accurate than deriving them from rarity.
function readArmorLevels() {
  const path = join(TRACKER, "docs", "data", "armor_levels.js");
  const src = readFileSync(path, "utf8");
  const open = src.indexOf("{");
  const close = src.lastIndexOf("}");
  return JSON.parse(src.slice(open, close + 1));
}
const ARMOR_LEVELS = readArmorLevels();

// ── Type tables ────────────────────────────────────────────────────────────
const ARMOR_SLOT_KEY = { 1: "Head", 2: "Chest", 3: "Arms", 4: "Waist", 5: "Legs" };
const ARMOR_LEVEL_KEY = { 1: "head", 2: "chest", 3: "arms", 4: "waist", 5: "legs" };
// index = equip_type - 7; the null at index 5 is why equip_type 12 does not exist.
const WEAPON_TYPE_NAMES = [
  "Great Sword", "Sword & Shield", "Hammer", "Lance", "Heavy Bowgun", null,
  "Light Bowgun", "Long Sword", "Switch Axe", "Gunlance", "Bow", "Dual Blades",
  "Hunting Horn", "Insect Glaive", "Charge Blade",
];
const WEAPON_TYPES = WEAPON_TYPE_NAMES
  .map((name, i) => (name ? [i + 7, name] : null))
  .filter(Boolean);
const PALICO_SOURCE = { 22: [PALICO_WEAPONS, "Weapon"], 23: [PALICO_HEAD, "Head"], 24: [PALICO_ARMOR, "Armor"] };

const num = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));

// ── Names / rarity ─────────────────────────────────────────────────────────
const names = { a: {}, w: {}, p: {}, t: num(TALISMAN_NAMES) };
const rarity = { a: {}, w: {}, p: {} };

for (const [type, key] of Object.entries(ARMOR_SLOT_KEY)) {
  names.a[type] = num(ARMOR[key]);
  rarity.a[type] = num(ARMOR_RARITY[key] || {});
}
for (const [type, key] of WEAPON_TYPES) {
  // weapons.json also carries a "Tonfa" key — an MHXX weapon class with no MHGU
  // equip_type. It is not in WEAPON_TYPE_NAMES, so it never gets read here.
  names.w[type] = num(WEAPONS[key] || {});
  rarity.w[type] = num(WEAPON_RARITY[key] || {});
}
for (const [type, [db, rarKey]] of Object.entries(PALICO_SOURCE)) {
  names.p[type] = num(db);
  rarity.p[type] = num(PALICO_RARITY[rarKey] || {});
}
// Rarity 0 means "unknown" and is the runtime default — drop it rather than ship it.
for (const kind of ["a", "w", "p"])
  for (const type of Object.keys(rarity[kind]))
    for (const [id, r] of Object.entries(rarity[kind][type]))
      if (!r) delete rarity[kind][type][id];

// ── Deco slots and upgrade levels ──────────────────────────────────────────
// Armor: a flat count per piece. Weapons: the count changes as the weapon is
// upgraded, so store it run-length encoded — only ~1900 of ~10900 levels differ
// from the one before, which is what keeps this file small.
const slots = { a: {}, w: {} };
const levels = { aMax: {}, wMax: {}, wNames: {} };

for (const type of Object.keys(ARMOR_SLOT_KEY)) {
  slots.a[type] = {};
  for (const [id, n] of Object.entries(ARMOR_SLOTS[type] || {})) if (n) slots.a[type][id] = n;
  levels.aMax[type] = {};
  for (const [id, max] of Object.entries(ARMOR_LEVELS[ARMOR_LEVEL_KEY[type]] || {}))
    if (max > 1) levels.aMax[type][id] = max;
}

for (const [type] of WEAPON_TYPES) {
  slots.w[type] = {};
  levels.wMax[type] = {};
  levels.wNames[type] = {};
  const trees = WEAPON_LEVELS[type] || {};
  for (const [id, lvMap] of Object.entries(trees)) {
    const lvs = Object.keys(lvMap).map(Number).sort((a, b) => a - b);
    if (!lvs.length) continue;
    levels.wMax[type][id] = lvs[lvs.length - 1];

    const runs = [];
    const renames = [];
    let prevSlots = null, prevName = null;
    for (const lv of lvs) {
      const e = lvMap[String(lv)];
      if (e.slots !== prevSlots) { runs.push([lv, e.slots]); prevSlots = e.slots; }
      // LV1's name is the base name already in EQ_NAMES; record only the renames.
      if (prevName !== null && e.name !== prevName) renames.push([lv, e.name]);
      prevName = e.name;
    }
    if (runs.length && !(runs.length === 1 && runs[0][1] === 0)) slots.w[type][id] = runs;
    if (renames.length) levels.wNames[type][id] = renames;
  }
}

// ── Skills, decorations, charm tables ──────────────────────────────────────
// A decoration's slot cost is encoded in its own name ("Antidote Jwl 1"), which
// is how the editor derives it too. The three "Dummy Jwl" items have no entry in
// the Kiranico decoration list and are carried with no skills.
const decoByName = new Map(DECORATIONS.decorations.map(d => [d.name, d]));
const deco = {};
for (const [id, name] of Object.entries(ITEMS)) {
  const m = /Jwl ([123])$/.exec(name);
  if (!m) continue;
  const cost = Number(m[1]);
  const d = decoByName.get(name);
  const skill = s => (s && s.points ? [s.name, s.points] : null);
  const primary = d ? skill(d.primary_skill) : null;
  const secondary = d ? skill(d.secondary_skill) : null;
  deco[id] = [name, cost, primary, secondary];
}

const skillsOut = { sk: num(SKILLS), deco, charm: CHARM_TABLE };

// ── Gender ─────────────────────────────────────────────────────────────────
// Resolved here rather than at runtime: the editor's chain reaches into
// mhgu_armors.json (2.5 MB) and a keyword heuristic. Precomputing it collapses
// all of that into a small id → 0|1 map plus the male↔female pairing.
const MALE_KEYWORDS = {
  1: ["Helm"], 2: ["Mail"], 3: ["Vambraces", "Gauntlets", "Braces"],
  4: ["Faulds", "Tassets", "Coil"], 5: ["Greaves", "Shinguards"],
};
const FEMALE_KEYWORDS = {
  1: ["Cap"], 2: ["Vest", "Jacket"], 3: ["Guards", "Gloves", "Sleeves"],
  4: ["Coat"], 5: ["Leggings", "Tights", "Boots"],
};
const GENDER_WORD = { Male: 0, Female: 1, Both: 2 };

const kiranicoBySlotName = new Map();
const kiranicoByName = new Map();
for (const p of MHGU_ARMORS.armor_pieces) {
  const g = GENDER_WORD[p.gender];
  if (g === undefined) continue;
  kiranicoBySlotName.set(`${p.slot_type}|${p.name}`, g);
  if (!kiranicoByName.has(p.name)) kiranicoByName.set(p.name, g);
  else if (kiranicoByName.get(p.name) !== g) kiranicoByName.set(p.name, 2);
}

// The editor keys its gender map by equip_id alone, but ids are only unique
// within a slot — Head 76 and Legs 76 are different pieces. Key everything by
// type so the two cannot overwrite each other.
const genderById = new Map();
for (const set of GENDER_MAP) {
  for (const p of set.pairs) {
    genderById.set(p.male_id, 0);
    genderById.set(p.female_id, 1);
  }
}
for (const e of NON_CRAFTABLE.male_pub_sets) genderById.set(e.equip_id, 0);
for (const e of NON_CRAFTABLE.female_pub_sets) genderById.set(e.equip_id, 1);

const gender = {};
const pair = {};
for (const [type, key] of Object.entries(ARMOR_SLOT_KEY)) {
  gender[type] = {};
  pair[type] = {};
  const inSlot = ARMOR[key];
  for (const [rawId, name] of Object.entries(inSlot)) {
    const id = Number(rawId);
    let g = genderById.get(id);
    if (g === undefined) g = kiranicoBySlotName.get(`${key}|${name}`);
    if (g === undefined) g = kiranicoByName.get(name);
    if (g === undefined) {
      if ((MALE_KEYWORDS[type] || []).some(k => new RegExp(`\\b${k}\\b`, "i").test(name))) g = 0;
      else if ((FEMALE_KEYWORDS[type] || []).some(k => new RegExp(`\\b${k}\\b`, "i").test(name))) g = 1;
    }
    if (g === 0 || g === 1) gender[type][id] = g;   // neutral is the runtime default
  }
  // A pairing only holds if both halves exist in this slot.
  for (const set of GENDER_MAP) {
    for (const p of set.pairs) {
      if (inSlot[p.male_id] === undefined || inSlot[p.female_id] === undefined) continue;
      pair[type][p.male_id] = p.female_id;
      pair[type][p.female_id] = p.male_id;
    }
  }
}

// ── Emit ───────────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });
const emit = (file, global, value) => {
  const json = JSON.stringify(value);
  writeFileSync(join(OUT, file), `window.${global} = ${json};\n`);
  return json.length;
};

const written = [
  ["names.js", "EQ_NAMES", names],
  ["rarity.js", "EQ_RARITY", rarity],
  ["slots.js", "EQ_SLOTS", slots],
  ["levels.js", "EQ_LEVELS", levels],
  ["skills.js", "EQ_SKILLS", skillsOut],
  ["gender.js", "EQ_GENDER", { g: gender, pair }],
].map(([file, global, value]) => [file, emit(file, global, value)]);

// ── Report ─────────────────────────────────────────────────────────────────
const count = o => Object.values(o).reduce((n, m) => n + Object.keys(m).length, 0);
const kb = n => (n / 1024).toFixed(0) + " KB";
console.log("Wrote docs/data/");
for (const [file, size] of written) console.log(`  ${file.padEnd(12)} ${kb(size).padStart(8)}`);
console.log(`  ${"total".padEnd(12)} ${kb(written.reduce((n, [, s]) => n + s, 0)).padStart(8)}`);
console.log("Entries:");
console.log(`  armor        ${count(names.a)}`);
console.log(`  weapons      ${count(names.w)}`);
console.log(`  palico       ${count(names.p)}`);
console.log(`  talismans    ${Object.keys(names.t).length}`);
console.log(`  decorations  ${Object.keys(deco).length}`);
console.log(`  skills       ${Object.keys(skillsOut.sk).length}`);
console.log(`  gendered     ${count(gender)} (${count(pair)} paired)`);

// Cross-checks. These are the assumptions the app is built on; if the upstream
// data shifts under us they should fail loudly here rather than silently render
// wrong names in the box.
const checks = [
  ["armor Head 1", names.a[1][1], "Leather Headgear"],
  ["armor Head 68", names.a[1][68], "Obituary Vertex"],
  ["armor Head 70", names.a[1][70], "Butterfly Vertex"],
  ["weapon GS 1", names.w[7][1], "Petrified Blade"],
  ["weapon GS 11", names.w[7][11], "Iron Sword"],
  ["palico weapon 1", names.p[22][1], "F Bone Wedge"],
  ["talisman 1", names.t[1], "Pawn Talisman"],
  ["no equip_type 12", names.w[12], undefined],
];
let failed = 0;
for (const [label, got, want] of checks) {
  if (got !== want) { console.error(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); failed++; }
}
console.log(failed ? `${failed} check(s) FAILED` : `All ${checks.length} checks passed.`);
if (failed) process.exit(1);
