'use strict';

/* ============================================================
   Stowed — home inventory. Local-only (IndexedDB), backup files.
   ============================================================ */

const APP_VERSION = '0.4.0';
const LIMBO = 'limbo';
const FREQS = [
  ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'],
  ['occasionally', 'Occasionally'], ['rarely', 'Rarely'], ['emergency', 'Emergency'],
];
const FREQ_LABEL = Object.fromEntries(FREQS);
const COLORS = ['rose', 'orange', 'amber', 'lime', 'green', 'teal', 'sky', 'blue', 'violet', 'pink', 'grey'];
const ACCESS = ['normal', 'prime', 'awkward'];
const ACCESS_LABEL = { normal: 'Normal', prime: 'Prime', awkward: 'Awkward' };
const STORAGE_EMOJI = [
  '📦', '🗄️', '🗃️', '📁', '🗂️', '📥', '📤', '🧰', '🧺', '🪣', '🗑️',
  '👜', '🎒', '👝', '👛', '💼', '🧳', '🫙', '🛖',
  '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜',
  '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪', '🔲', '🔳', '⭕',
];
const ROOM_EMOJI = ['🍳', '🛋️', '🛏️', '🛁', '🚿', '🚪', '🧸', '💻', '🧺', '🌱', '🌳', '🏠', '🔺', '🪜', '🎨', '🔧', '📚', '🌿'];
const GROUP_EMOJI = '⧉';

const ICONS = {
  normal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
  prime: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
  awkward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
};

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let idCounter = 0;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + (idCounter++).toString(36);
let orderCounter = 0;
const nextOrder = () => Date.now() * 100 + (orderCounter++ % 100);
const cmpName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

function firstGrapheme(s) {
  s = (s || '').trim();
  if (!s) return '';
  if (window.Intl && Intl.Segmenter) {
    const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)[Symbol.iterator]().next();
    return it.done ? '' : it.value.segment;
  }
  return Array.from(s)[0];
}

function parseTags(s) {
  const out = [];
  for (const t of String(s || '').split(',')) {
    const v = t.trim().toLowerCase().replace(/^#/, '');
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function parseLine(s) {
  s = s.trim();
  if (!s) return null;
  let qty = 1;
  let m = s.match(/^(.*\S)\s+[x×]\s*(\d+)$/i);
  if (m) { s = m[1]; qty = +m[2]; }
  else {
    m = s.match(/^(\d+)\s*[x×]\s+(.+)$/i);
    if (m) { qty = +m[1]; s = m[2].trim(); }
  }
  return { name: s, qty: Math.max(1, qty || 1) };
}

function daysAgo(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 86400000);
}

/* ---------- persistence (IndexedDB) ---------- */
const DB_NAME = 'stowed';
const STORE = 'kv';
let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbPromise;
}
async function idbGet(key) {
  const d = await db();
  return new Promise((res, rej) => {
    const q = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbSet(key, val) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

let state = null;
let saveTimer = null;
let storageOk = true;

function freshState() {
  return {
    schema: 1,
    nodes: {
      [LIMBO]: { id: LIMBO, kind: 'room', system: true, name: 'Limbo', emoji: '🌀', color: 'limbo', access: 'normal', parent: null, order: 0, plan: null },
    },
    items: {},
    dismissed: {},
    settings: Object.assign({}, SETTING_DEFAULTS),
    meta: { lastBackup: null, lastImport: null, created: Date.now() },
  };
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}
async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await idbSet('state', state);
    storageOk = true;
  } catch (e) {
    console.error('Save failed', e);
    if (storageOk) toast('Could not save to this device. Back up now.');
    storageOk = false;
  }
}

/* Make sure loaded/imported data has every field the app expects. */
function normalize(s) {
  s.nodes = s.nodes && typeof s.nodes === 'object' ? s.nodes : {};
  s.items = s.items && typeof s.items === 'object' ? s.items : {};
  s.meta = Object.assign({ lastBackup: null, lastImport: null, created: Date.now() }, s.meta || {});
  // Added in 0.2.0: dismissed suggestions and tag homes. Older data simply gets empty defaults.
  s.dismissed = s.dismissed && typeof s.dismissed === 'object' ? s.dismissed : {};
  // Added in 0.4.0: editable suggestion settings and seasonal items.
  s.settings = normalizeSettings(s.settings);
  if (!s.nodes[LIMBO]) s.nodes[LIMBO] = freshState().nodes[LIMBO];
  const L = s.nodes[LIMBO];
  Object.assign(L, { kind: 'room', system: true, name: 'Limbo', parent: null, plan: null, order: 0, color: 'limbo' });

  for (const [id, n] of Object.entries(s.nodes)) {
    n.id = id;
    if (!['room', 'storage', 'group'].includes(n.kind)) n.kind = 'storage';
    n.name = String(n.name || 'Unnamed');
    if (!ACCESS.includes(n.access)) n.access = 'normal';
    if (typeof n.order !== 'number') n.order = nextOrder();
    n.mobile = !!n.mobile;
    n.isGroup = !!n.isGroup;
    n.homeTags = Array.isArray(n.homeTags) ? parseTags(n.homeTags.join(',')) : [];
    if (n.kind === 'room') { n.parent = null; n.plan = null; if (n.id !== LIMBO && !COLORS.includes(n.color)) n.color = 'grey'; }
    else if (!n.parent || !s.nodes[n.parent]) n.parent = LIMBO;
    if (n.plan && !s.nodes[n.plan]) n.plan = null;
  }
  // A storage or group can't end up inside a logical group or inside itself.
  for (const n of Object.values(s.nodes)) {
    if (n.kind === 'room') continue;
    const p = s.nodes[n.parent];
    if (!p || p.kind === 'group' || within(s, n.parent, n.id)) n.parent = LIMBO;
  }
  const roomIds = new Set(Object.values(s.nodes).filter((n) => n.kind === 'room' && n.id !== LIMBO).map((n) => n.id));
  for (const [id, it] of Object.entries(s.items)) {
    it.id = id;
    it.name = String(it.name || 'Unnamed');
    it.qty = Math.max(1, parseInt(it.qty, 10) || 1);
    it.tags = Array.isArray(it.tags) ? parseTags(it.tags.join(',')) : [];
    it.usage = Array.isArray(it.usage) ? it.usage.filter((r) => roomIds.has(r)) : [];
    if (!FREQ_LABEL[it.freq]) it.freq = null;
    it.season = validSeason(it.season);
    if (!it.parent || !s.nodes[it.parent]) it.parent = LIMBO;
    if (!it.plan || !s.nodes[it.plan] || it.plan === it.parent) it.plan = null;
    if (!it.created) it.created = Date.now();
  }
  return s;
}

function validSeason(se) {
  if (!se || typeof se !== 'object') return null;
  const a = parseInt(se.start, 10), b = parseInt(se.end, 10);
  return a >= 1 && a <= 12 && b >= 1 && b <= 12 ? { start: a, end: b } : null;
}
function normalizeSettings(o) {
  const out = Object.assign({}, SETTING_DEFAULTS);
  if (o && typeof o === 'object') {
    for (const k of ['primeRoomMin', 'primeStorageMin', 'awkwardUpAt']) if (LEVEL_OPTIONS.some(([v]) => v === o[k])) out[k] = o[k];
    const num = (k, lo, hi) => { const n = parseInt(o[k], 10); if (n >= lo && n <= hi) out[k] = n; };
    num('seasonGap', 0, 11); num('createMin', 2, 50); num('oddOneOutMin', 3, 50); num('backupDays', 1, 365);
  }
  return out;
}

function within(s, targetId, ancestorId) {
  let n = s.nodes[targetId];
  const seen = new Set();
  while (n && !seen.has(n.id)) {
    if (n.id === ancestorId) return true;
    seen.add(n.id);
    n = s.nodes[n.parent];
  }
  return false;
}

/* ---------- UI state (per device, not backed up) ---------- */
const ui = {
  view: 'rooms',
  expanded: {},
  pickerExpanded: {},
  search: '',
  select: false,
  selected: new Set(),
  sugScope: null, // null = whole house, or { kind: 'node' | 'item', id }
};
function loadUi() {
  try {
    const raw = localStorage.getItem('stowed-ui');
    if (raw) {
      const o = JSON.parse(raw);
      ui.expanded = o.expanded || {};
      ui.view = o.view || 'rooms';
    }
  } catch (e) { /* storage blocked: defaults are fine */ }
}
function saveUi() {
  try { localStorage.setItem('stowed-ui', JSON.stringify({ expanded: ui.expanded, view: ui.view })); } catch (e) { /* ignore */ }
}

/* ---------- data access ---------- */
let RC = null; // render-time cache

function sortNodes(list) {
  return list.sort((a, b) => (a.id === LIMBO ? -1 : b.id === LIMBO ? 1 : 0) || (a.order - b.order) || cmpName(a, b));
}
function buildIndex() {
  const kids = new Map(), items = new Map(), incItems = new Map(), incNodes = new Map(), count = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const n of Object.values(state.nodes)) {
    push(kids, n.parent, n);
    if (n.plan) push(incNodes, n.plan, n);
  }
  for (const it of Object.values(state.items)) {
    push(items, it.parent, it);
    if (it.plan) push(incItems, it.plan, it);
  }
  for (const v of kids.values()) sortNodes(v);
  for (const v of items.values()) v.sort(cmpName);
  for (const v of incItems.values()) v.sort(cmpName);
  const countOf = (id) => {
    if (count.has(id)) return count.get(id);
    count.set(id, 0); // guard against cycles
    let c = (items.get(id) || []).length;
    for (const k of kids.get(id) || []) c += countOf(k.id);
    count.set(id, c);
    return c;
  };
  for (const id of Object.keys(state.nodes)) countOf(id);
  return { kids, items, incItems, incNodes, count };
}
function kidsOf(pid) {
  if (RC) return RC.kids.get(pid) || [];
  return sortNodes(Object.values(state.nodes).filter((n) => n.parent === pid));
}
function itemsIn(pid) {
  if (RC) return RC.items.get(pid) || [];
  return Object.values(state.items).filter((i) => i.parent === pid).sort(cmpName);
}
function incomingItems(pid) {
  if (RC) return RC.incItems.get(pid) || [];
  return Object.values(state.items).filter((i) => i.plan === pid).sort(cmpName);
}
function incomingNodes(pid) {
  if (RC) return RC.incNodes.get(pid) || [];
  return Object.values(state.nodes).filter((n) => n.plan === pid);
}
function subtreeCount(id) {
  if (RC) return RC.count.get(id) || 0;
  let c = itemsIn(id).length;
  for (const k of kidsOf(id)) c += subtreeCount(k.id);
  return c;
}
function rooms(includeLimbo = true) {
  return kidsOf(null).filter((r) => includeLimbo || r.id !== LIMBO);
}
function roomOf(nodeId) {
  let n = state.nodes[nodeId];
  const seen = new Set();
  while (n && n.parent && !seen.has(n.id)) { seen.add(n.id); n = state.nodes[n.parent]; }
  return n || state.nodes[LIMBO];
}
function pathNodes(nodeId) {
  const out = [];
  let n = state.nodes[nodeId];
  const seen = new Set();
  while (n && !seen.has(n.id)) { seen.add(n.id); out.unshift(n); n = state.nodes[n.parent]; }
  return out;
}
function pathText(nodeId) { return pathNodes(nodeId).map((n) => n.name).join(' › '); }
function isWithin(targetId, ancestorId) { return within(state, targetId, ancestorId); }
function roomVars(room, prefix = '') {
  const c = (room && room.color) || 'grey';
  return `--${prefix}tint:var(--${c}-t);--${prefix}edge:var(--${c}-e)`;
}
function nodeEmoji(n) { return n.kind === 'group' ? (n.emoji || GROUP_EMOJI) : (n.emoji || (n.kind === 'room' ? '🏠' : '📦')); }
function allTags() {
  const m = new Map();
  for (const it of Object.values(state.items)) for (const t of it.tags) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
/* No usage room selected means "used in any room", so it's never missing. */
function needsInfo(it) {
  const miss = [];
  if (!it.tags.length) miss.push('tags');
  if (!it.freq) miss.push('frequency');
  return miss;
}
function usageCompatible(a, b) {
  return !a.length || !b.length || a.some((r) => b.includes(r));
}
const USED_IN_LABEL = 'Used in <span class="note">(none selected = any room)</span>';

/* ---------- commit / undo ---------- */
function commit() { save(); render(); }
function snapshot() { return JSON.stringify({ nodes: state.nodes, items: state.items, dismissed: state.dismissed, settings: state.settings }); }
function restore(snap) {
  const o = JSON.parse(snap);
  state.nodes = o.nodes;
  state.items = o.items;
  state.dismissed = o.dismissed || {};
  state.settings = o.settings || state.settings;
  normalize(state);
  ui.selected.clear();
  commit();
  toast('Undone');
}

/* ---------- mutations ---------- */
function addItems(parentId, lines, extra = {}) {
  const ids = [];
  for (const l of lines) {
    const id = uid();
    state.items[id] = {
      id, name: l.name, qty: l.qty, parent: parentId, plan: null,
      tags: [...(extra.tags || [])], usage: [...(extra.usage || [])], freq: extra.freq || null, created: Date.now(),
    };
    ids.push(id);
  }
  return ids;
}
function addNode(fields) {
  const id = uid();
  state.nodes[id] = Object.assign({
    id, kind: 'storage', name: 'Unnamed', emoji: '', access: 'normal', parent: LIMBO,
    order: nextOrder(), plan: null, mobile: false, isGroup: false, homeTags: [],
  }, fields);
  return id;
}

/* Logical groups need at least 2 items. Returns names of groups removed. */
function dissolveCheck(groupIds) {
  const removed = [];
  for (const gid of groupIds) {
    const g = state.nodes[gid];
    if (!g || g.kind !== 'group') continue;
    const members = itemsIn(gid);
    if (members.length >= 2) continue;
    for (const it of members) { it.parent = g.parent; if (it.plan === it.parent) it.plan = null; }
    for (const it of Object.values(state.items)) if (it.plan === gid) it.plan = null;
    delete state.nodes[gid];
    removed.push(g.name);
  }
  return removed;
}

function validTargetForNodes(nodeIds, target) {
  const t = state.nodes[target];
  if (!t || t.kind === 'group') return false;
  return nodeIds.every((id) => id !== target && !isWithin(target, id));
}

/* mode: 'move' (now) or 'plan' */
function applyMove(payload, target, mode) {
  const snap = snapshot();
  const items = (payload.items || []).map((id) => state.items[id]).filter(Boolean);
  const nodes = (payload.nodes || []).map((id) => state.nodes[id]).filter(Boolean);
  if (nodes.length && !validTargetForNodes(nodes.map((n) => n.id), target)) {
    toast('Storage and groups can’t go there');
    return;
  }
  const sourceGroups = new Set();
  for (const x of [...items, ...nodes]) {
    if (mode === 'move') {
      if (x.parent !== target) {
        const p = state.nodes[x.parent];
        if (p && p.kind === 'group') sourceGroups.add(p.id);
        x.parent = target;
      }
      x.plan = null;
    } else {
      x.plan = x.parent === target ? null : target;
    }
  }
  const removed = dissolveCheck(sourceGroups);
  commit();
  const what = items.length + nodes.length === 1 ? `“${(items[0] || nodes[0]).name}”` : `${items.length + nodes.length} things`;
  const msg = mode === 'move' ? `Moved ${what}` : `Planned move for ${what}`;
  if (removed.length) toast(`${msg}. Group “${removed.join('”, “')}” had fewer than 2 items and was removed.`, snap);
  else toast(msg, snap);
}

function cancelPlans(payload) {
  for (const id of payload.items || []) if (state.items[id]) state.items[id].plan = null;
  for (const id of payload.nodes || []) if (state.nodes[id]) state.nodes[id].plan = null;
  commit();
}

function deleteSummary(id) {
  const n = state.nodes[id];
  if (n.kind === 'group') return { items: itemsIn(id).length, containers: 0, groups: 0 };
  let items = 0, containers = 0, groups = 0;
  const walk = (nid) => {
    items += itemsIn(nid).length;
    for (const c of kidsOf(nid)) {
      if (c.kind === 'group' || c.isGroup) groups++;
      else { containers++; walk(c.id); }
    }
  };
  walk(id);
  return { items, containers, groups };
}

function doDeleteNode(id) {
  const n = state.nodes[id];
  if (!n || n.system) return;
  const deleted = new Set();
  if (n.kind === 'group') {
    for (const it of itemsIn(id)) it.parent = n.parent;
    deleted.add(id);
    delete state.nodes[id];
  } else {
    const walk = (nid) => {
      for (const it of itemsIn(nid)) it.parent = LIMBO;
      for (const c of kidsOf(nid)) {
        if (c.kind === 'group' || c.isGroup) c.parent = LIMBO; // groups survive intact
        else walk(c.id);
      }
      deleted.add(nid);
      delete state.nodes[nid];
    };
    walk(id);
  }
  for (const it of Object.values(state.items)) {
    if (it.plan && (deleted.has(it.plan) || it.plan === it.parent)) it.plan = null;
    if (n.kind === 'room') it.usage = it.usage.filter((r) => r !== id);
  }
  for (const x of Object.values(state.nodes)) {
    if (x.plan && (deleted.has(x.plan) || x.plan === x.parent)) x.plan = null;
  }
}

function deleteItems(ids) {
  const groups = new Set();
  for (const id of ids) {
    const it = state.items[id];
    if (!it) continue;
    const p = state.nodes[it.parent];
    if (p && p.kind === 'group') groups.add(p.id);
    delete state.items[id];
    ui.selected.delete(id);
  }
  return dissolveCheck(groups);
}

/* ============================================================
   Suggestions
   Everything here only proposes. Accepting creates planned moves.
   ============================================================ */
const FREQ_RANK = { daily: 0, weekly: 1, monthly: 2, occasionally: 3, rarely: 4, emergency: 5 };

const isGroupNode = (n) => !!n && (n.kind === 'group' || n.isGroup);
function groupOf(it) { const p = state.nodes[it.parent]; return isGroupNode(p) ? p : null; }

/* Accessibility of the storage holding something: nearest prime/awkward container wins. */
function storageAccess(nodeId) {
  let n = state.nodes[nodeId];
  const seen = new Set();
  while (n && n.kind !== 'room' && !seen.has(n.id)) {
    seen.add(n.id);
    if (n.kind !== 'group' && n.access !== 'normal') return n.access;
    n = state.nodes[n.parent];
  }
  return 'normal';
}

/* ----- Seasons ----- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function currentMonth() {
  const d = window.__stowedNow ? new Date(window.__stowedNow) : new Date();
  return d.getMonth() + 1;
}
function inSeason(se, m = currentMonth()) {
  return se.start <= se.end ? m >= se.start && m <= se.end : m >= se.start || m <= se.end;
}
function seasonLength(se) { return se.start <= se.end ? se.end - se.start + 1 : 12 - se.start + 1 + se.end; }
function seasonText(se) { return se.start === se.end ? MONTHS[se.start - 1] : `${MONTHS[se.start - 1]}–${MONTHS[se.end - 1]}`; }
/* Out of season, and the off-season is long enough (Settings) to count as rarely used.
   It stays that way until the start month arrives; nothing comes back early. */
function isOffSeason(it) {
  return !!it.season && !inSeason(it.season) && 12 - seasonLength(it.season) >= state.settings.seasonGap;
}
/* Frequency the suggestions use: an off-season item counts as rarely used. */
function effFreq(it) {
  if (!it.freq) return null;
  return isOffSeason(it) ? 'rarely' : it.freq;
}

/* ----- Suggestion settings (Settings › Suggestions) ----- */
const SETTING_DEFAULTS = {
  primeRoomMin: 'weekly',      // in a prime room, keep things used at least this often
  primeStorageMin: 'monthly',  // in prime storage in a normal room, keep things used at least this often
  awkwardUpAt: 'weekly',       // in an awkward room or spot, suggest moving up things used at least this often
  seasonGap: 3,                // months out of season before a seasonal item counts as rarely used
  createMin: 2,                // items needed to suggest a new group
  oddOneOutMin: 3,             // group size before "doesn't fit its group" is suggested
  backupDays: 7,               // days before the backup reminder
};
const LEVEL_OPTIONS = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['occasionally', 'Occasionally'], ['off', 'Off']];

/* Does an item of this frequency suit this spot? null = fine. */
function thresholdFor(freq, nodeId, label) {
  if (!freq || freq === 'emergency' || !state.nodes[nodeId]) return null;
  const room = roomOf(nodeId);
  if (!room || room.id === LIMBO) return null;
  const S = state.settings;
  const st = storageAccess(nodeId);
  const r = FREQ_RANK[freq];
  const used = label || `Used ${FREQ_LABEL[freq].toLowerCase()}`;
  if (room.access === 'prime' && S.primeRoomMin !== 'off' && r > FREQ_RANK[S.primeRoomMin]) return { kind: 'out', reason: `${used}, but in a prime room` };
  if (room.access === 'normal' && st === 'prime' && S.primeStorageMin !== 'off' && r > FREQ_RANK[S.primeStorageMin]) return { kind: 'out', reason: `${used}, but in prime storage` };
  if ((room.access === 'awkward' || st === 'awkward') && S.awkwardUpAt !== 'off' && r <= FREQ_RANK[S.awkwardUpAt]) {
    return { kind: 'up', reason: `${used}, but in an awkward ${room.access === 'awkward' ? 'room' : 'spot'}` };
  }
  return null;
}
function itemThreshold(it, nodeId) {
  const off = isOffSeason(it);
  return thresholdFor(effFreq(it), nodeId, off ? `Out of season (${seasonText(it.season)}) until ${MONTHS[it.season.start - 1]}` : null);
}

/* A group's profile, worked out from its members. */
function groupProfile(g) {
  const members = itemsIn(g.id);
  const n = members.length;
  if (!n) return null;
  const fc = {};
  for (const m of members) { const f = effFreq(m); if (f && f !== 'emergency') fc[f] = (fc[f] || 0) + 1; }
  const freq = Object.keys(fc).sort((a, b) => fc[b] - fc[a] || FREQ_RANK[a] - FREQ_RANK[b])[0]
    || (members.some((m) => effFreq(m) === 'emergency') ? 'emergency' : null);
  const tc = {};
  for (const m of members) for (const t of m.tags) tc[t] = (tc[t] || 0) + 1;
  const need = Math.max(2, Math.ceil(n / 2));
  const tags = Object.keys(tc).filter((t) => tc[t] >= need);
  const withUsage = members.filter((m) => m.usage.length);
  let usage = [];
  if (withUsage.length * 2 > n) {
    const uc = {};
    for (const m of withUsage) for (const u of m.usage) uc[u] = (uc[u] || 0) + 1;
    usage = Object.keys(uc).filter((u) => uc[u] * 2 >= withUsage.length);
  }
  return { freq, tags, usage, size: n };
}

/* Emergency items go with anything sharing their tags, whatever its frequency. */
function freqCompatible(a, b) {
  return !!a && !!b && (a === b || a === 'emergency' || b === 'emergency');
}

function sigItems(list) {
  return list.map((i) => `${i.id}:${effFreq(i) || ''}:${i.season ? `${i.season.start}-${i.season.end}` : ''}:${i.tags.join(',')}:${i.usage.join(',')}`).sort().join('|');
}
function placeName(id) { const n = state.nodes[id]; return n ? n.name : ''; }

function computeSuggestions() {
  const out = [];
  const handled = new Set();
  const groups = Object.values(state.nodes).filter((n) => isGroupNode(n) && !n.plan && n.id !== LIMBO);
  const profiles = new Map(groups.map((g) => [g.id, groupProfile(g)]));

  const dis = state.dismissed;
  const isDis = (key, sig) => dis[key] === sig;
  const itemMuted = (it) => isDis(`mute:${it.id}`, sigItems([it]));
  const groupMuted = (g) => isDis(`mute:${g.id}`, sigItems(itemsIn(g.id)));
  const itemKey = (sub, it, dest) => `${sub}:${it.id}>${dest || '-'}`;

  /* Matching groups for an item, best first, skipping destinations you've dismissed. */
  const joinFor = (it, sub, excludeId) => {
    if (!effFreq(it) || !it.tags.length) return null;
    const sig = sigItems([it]);
    const cands = [];
    for (const g of groups) {
      if (g.id === excludeId || g.id === it.parent) continue;
      const p = profiles.get(g.id);
      if (!p || !freqCompatible(p.freq, effFreq(it)) || !p.tags.length || !usageCompatible(p.usage, it.usage)) continue;
      const shared = it.tags.filter((t) => p.tags.includes(t)).length;
      if (!shared || itemThreshold(it, g.id)) continue;
      cands.push({ group: g, score: shared + (p.usage.length && it.usage.some((u) => p.usage.includes(u)) ? 0.5 : 0) + p.size / 1000 });
    }
    cands.sort((a, b) => b.score - a.score);
    const pick = cands.find((c) => !isDis(itemKey(sub, it, c.group.id), sig));
    return pick ? pick.group : null;
  };
  const pushItem = (sub, it, dest, reason) => {
    const sig = sigItems([it]);
    const key = itemKey(sub, it, dest && dest.id);
    if (isDis(key, sig)) return false;
    out.push({ key, type: 'item', sub, sig, item: it.id, dest: dest ? dest.id : null, title: it.name, reason });
    return true;
  };

  // 1. Groups: split, move whole group, remove odd ones out
  for (const g of groups) {
    const members = itemsIn(g.id).filter((i) => !i.plan);
    if (!members.length) continue;
    const muted = groupMuted(g);
    const flags = members.map((i) => [i, itemThreshold(i, g.id)]);
    const flagged = flags.filter(([, t]) => t);
    if (flagged.length) {
      const kinds = new Set(flagged.map(([, t]) => t.kind));
      if (kinds.size === 1) {
        const kind = [...kinds][0];
        const meets = flags.filter(([i, t]) => !t && effFreq(i));
        const flaggedIds = flagged.map(([i]) => i.id);
        if (muted) { /* you asked for no suggestions about this group */ }
        else if (meets.length) {
          out.push({
            key: `split:${g.id}`, type: 'split', sig: sigItems(members), group: g.id, kind, flagged: flaggedIds,
            title: g.name, reason: `${flagged.length} of ${members.length} items ${kind === 'out' ? 'are used too rarely for this spot' : 'are used too often for this awkward spot'}`,
          });
        } else {
          out.push({
            key: `gmove:${g.id}`, type: 'gmove', sig: sigItems(members), node: g.id, kind,
            title: g.name, reason: kind === 'out' ? 'Everything in it is used too rarely for this prime spot' : 'Everything in it is used too often for this awkward spot',
          });
        }
        flaggedIds.forEach((id) => handled.add(id));
      }
    }
    if (members.length >= state.settings.oddOneOutMin) {
      for (const it of members) {
        if (handled.has(it.id) || itemMuted(it)) continue;
        const others = members.filter((o) => o !== it);
        const sharesTag = others.some((o) => o.tags.some((t) => it.tags.includes(t)));
        const sharesUse = others.some((o) => usageCompatible(o.usage, it.usage));
        if (sharesTag || sharesUse) continue;
        pushItem('remove', it, joinFor(it, 'remove', g.id), `Shares no tags or rooms with the rest of “${g.name}”`);
        handled.add(it.id);
      }
    }
  }

  // 2. Tag homes you've set (a dismissed home falls through to the next one, then to normal matching)
  const homes = Object.values(state.nodes).filter((n) => n.homeTags && n.homeTags.length && n.id !== LIMBO);
  if (homes.length) {
    for (const it of Object.values(state.items)) {
      if (it.plan || handled.has(it.id) || itemMuted(it)) continue;
      for (const h of homes) {
        const tag = it.tags.find((t) => h.homeTags.includes(t));
        if (!tag || isWithin(it.parent, h.id) || itemThreshold(it, h.id)) continue;
        if (pushItem('home', it, h, `“${h.name}” is the home for #${tag}`)) { handled.add(it.id); break; }
      }
    }
  }

  // 3. Loose items: threshold, then joining a matching group
  const loose = Object.values(state.items).filter((i) => !i.plan && !groupOf(i) && !handled.has(i.id) && !itemMuted(i));
  for (const it of loose) {
    const t = itemThreshold(it, it.parent);
    if (t) {
      if (pushItem(t.kind, it, joinFor(it, t.kind), t.reason)) handled.add(it.id);
    } else {
      const join = joinFor(it, 'join');
      if (join && pushItem('join', it, join, `Matches group “${join.name}”`)) handled.add(it.id);
    }
  }

  // 4. New groups: 2+ loose items sharing frequency (emergency matches any), a tag and a room, spread over 2+ places
  const tagRoom = new Map();
  const noDest = new Set(out.filter((x) => x.type === 'item' && !x.dest).map((x) => x.item));
  for (const it of loose) {
    if (handled.has(it.id) && !noDest.has(it.id)) continue;
    if (!effFreq(it) || !it.tags.length) continue;
    const rooms = it.usage.length ? it.usage : ['*'];
    for (const tag of it.tags) {
      for (const r of rooms) {
        const k = `${tag}|${r}`;
        if (!tagRoom.has(k)) tagRoom.set(k, { tag, room: r, items: [] });
        tagRoom.get(k).items.push(it);
      }
    }
  }
  const buckets = [];
  for (const tr of tagRoom.values()) {
    const emerg = tr.items.filter((i) => effFreq(i) === 'emergency');
    const freqs = [...new Set(tr.items.map((i) => effFreq(i)).filter((f) => f !== 'emergency'))];
    if (!freqs.length) buckets.push({ ...tr, freq: 'emergency', mixed: false });
    for (const f of freqs) {
      const its = tr.items.filter((i) => effFreq(i) === f);
      buckets.push({ ...tr, freq: f, mixed: emerg.length > 0, items: [...its, ...emerg] });
    }
  }
  const cands = buckets
    .filter((b) => b.items.length >= Math.max(2, state.settings.createMin) && new Set(b.items.map((i) => i.parent)).size >= 2)
    .sort((a, b) => b.items.length - a.items.length);
  const kept = [];
  for (const b of cands) {
    const ids = new Set(b.items.map((i) => i.id));
    if (kept.some((k) => [...ids].every((id) => k.ids.has(id)))) continue;
    kept.push({ ...b, ids });
  }
  for (const b of kept) {
    const counts = {};
    for (const i of b.items) counts[i.parent] = (counts[i.parent] || 0) + 1;
    const place = Object.keys(counts).sort((x, y) => counts[y] - counts[x])
      .find((p) => p !== LIMBO && !thresholdFor(b.freq, p)) || null;
    const ids = [...b.ids].sort();
    const roomName = b.room !== '*' && state.nodes[b.room] ? ` used in ${state.nodes[b.room].name}` : '';
    out.push({
      key: `create:${ids.join(',')}`, type: 'create', sig: sigItems(b.items), items: ids, place,
      name: b.tag.charAt(0).toUpperCase() + b.tag.slice(1),
      title: `New group: #${b.tag}`,
      reason: `${b.items.length} ${b.mixed ? `${FREQ_LABEL[b.freq].toLowerCase()} and emergency` : FREQ_LABEL[b.freq].toLowerCase()} items tagged #${b.tag}${roomName}, in ${Object.keys(counts).length} places`,
    });
  }

  // 5. Merge groups with the same profile in different places
  for (let a = 0; a < groups.length; a++) {
    for (let c = a + 1; c < groups.length; c++) {
      const g1 = groups[a], g2 = groups[c];
      if (groupMuted(g1) || groupMuted(g2)) continue;
      const p1 = profiles.get(g1.id), p2 = profiles.get(g2.id);
      if (!p1 || !p2 || !freqCompatible(p1.freq, p2.freq) || !usageCompatible(p1.usage, p2.usage)) continue;
      const shared = p1.tags.filter((t) => p2.tags.includes(t));
      if (!shared.length || g1.parent === g2.parent || isWithin(g1.id, g2.id) || isWithin(g2.id, g1.id)) continue;
      const [big, small] = p1.size >= p2.size ? [g1, g2] : [g2, g1];
      const moving = itemsIn(small.id).filter((i) => !i.plan);
      if (!moving.length || moving.some((i) => itemThreshold(i, big.id))) continue;
      out.push({
        key: `merge:${[g1.id, g2.id].sort().join(',')}`, type: 'merge', sig: sigItems([...itemsIn(g1.id), ...itemsIn(g2.id)]),
        items: moving.map((i) => i.id), dest: big.id, from: small.id,
        title: `Merge “${small.name}” into “${big.name}”`, reason: p1.freq === p2.freq ? `Both are ${FREQ_LABEL[p1.freq].toLowerCase()} #${shared.join(', #')}` : `Both are #${shared.join(', #')}`,
      });
    }
  }

  const order = { split: 0, gmove: 1, item: 2, create: 3, merge: 4 };
  const subOrder = { out: 0, up: 0, home: 1, remove: 2, join: 3 };
  return out
    .filter((s) => state.dismissed[s.key] !== s.sig)
    .sort((x, y) => order[x.type] - order[y.type] || (subOrder[x.sub] || 0) - (subOrder[y.sub] || 0) || x.title.localeCompare(y.title));
}

function suggestionMarks(sugs) {
  const m = {};
  for (const s of sugs) {
    if (s.type === 'item' && (s.sub === 'out' || s.sub === 'up')) m[s.item] = s.sub;
    if (s.type === 'split') for (const id of s.flagged) m[id] = s.kind;
    if (s.type === 'gmove') for (const i of itemsIn(s.node)) if (effFreq(i) && effFreq(i) !== 'emergency') m[i.id] = s.kind;
  }
  return m;
}

/* ============================================================
   Rendering
   ============================================================ */
let lastSugs = [];
function render() {
  RC = buildIndex();
  try {
    lastSugs = computeSuggestions();
    RC.sugs = lastSugs;
    RC.marks = suggestionMarks(lastSugs);
    renderViews();
    renderBanner();
    renderMain();
    renderSelectBar();
    $('#btn-select').classList.toggle('on', ui.select);
    $('#fab').classList.toggle('hidden', ui.select);
  } finally {
    RC = null;
  }
}

function plannedCount() {
  return Object.values(state.items).filter((i) => i.plan).length + Object.values(state.nodes).filter((n) => n.plan).length;
}
function needsInfoCount() {
  return Object.values(state.items).filter((i) => needsInfo(i).length).length;
}

function renderViews() {
  const moves = plannedCount();
  const needs = needsInfoCount();
  const views = [
    ['rooms', 'Rooms', 0],
    ['sugs', 'Suggestions', lastSugs.length],
    ['moves', 'Planned moves', moves],
    ['needs', 'Needs info', needs],
    ['tags', 'Tags', 0],
  ];
  $('#views').innerHTML = views.map(([k, label, n]) =>
    `<button data-view="${k}" class="${ui.view === k && !ui.search ? 'on' : ''}">${label}${n ? `<span class="badge">${n}</span>` : ''}</button>`).join('');
}

function renderBanner() {
  const count = Object.keys(state.items).length;
  const d = daysAgo(state.meta.lastBackup);
  let html = '';
  if (count && (d === null || d >= state.settings.backupDays)) {
    html = `<div class="banner"><span>Last backup: ${d === null ? 'never' : `${d} days ago`}</span>
      <button class="btn small" data-action="backup">Back up</button></div>`;
  }
  $('#banner').innerHTML = html;
}

function renderMain() {
  const main = $('#app');
  if (ui.search.trim()) { main.innerHTML = renderSearch(); return; }
  if (ui.view === 'sugs') main.innerHTML = renderSuggestions();
  else if (ui.view === 'moves') main.innerHTML = renderMoves();
  else if (ui.view === 'needs') main.innerHTML = renderNeeds();
  else if (ui.view === 'tags') main.innerHTML = renderTags();
  else main.innerHTML = renderTree();
}

/* ----- tree ----- */
function isOpen(id) { return !!ui.expanded[id]; }
function hasContent(id) {
  return kidsOf(id).length || itemsIn(id).length || incomingItems(id).length || incomingNodes(id).length;
}

function renderTree() {
  const rs = rooms();
  let h = '';
  if (rs.length === 1 && !Object.keys(state.items).length) {
    h += `<div class="empty">Add your rooms, then use + on a room to list what’s in it.<br>Anything added without a place goes to Limbo.</div>`;
  }
  h += rs.map(renderRoom).join('');
  h += `<button class="add-room" data-action="add-room">+ Add room</button>`;
  h += `<div class="version">Stowed ${APP_VERSION}</div>`;
  return h;
}

function renderRoom(r) {
  return `<section class="room node" style="${roomVars(r)}">${renderRow(r, 0)}${isOpen(r.id) ? renderBody(r, 0) : ''}</section>`;
}

function accessBtn(n) {
  return `<button class="mini-btn access-${n.access}" data-action="access" data-id="${n.id}" aria-label="Accessibility: ${ACCESS_LABEL[n.access]}" title="${ACCESS_LABEL[n.access]}">${ICONS[n.access]}</button>`;
}

function renderRow(n, depth) {
  const open = isOpen(n.id);
  const content = hasContent(n.id);
  const pad = 4 + depth * 16;
  const tags = [];
  if (n.kind === 'group') tags.push('group');
  else if (n.isGroup) tags.push('group');
  if (n.mobile) tags.push('mobile');
  if (n.plan) tags.push('planned');
  const draggable = n.kind !== 'room';
  const count = subtreeCount(n.id);
  return `<div class="node-row" data-node-row="${n.id}" data-drop="${n.id}" ${draggable ? `data-drag-node="${n.id}"` : ''} style="padding-left:${pad}px">
    <button class="twisty ${content ? '' : 'leaf'}" data-action="toggle" data-id="${n.id}" aria-label="${open ? 'Collapse' : 'Expand'}">${open ? '▼' : '▶'}</button>
    <span class="node-emoji">${esc(nodeEmoji(n))}</span>
    <span class="node-name" data-action="toggle" data-id="${n.id}"><span class="nm">${esc(n.name)}</span>${tags.length ? `<span class="node-tags">${tags.map((t) => `<span class="node-tag">${t}</span>`).join('')}</span>` : ''}</span>
    <span class="node-count">${count || ''}</span>
    ${n.system || n.kind === 'group' ? '' : accessBtn(n)}
    <button class="mini-btn" data-action="add" data-id="${n.id}" aria-label="Add to ${esc(n.name)}">${ICONS.plus}</button>
    ${n.system ? '' : `<button class="mini-btn" data-action="edit-node" data-id="${n.id}" aria-label="Edit ${esc(n.name)}">${ICONS.dots}</button>`}
  </div>`;
}

function renderBody(n, depth) {
  const items = itemsIn(n.id);
  const inc = incomingItems(n.id);
  const kids = kidsOf(n.id);
  const incN = incomingNodes(n.id);
  const pad = 4 + depth * 16 + 30;
  let h = `<div class="node-body" data-drop="${n.id}">`;
  if (items.length || inc.length) {
    h += `<div class="chips" style="padding-left:${pad}px">${items.map(chipHtml).join('')}${inc.map(ghostChipHtml).join('')}</div>`;
  }
  for (const c of kids) h += renderChild(c, depth + 1);
  for (const c of incN) h += ghostNodeHtml(c, depth + 1);
  if (!items.length && !inc.length && !kids.length && !incN.length) {
    h += `<div class="note" style="padding:2px 0 8px ${pad}px">Empty</div>`;
  }
  return h + '</div>';
}

function renderChild(n, depth) {
  const cls = ['node', 'child'];
  if (n.kind === 'group') cls.push('group');
  if (n.plan) cls.push('planned-out');
  return `<div class="${cls.join(' ')}">${renderRow(n, depth)}${isOpen(n.id) ? renderBody(n, depth) : ''}</div>`;
}

function ghostNodeHtml(n, depth) {
  const origin = roomOf(n.parent);
  return `<div class="node child ghost" style="--origin-edge:var(--${origin.color || 'grey'}-e)">
    <div class="node-row" style="padding-left:${4 + depth * 16}px">
      <span class="twisty leaf"></span>
      <span class="node-emoji">${esc(nodeEmoji(n))}</span>
      <span class="node-name" data-action="edit-node" data-id="${n.id}"><span class="nm">${esc(n.name)}</span><span class="node-tags"><span class="node-tag">from ${esc(origin.name)}</span></span></span>
    </div></div>`;
}

function chipHtml(it) {
  const cls = ['chip'];
  if (it.plan) cls.push('planned-out');
  if (it.freq === 'emergency') cls.push('emergency');
  if (ui.selected.has(it.id)) cls.push('selected');
  const mark = RC && RC.marks ? RC.marks[it.id] : null;
  return `<button class="${cls.join(' ')}" data-item="${it.id}" data-drag-item="${it.id}">${esc(it.name)}${it.qty > 1 ? `<span class="qty">×${it.qty}</span>` : ''}${mark ? `<span class="mark" title="${mark === 'out' ? 'Suggested to move somewhere less prime' : 'Suggested to move somewhere easier to reach'}">${mark === 'out' ? '↓' : '↑'}</span>` : ''}</button>`;
}

function ghostChipHtml(it) {
  const origin = roomOf(it.parent);
  const c = origin.color || 'grey';
  return `<button class="chip ghost" data-item="${it.id}" data-ghost="1" style="--origin-edge:var(--${c}-e);--origin-tint:var(--${c}-t)">${esc(it.name)}${it.qty > 1 ? `<span class="qty">×${it.qty}</span>` : ''}</button>`;
}

/* ----- list rows used by search, moves, needs info ----- */
function itemRow(it, extra = '') {
  const room = roomOf(it.parent);
  const sel = ui.selected.has(it.id) ? ' selected' : '';
  return `<div class="list-row${sel}" data-item="${it.id}" style="--edge:var(--${room.color || 'grey'}-e)">
    <div class="grow"><div class="title">${esc(it.name)}${it.qty > 1 ? ` <span class="path">×${it.qty}</span>` : ''}${it.freq === 'emergency' ? ' <span class="node-tag">emergency</span>' : ''}${it.plan ? ' <span class="node-tag">planned →</span>' : ''}</div>
    <div class="path">${esc(nodeEmoji(room))} ${esc(pathText(it.parent))}</div>${extra}</div></div>`;
}

function renderSearch() {
  const terms = ui.search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (hay) => terms.every((t) => hay.some((h) => h.includes(t)));
  const items = Object.values(state.items)
    .filter((it) => matches([it.name.toLowerCase(), ...it.tags]))
    .sort((a, b) => ((a.freq === 'emergency' ? 0 : 1) - (b.freq === 'emergency' ? 0 : 1)) || cmpName(a, b));
  const nodes = Object.values(state.nodes).filter((n) => !n.system && matches([n.name.toLowerCase()])).sort(cmpName);
  if (!items.length && !nodes.length) return `<div class="empty">Nothing matches “${esc(ui.search)}”.</div>`;
  let h = '';
  if (items.length) h += `<div class="section-title">Items (${items.length})</div>` + items.map((it) => itemRow(it)).join('');
  if (nodes.length) {
    h += `<div class="section-title">Rooms and storage (${nodes.length})</div>`;
    h += nodes.map((n) => {
      const room = roomOf(n.id);
      return `<div class="list-row" data-action="reveal" data-id="${n.id}" style="--edge:var(--${room.color || 'grey'}-e)">
        <div class="grow"><div class="title">${esc(nodeEmoji(n))} ${esc(n.name)}</div><div class="path">${esc(pathText(n.id))}</div></div></div>`;
    }).join('');
  }
  return h;
}

function renderMoves() {
  const its = Object.values(state.items).filter((i) => i.plan);
  const ns = Object.values(state.nodes).filter((n) => n.plan);
  if (!its.length && !ns.length) return `<div class="empty">No planned moves. Drag something to a new place and choose “Propose move”.</div>`;
  const byRoom = new Map();
  const add = (kind, x) => {
    const key = roomOf(x.parent);
    if (!byRoom.has(key.id)) byRoom.set(key.id, { room: key, rows: [] });
    byRoom.get(key.id).rows.push({ kind, x });
  };
  its.forEach((i) => add('item', i));
  ns.forEach((n) => add('node', n));
  let h = `<div class="actions"><button class="btn primary" data-action="plan-all">Confirm all as done</button></div>`;
  const groups = [...byRoom.values()].sort((a, b) => (a.room.order - b.room.order));
  for (const g of groups) {
    h += `<div class="section-title">From ${esc(nodeEmoji(g.room))} ${esc(g.room.name)}</div>`;
    for (const { kind, x } of g.rows) {
      const name = kind === 'node' ? `${nodeEmoji(x)} ${x.name}` : `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}`;
      h += `<div class="list-row" style="--edge:var(--${g.room.color || 'grey'}-e)" ${kind === 'item' ? `data-item="${x.id}"` : ''}>
        <div class="grow"><div class="title">${esc(name)}</div>
        <div class="path">${esc(pathText(x.parent))}</div><div class="path">→ ${esc(pathText(x.plan))}</div></div>
        <button class="btn small" data-action="plan-cancel" data-kind="${kind}" data-id="${x.id}" aria-label="Cancel plan">✕</button>
        <button class="btn small primary" data-action="plan-ok" data-kind="${kind}" data-id="${x.id}" aria-label="Confirm move done">✓</button>
      </div>`;
    }
  }
  return h;
}

function renderNeeds() {
  const its = Object.values(state.items).filter((i) => needsInfo(i).length);
  if (!its.length) return `<div class="empty">Every item has tags and a frequency.</div>`;
  const byRoom = new Map();
  for (const it of its) {
    const r = roomOf(it.parent);
    if (!byRoom.has(r.id)) byRoom.set(r.id, { room: r, items: [] });
    byRoom.get(r.id).items.push(it);
  }
  let h = `<div class="note">Tap an item to fill in its details, or use Select to edit several at once.</div>`;
  for (const g of [...byRoom.values()].sort((a, b) => a.room.order - b.room.order)) {
    h += `<div class="section-title">${esc(nodeEmoji(g.room))} ${esc(g.room.name)} (${g.items.length})</div>`;
    h += g.items.sort(cmpName).map((it) => itemRow(it, `<div class="path">Missing: ${needsInfo(it).join(', ')}</div>`)).join('');
  }
  return h;
}

function renderTags() {
  const tags = allTags();
  const untagged = Object.values(state.items).filter((i) => !i.tags.length).sort(cmpName);
  if (!tags.length && !untagged.length) return `<div class="empty">No items yet.</div>`;
  let h = '';
  for (const [t, n] of tags) {
    const its = Object.values(state.items).filter((i) => i.tags.includes(t)).sort(cmpName);
    h += `<div class="section-title"><span>#${esc(t)} (${n})</span></div><div class="chips" style="padding-left:0">${its.map(chipHtml).join('')}</div>`;
  }
  if (untagged.length) h += `<div class="section-title">Untagged (${untagged.length})</div><div class="chips" style="padding-left:0">${untagged.map(chipHtml).join('')}</div>`;
  return h;
}

/* Which container a suggestion is about, so suggestions can be stacked per container. */
function sugStackId(s) {
  if (s.type === 'item') return state.items[s.item].parent;
  if (s.type === 'split') return state.nodes[s.group].parent;
  if (s.type === 'gmove') return state.nodes[s.node].parent;
  if (s.type === 'merge') return state.nodes[s.from].parent;
  return '__new';
}

/* Is this suggestion about something inside the chosen room/container, or about the chosen item? */
function sugInScope(s, scope) {
  if (!scope) return true;
  if (scope.kind === 'item') {
    const id = scope.id;
    if (s.type === 'item') return s.item === id;
    if (s.type === 'create' || s.type === 'merge') return s.items.includes(id);
    const g = s.group || s.node;
    return !!state.items[id] && state.items[id].parent === g;
  }
  const inside = (nodeId) => !!nodeId && isWithin(nodeId, scope.id);
  if (s.type === 'item') return inside(state.items[s.item].parent);
  if (s.type === 'split') return inside(s.group);
  if (s.type === 'gmove') return inside(s.node);
  if (s.type === 'merge') return inside(s.from) || inside(s.dest);
  return s.items.some((id) => inside(state.items[id].parent));
}
function scopeLabel(scope) {
  if (!scope) return 'Whole house';
  if (scope.kind === 'item') return state.items[scope.id] ? state.items[scope.id].name : 'Whole house';
  return state.nodes[scope.id] ? pathText(scope.id) : 'Whole house';
}
function showSuggestionsFor(scope) {
  ui.sugScope = scope;
  ui.view = 'sugs';
  ui.search = '';
  $('#search').value = '';
  closeSheet();
  saveUi();
  render();
  window.scrollTo(0, 0);
}

function renderSuggestions() {
  const sc = ui.sugScope;
  if (sc && !(sc.kind === 'item' ? state.items[sc.id] : state.nodes[sc.id])) ui.sugScope = null;
  const sugs = lastSugs.filter((s) => sugInScope(s, ui.sugScope));
  const noFreq = Object.values(state.items).filter((i) => !i.freq).length;
  const dismissed = Object.keys(state.dismissed).length;
  let h = `<div class="scope-bar"><span class="label">For</span>
      <button class="btn small scope-btn" data-action="sug-scope">${esc(scopeLabel(ui.sugScope))} ▾</button>
      ${ui.sugScope ? '<button class="btn small" data-action="sug-scope-all">Whole house</button>' : ''}</div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
    <span class="note">${sugs.length} suggestion${sugs.length === 1 ? '' : 's'}${dismissed ? ` · ${dismissed} dismissed` : ''}</span>
    <button class="btn small" data-action="reset-sugs">Reset suggestions</button></div>`;
  if (noFreq) h += `<div class="note" style="margin-bottom:8px">${noFreq} item${noFreq === 1 ? ' has' : 's have'} no frequency set and ${noFreq === 1 ? 'isn’t' : 'aren’t'} considered. <button class="btn small" data-view="needs">Needs info</button></div>`;
  if (!sugs.length) return h + `<div class="empty">No suggestions ${ui.sugScope ? 'for this' : 'right now'}.</div>`;
  const stacks = new Map();
  lastSugs.forEach((s, idx) => {
    if (!sugInScope(s, ui.sugScope)) return;
    const k = sugStackId(s);
    if (!stacks.has(k)) stacks.set(k, []);
    stacks.get(k).push([s, idx]);
  });
  const roomRank = (id) => { const r = roomOf(id); return r ? r.order : 0; };
  const keys = [...stacks.keys()].sort((a, b) => {
    if (a === '__new') return 1;
    if (b === '__new') return -1;
    return roomRank(a) - roomRank(b) || pathText(a).localeCompare(pathText(b));
  });
  for (const k of keys) {
    const list = stacks.get(k);
    const room = k === '__new' ? null : roomOf(k);
    const head = k === '__new' ? 'New groups' : `${esc(nodeEmoji(room))} ${esc(pathText(k))}`;
    h += `<section class="sug-stack" style="--edge:var(--${(room && room.color) || 'grey'}-e)">
      <div class="sug-stack-head">${head}<span class="note"> · ${list.length}</span></div>
      ${list.map(([s, idx]) => suggestionCard(s, idx)).join('')}</section>`;
  }
  return h;
}

function sugLabel(s) {
  if (s.type === 'split') return 'Split group';
  if (s.type === 'gmove') return s.kind === 'out' ? 'Move group out of prime' : 'Move group somewhere easier';
  if (s.type === 'create') return 'Create group';
  if (s.type === 'merge') return 'Merge groups';
  return { out: 'Move out of prime', up: 'Move somewhere easier', home: 'Tag home', remove: 'Doesn’t fit its group', join: 'Join group' }[s.sub];
}

function suggestionCard(s, idx) {
  const btn = (act, label, primary) => `<button class="btn small${primary ? ' primary' : ''}" data-sact="${act}" data-sug="${idx}">${label}</button>`;
  let body = '';
  let actions = '';
  if (s.type === 'item') {
    const it = state.items[s.item];
    body = `<div class="title">${esc(it.name)}${it.qty > 1 ? ` <span class="path">×${it.qty}</span>` : ''}</div>
      <div class="sug-reason">${esc(s.reason)}</div>
      ${s.dest ? `<div class="sug-dest">→ ${esc(pathText(s.dest))}</div>` : '<div class="path">No matching group or home left to suggest.</div>'}`;
    actions = (s.dest ? btn('propose', 'Propose move', true) + btn('choose', 'Elsewhere…') : btn('choose', 'Choose where…', true))
      + btn('dismiss', 'Dismiss') + btn('mute', 'Dismiss all for this item');
  } else if (s.type === 'gmove') {
    const g = state.nodes[s.node];
    body = `<div class="title">${esc(nodeEmoji(g))} ${esc(g.name)}</div><div class="sug-reason">${esc(s.reason)}</div>`;
    actions = btn('choose', 'Choose where…', true) + btn('dismiss', 'Dismiss') + btn('mute', 'Dismiss all for this group');
  } else if (s.type === 'split') {
    const g = state.nodes[s.group];
    body = `<div class="title">${esc(nodeEmoji(g))} ${esc(g.name)}</div><div class="sug-reason">${esc(s.reason)}</div>`;
    actions = btn('split', 'Review split', true) + btn('dismiss', 'Dismiss') + btn('mute', 'Dismiss all for this group');
  } else if (s.type === 'create') {
    const its = s.items.map((id) => state.items[id]);
    body = `<div class="title">${esc(s.title)}</div><div class="sug-reason">${esc(s.reason)}</div>
      <div class="chips" style="padding:4px 0">${its.map((i) => `<span class="chip static">${esc(i.name)}</span>`).join('')}</div>
      <div class="sug-dest">${s.place ? `In ${esc(pathText(s.place))}` : 'Choose where it goes'}</div>`;
    actions = btn('create', 'Create group…', true) + btn('dismiss', 'Dismiss');
  } else if (s.type === 'merge') {
    body = `<div class="title">${esc(s.title)}</div><div class="sug-reason">${esc(s.reason)}</div>
      <div class="sug-dest">→ ${esc(pathText(s.dest))}</div>`;
    actions = btn('propose', 'Propose merge', true) + btn('dismiss', 'Dismiss');
  }
  return `<div class="sug-row"><div class="sug-type">${esc(sugLabel(s))}</div>${body}<div class="row sug-actions">${actions}</div></div>`;
}

function handleSuggestion(act, s) {
  if (!s) return;
  if (act === 'dismiss') {
    const snap = snapshot();
    state.dismissed[s.key] = s.sig;
    commit();
    const next = s.type === 'item' ? lastSugs.find((x) => x.item === s.item) : null;
    toast(next && next.dest ? 'Dismissed. Showing the next option.' : 'Dismissed', snap);
  } else if (act === 'mute') {
    const snap = snapshot();
    if (s.type === 'item') state.dismissed[`mute:${s.item}`] = sigItems([state.items[s.item]]);
    else { const gid = s.group || s.node; state.dismissed[`mute:${gid}`] = sigItems(itemsIn(gid)); }
    commit();
    toast('No more suggestions for it until its details change', snap);
  } else if (act === 'propose') {
    if (s.type === 'item') applyMove({ items: [s.item] }, s.dest, 'plan');
    else if (s.type === 'merge') applyMove({ items: s.items }, s.dest, 'plan');
  } else if (act === 'choose') {
    if (s.type === 'item') openPicker({ items: [s.item] });
    else if (s.type === 'gmove') openPicker({ nodes: [s.node] });
  } else if (act === 'create') openCreateGroupSheet(s, { name: s.name, place: s.place });
  else if (act === 'split') openSplitSheet(s);
}

function openCreateGroupSheet(s, draft) {
  openSheet({
    focus: '#f-gname',
    html: () => {
      const local = draft.place ? s.items.filter((id) => state.items[id].parent === draft.place).length : 0;
      return `<h2>Create group</h2>
      <div class="field"><label for="f-gname">Name</label><input id="f-gname" type="text" value="${esc(draft.name)}"></div>
      <div class="field"><span class="label">Where</span><div class="row"><span class="grow">${draft.place ? esc(pathText(draft.place)) : '<span class="note">Not chosen</span>'}</span>
        <button class="btn small" data-act="place">Change…</button></div></div>
      <div class="note">${draft.place ? `${local} item${local === 1 ? ' is' : 's are'} already there and join straight away. The other ${s.items.length - local} get planned moves into the group.` : ''}</div>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-act="make" ${draft.place ? '' : 'disabled'}>Create</button></div>`;
    },
    input(e) { if (e.target.id === 'f-gname') draft.name = e.target.value; },
    click(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'place') {
        openPicker({ items: s.items }, {
          title: 'Where should the group go?', noGroups: true,
          choose: (sel) => { draft.place = sel; openCreateGroupSheet(s, draft); },
        });
        return;
      }
      if (b.dataset.act !== 'make' || !draft.place) return;
      const snap = snapshot();
      const name = draft.name.trim() || 'New group';
      const gid = addNode({ kind: 'group', name, parent: draft.place });
      for (const id of s.items) {
        const it = state.items[id];
        if (!it) continue;
        if (it.parent === draft.place) { it.parent = gid; it.plan = null; } else it.plan = gid;
      }
      for (const p of pathNodes(gid)) ui.expanded[p.id] = true;
      saveUi();
      closeSheet();
      commit();
      toast(`Created group “${name}”`, snap);
    },
  });
}

function openSplitSheet(s) {
  const g = state.nodes[s.group];
  if (!g) return;
  const physical = g.kind !== 'group';
  const members = itemsIn(g.id).filter((i) => !i.plan);
  const side = {};
  members.forEach((i) => { side[i.id] = s.flagged.includes(i.id) ? 'b' : 'a'; });
  let pouchSide = 'a';
  // Side a meets this spot's threshold and stays; side b should move.
  const moreSide = s.kind === 'out' ? 'a' : 'b';
  const names = physical
    ? { a: `${g.name} group`, b: `${g.name} group` }
    : { a: `${g.name} – ${moreSide === 'a' ? 'more' : 'less'} frequent`, b: `${g.name} – ${moreSide === 'b' ? 'more' : 'less'} frequent` };
  const readNames = () => {
    for (const k of ['a', 'b']) { const f = $(`#f-split-${k}`, sheetBody); if (f) names[k] = f.value; }
  };
  const chip = (i) => `<button class="chip" data-split-drag="${i.id}">${esc(i.name)}${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}${i.freq ? `<span class="qty"> · ${esc(isOffSeason(i) ? 'out of season' : FREQ_LABEL[i.freq].toLowerCase())}</span>` : ''}</button>`;
  const column = (k) => {
    const its = members.filter((i) => side[i.id] === k);
    const hasPouch = physical && pouchSide === k;
    const head = k === 'a' ? 'Stays here' : s.kind === 'out' ? 'Moves somewhere less prime' : 'Moves somewhere easier';
    const nameField = hasPouch
      ? `<button class="chip pouch" data-split-drag="__pouch">${esc(nodeEmoji(g))} ${esc(g.name)}</button>`
      : `<input id="f-split-${k}" type="text" value="${esc(names[k])}" aria-label="Group name">`;
    return `<div class="split-side" data-split-side="${k}"><div class="split-head">${head}</div>${nameField}
      <div class="chips" style="padding:6px 0 0">${its.map(chip).join('') || '<span class="note">Empty</span>'}</div></div>`;
  };
  openSheet({
    split: true,
    html: () => `<h2>Split “${esc(g.name)}”</h2><div class="sub">${esc(s.reason)}. Tap or drag items to switch sides.${physical ? ' Drag the container to choose which side keeps it.' : ''}</div>
      <div class="split">${column('a')}${column('b')}</div>
      <div class="note" style="margin-top:8px">A side left with one item becomes a loose item rather than a group.</div>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-act="split">Split</button></div>`,
    splitDrop(id, k) {
      readNames();
      if (id === '__pouch') pouchSide = k; else if (side[id]) side[id] = k;
      drawSheet();
    },
    click(e) {
      if (Date.now() < suppressClickUntil) return;
      const c = e.target.closest('[data-split-drag]');
      if (c) {
        readNames();
        const id = c.dataset.splitDrag;
        if (id === '__pouch') pouchSide = pouchSide === 'a' ? 'b' : 'a';
        else side[id] = side[id] === 'a' ? 'b' : 'a';
        drawSheet();
        return;
      }
      if (!e.target.closest('[data-act="split"]')) return;
      readNames();
      const snap = snapshot();
      const moveOut = (its, name) => {
        if (its.length >= 2) {
          const gid = addNode({ kind: 'group', name: name.trim() || `${g.name} group`, parent: g.parent });
          its.forEach((i) => { i.parent = gid; });
          ui.expanded[gid] = true;
        } else its.forEach((i) => { i.parent = g.parent; });
      };
      if (physical) {
        const other = pouchSide === 'a' ? 'b' : 'a';
        moveOut(members.filter((i) => side[i.id] === other), names[other]);
      } else {
        if (names.a.trim()) g.name = names.a.trim();
        moveOut(members.filter((i) => side[i.id] === 'b'), names.b);
        dissolveCheck([g.id]);
      }
      saveUi();
      closeSheet();
      commit();
      toast('Group split', snap);
    },
  });
}

function renderSelectBar() {
  const bar = $('#selectbar');
  if (!ui.select) { bar.classList.add('hidden'); return; }
  const n = ui.selected.size;
  bar.classList.remove('hidden');
  bar.innerHTML = `<span class="count">${n} selected</span>
    <button class="btn small" data-action="sel-details" ${n ? '' : 'disabled'}>Details</button>
    <button class="btn small" data-action="sel-move" ${n ? '' : 'disabled'}>Move</button>
    <button class="btn small" data-action="sel-group" ${n ? '' : 'disabled'}>Group</button>
    <button class="btn small danger" data-action="sel-delete" ${n ? '' : 'disabled'}>Delete</button>
    <button class="btn small primary" data-action="select">Done</button>`;
}

/* ============================================================
   Sheets (bottom dialogs)
   ============================================================ */
const sheetRoot = $('#sheet-root');
const sheetBody = $('#sheet-body');
let sheetCtl = null;

function openSheet(ctl) {
  if (sheetCtl && sheetCtl.onClose) sheetCtl.onClose();
  sheetCtl = ctl;
  $('#toast').classList.add('hidden');
  sheetRoot.classList.remove('hidden');
  $('.sheet', sheetRoot).scrollTop = 0;
  drawSheet();
  if (ctl.focus) { const f = $(ctl.focus, sheetBody); if (f) setTimeout(() => f.focus(), 50); }
}
function drawSheet() {
  if (!sheetCtl) return;
  const sc = $('.sheet', sheetRoot);
  const top = sc.scrollTop;
  sheetBody.innerHTML = sheetCtl.html();
  sc.scrollTop = top;
  if (sheetCtl.mount) sheetCtl.mount(sheetBody);
}
function closeSheet() {
  const ctl = sheetCtl;
  sheetCtl = null;
  if (ctl && ctl.onClose) ctl.onClose();
  sheetRoot.classList.add('hidden');
  sheetBody.innerHTML = '';
}
sheetRoot.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { closeSheet(); return; }
  if (sheetCtl && sheetCtl.click) sheetCtl.click(e);
});
sheetBody.addEventListener('change', (e) => { if (sheetCtl && sheetCtl.change) sheetCtl.change(e); });
sheetBody.addEventListener('input', (e) => { if (sheetCtl && sheetCtl.input) sheetCtl.input(e); });

function confirmSheet({ title, text, ok = 'OK', danger = false, onOk, extra = [] }) {
  openSheet({
    html: () => `<h2>${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}
      <div class="actions"><button class="btn" data-close>Cancel</button>
      ${extra.map((b, i) => `<button class="btn" data-extra="${i}">${esc(b.label)}</button>`).join('')}
      <button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button></div>`,
    click(e) {
      const x = e.target.closest('[data-extra]');
      if (x) { closeSheet(); extra[+x.dataset.extra].onClick(); return; }
      if (e.target.closest('[data-ok]')) { closeSheet(); onOk(); }
    },
  });
}

function segHtml(attr, options, current) {
  return `<div class="seg">${options.map(([v, l]) => `<button type="button" data-${attr}="${v}" class="${(Array.isArray(current) ? current.includes(v) : current === v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
function monthSelect(id, value) {
  return `<select id="${id}" class="month-select">${MONTHS.map((m, i) => `<option value="${i + 1}" ${value === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select>`;
}
function defaultSeason() { const m = currentMonth(); return { start: m, end: ((m + 1) % 12) + 1 }; }
function seasonStatus(it) {
  if (!it.season) return '';
  if (inSeason(it.season)) return 'In season now, so its usual frequency applies.';
  if (isOffSeason(it)) return `Out of season now: counts as rarely used until ${MONTHS[it.season.start - 1]}.`;
  return `Out of season now, but for less than ${state.settings.seasonGap} months, so its usual frequency still applies.`;
}
function readSeason(root) {
  const a = $('#f-sstart', root), b = $('#f-send', root);
  return a && b ? validSeason({ start: a.value, end: b.value }) : null;
}

function usageOptions() { return rooms(false).map((r) => [r.id, `${nodeEmoji(r)} ${r.name}`]); }
function tagSuggestHtml(current) {
  const sug = allTags().filter(([t]) => !current.includes(t)).slice(0, 16);
  if (!sug.length) return '';
  return `<div class="seg" style="margin-top:6px">${sug.map(([t]) => `<button type="button" data-addtag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>`;
}

/* ----- item sheet ----- */
function openItemSheet(id) {
  const it = state.items[id];
  if (!it) return;
  const commitFields = () => {
    if (!state.items[id]) return;
    const name = $('#f-name', sheetBody);
    const qty = $('#f-qty', sheetBody);
    const tags = $('#f-tags', sheetBody);
    let changed = false;
    if (name && name.value.trim() && name.value.trim() !== it.name) { it.name = name.value.trim(); changed = true; }
    if (qty) { const q = Math.max(1, parseInt(qty.value, 10) || 1); if (q !== it.qty) { it.qty = q; changed = true; } }
    if (tags) { const t = parseTags(tags.value); if (t.join(',') !== it.tags.join(',')) { it.tags = t; changed = true; } }
    if (changed) commit();
  };
  openSheet({
    html: () => {
      const usage = usageOptions();
      return `<h2>${esc(it.name)}</h2><div class="sub">${esc(pathText(it.parent))}</div>
      <div class="field"><label for="f-name">Name</label><input id="f-name" type="text" value="${esc(it.name)}"></div>
      <div class="field"><label for="f-qty">Quantity</label><input id="f-qty" type="number" min="1" inputmode="numeric" value="${it.qty}" style="max-width:110px"></div>
      <div class="field"><label for="f-tags">Tags (comma separated)</label><input id="f-tags" type="text" value="${esc(it.tags.join(', '))}" autocapitalize="none">${tagSuggestHtml(it.tags)}</div>
      <div class="field"><span class="label">${USED_IN_LABEL}</span>${usage.length ? segHtml('usage', usage, it.usage) : '<div class="note">Add rooms first.</div>'}</div>
      <div class="field"><span class="label">How often it’s used</span>${segHtml('freq', FREQS, it.freq)}
        <label class="check"><input type="checkbox" id="f-seasonal" ${it.season ? 'checked' : ''}> Seasonal</label>
        ${it.season ? `<div class="row">In use from ${monthSelect('f-sstart', it.season.start)} to ${monthSelect('f-send', it.season.end)}</div>
        <div class="note" style="margin-top:4px">${esc(seasonStatus(it))}</div>` : ''}</div>
      <div class="field"><span class="label">Location</span>
        <div class="row"><span class="grow">${esc(pathText(it.parent))}</span>
        <button class="btn small" data-act="relocate">Move…</button><button class="btn small" data-act="show">Show</button></div></div>
      <div class="field"><button class="btn small" data-act="sugs">Suggestions for this item</button></div>
      ${it.plan ? `<div class="field"><span class="label">Planned move</span>
        <div>→ ${esc(pathText(it.plan))}</div>
        <div class="row" style="margin-top:6px"><button class="btn small" data-act="plan-cancel">Cancel plan</button>
        <button class="btn small primary" data-act="plan-ok">Confirm move done</button></div></div>` : ''}
      <div class="actions spread"><button class="btn danger" data-act="delete">Delete</button><button class="btn primary" data-close>Done</button></div>`;
    },
    onClose: commitFields,
    change(e) {
      if (e.target.matches('#f-name,#f-qty,#f-tags')) { commitFields(); return; }
      if (e.target.id === 'f-seasonal') { commitFields(); it.season = e.target.checked ? defaultSeason() : null; commit(); drawSheet(); return; }
      if (e.target.matches('#f-sstart,#f-send')) { commitFields(); it.season = readSeason(sheetBody); commit(); drawSheet(); }
    },
    click(e) {
      const b = e.target.closest('[data-usage],[data-freq],[data-addtag],[data-act]');
      if (!b) return;
      commitFields();
      if (b.dataset.usage) {
        const r = b.dataset.usage;
        it.usage = it.usage.includes(r) ? it.usage.filter((x) => x !== r) : [...it.usage, r];
        commit(); drawSheet();
      } else if (b.dataset.freq) {
        it.freq = it.freq === b.dataset.freq ? null : b.dataset.freq;
        commit(); drawSheet();
      } else if (b.dataset.addtag) {
        if (!it.tags.includes(b.dataset.addtag)) it.tags.push(b.dataset.addtag);
        commit(); drawSheet();
      } else {
        const act = b.dataset.act;
        if (act === 'relocate') openPicker({ items: [id] });
        else if (act === 'show') { closeSheet(); reveal(it.parent, id); }
        else if (act === 'sugs') showSuggestionsFor({ kind: 'item', id });
        else if (act === 'plan-ok') { closeSheet(); applyMove({ items: [id] }, it.plan, 'move'); }
        else if (act === 'plan-cancel') { it.plan = null; commit(); drawSheet(); }
        else if (act === 'delete') {
          confirmSheet({
            title: `Delete “${it.name}”?`, ok: 'Delete', danger: true,
            onOk: () => { const snap = snapshot(); const removed = deleteItems([id]); commit(); toast(`Deleted “${it.name}”${removed.length ? `; group “${removed.join('”, “')}” removed` : ''}`, snap); },
          });
        }
      }
    },
  });
}

/* ----- node sheet (rooms, storage, groups) ----- */
function openNodeSheet(id) {
  const isNew = !id;
  const n = isNew
    ? { kind: 'room', name: '', emoji: '🏠', color: COLORS.find((c) => !rooms().some((r) => r.color === c)) || 'grey', access: 'normal' }
    : state.nodes[id];
  if (!n || n.system) return;
  const commitName = () => {
    const f = $('#f-name', sheetBody);
    if (!isNew && f && f.value.trim() && f.value.trim() !== n.name) { n.name = f.value.trim(); commit(); }
    const h = $('#f-home', sheetBody);
    if (!isNew && h) {
      const t = parseTags(h.value);
      if (t.join(',') !== (n.homeTags || []).join(',')) { n.homeTags = t; commit(); }
    }
  };
  const emojiSet = n.kind === 'room' ? ROOM_EMOJI : STORAGE_EMOJI;
  const kindLabel = n.kind === 'room' ? 'Room' : n.kind === 'group' ? 'Group' : (n.parent && state.nodes[n.parent] && state.nodes[n.parent].kind !== 'room' ? 'Sub-container' : 'Storage');
  openSheet({
    focus: isNew ? '#f-name' : null,
    html: () => {
      let h = `<h2>${isNew ? 'New room' : esc(n.name)}</h2><div class="sub">${isNew ? '' : `${kindLabel} · ${esc(pathText(n.parent || n.id))}`}</div>
      <div class="field"><label for="f-name">Name</label><input id="f-name" type="text" value="${esc(n.name)}"></div>`;
      if (n.kind !== 'group') {
        h += `<div class="field"><label for="f-emoji">Emoji${n.kind === 'room' ? ' (type any emoji)' : ''}</label>
          <div class="row"><input id="f-emoji" type="text" value="${esc(n.emoji || '')}" style="width:70px;font-size:20px;text-align:center"></div>
          <div class="emoji-grid" style="margin-top:6px">${emojiSet.map((e) => `<button type="button" data-emoji="${e}" class="${n.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div></div>`;
      }
      if (n.kind === 'room') {
        h += `<div class="field"><span class="label">Colour</span><div class="swatches">${COLORS.map((c) =>
          `<button type="button" data-color="${c}" class="${n.color === c ? 'on' : ''}" style="--tint:var(--${c}-t);--edge:var(--${c}-e)" aria-label="${c}"></button>`).join('')}</div></div>`;
      }
      if (n.kind !== 'group') {
        h += `<div class="field"><span class="label">Accessibility</span>${segHtml('access', ACCESS.map((a) => [a, ACCESS_LABEL[a]]), n.access)}</div>`;
      }
      if (n.kind === 'storage') {
        h += `<div class="field"><span class="label">Type</span>${segHtml('mobile', [['fixed', 'Fixed (shelf, cupboard)'], ['mobile', 'Mobile (box, trug, bag)']], n.mobile ? 'mobile' : 'fixed')}</div>
          <label class="check"><input type="checkbox" id="f-isgroup" ${n.isGroup ? 'checked' : ''}> Treat as a group (everything in it belongs together)</label>`;
      }
      if (!isNew) {
        h += `<div class="field"><label for="f-home">Home for tags <span class="note">(items with these tags get suggested to move here)</span></label>
          <input id="f-home" type="text" value="${esc((n.homeTags || []).join(', '))}" autocapitalize="none" placeholder="e.g. sewing, haberdashery">${tagSuggestHtml(n.homeTags || [])}</div>`;
      }
      if (!isNew && n.kind !== 'room') {
        h += `<div class="field"><span class="label">Location</span><div class="row"><span class="grow">${esc(pathText(n.parent))}</span>
          <button class="btn small" data-act="relocate">Move…</button></div></div>`;
        if (n.plan) {
          h += `<div class="field"><span class="label">Planned move</span><div>→ ${esc(pathText(n.plan))}</div>
            <div class="row" style="margin-top:6px"><button class="btn small" data-act="plan-cancel">Cancel plan</button>
            <button class="btn small primary" data-act="plan-ok">Confirm move done</button></div></div>`;
        }
      }
      if (!isNew) {
        h += `<div class="field"><button class="btn small" data-act="sugs">Suggestions for ${n.kind === 'room' ? 'this room' : 'everything in here'}</button></div>`;
      }
      if (!isNew && n.kind === 'room') {
        h += `<div class="field"><span class="label">Order</span><div class="row"><button class="btn small" data-act="up">↑ Earlier</button><button class="btn small" data-act="down">↓ Later</button></div></div>`;
      }
      h += isNew
        ? `<div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-act="create">Create room</button></div>`
        : `<div class="actions spread"><button class="btn danger" data-act="delete">Delete</button><button class="btn primary" data-close>Done</button></div>`;
      return h;
    },
    onClose: commitName,
    change(e) {
      if (e.target.id === 'f-name') commitName();
      if (e.target.id === 'f-isgroup') { n.isGroup = e.target.checked; if (!isNew) commit(); }
      if (e.target.id === 'f-home' && !isNew) { n.homeTags = parseTags(e.target.value); commit(); }
    },
    input(e) {
      if (e.target.id === 'f-emoji') {
        const g = firstGrapheme(e.target.value);
        n.emoji = g;
        if (!isNew) { save(); render(); }
      }
    },
    click(e) {
      const b = e.target.closest('[data-emoji],[data-color],[data-access],[data-mobile],[data-addtag],[data-act]');
      if (!b) return;
      const nameField = $('#f-name', sheetBody);
      if (isNew && nameField) n.name = nameField.value;
      else commitName();
      if (b.dataset.addtag) { n.homeTags = parseTags([...(n.homeTags || []), b.dataset.addtag].join(',')); }
      else if (b.dataset.emoji) { n.emoji = b.dataset.emoji; }
      else if (b.dataset.color) { n.color = b.dataset.color; }
      else if (b.dataset.access) { n.access = b.dataset.access; }
      else if (b.dataset.mobile) { n.mobile = b.dataset.mobile === 'mobile'; }
      else {
        const act = b.dataset.act;
        if (act === 'create') {
          const name = (n.name || '').trim();
          if (!name) { toast('Give the room a name'); return; }
          const nid = addNode({ kind: 'room', name, emoji: n.emoji, color: n.color, access: n.access, parent: null });
          ui.expanded[nid] = true; saveUi();
          closeSheet(); commit(); return;
        }
        if (act === 'relocate') { openPicker({ nodes: [n.id] }); return; }
        if (act === 'sugs') { showSuggestionsFor({ kind: 'node', id: n.id }); return; }
        if (act === 'plan-ok') { closeSheet(); applyMove({ nodes: [n.id] }, n.plan, 'move'); return; }
        if (act === 'plan-cancel') { n.plan = null; }
        if (act === 'up' || act === 'down') {
          const rs = rooms(false);
          const i = rs.findIndex((r) => r.id === n.id);
          const j = act === 'up' ? i - 1 : i + 1;
          if (j >= 0 && j < rs.length) { const t = rs[j].order; rs[j].order = n.order; n.order = t; if (rs[j].order === n.order) n.order += act === 'up' ? -1 : 1; }
        }
        if (act === 'delete') { askDeleteNode(n.id); return; }
      }
      if (!isNew) commit();
      drawSheet();
    },
  });
}

function askDeleteNode(id) {
  const n = state.nodes[id];
  const s = deleteSummary(id);
  let text;
  if (n.kind === 'group') {
    text = `${s.items} item${s.items === 1 ? '' : 's'} go back to ${esc(state.nodes[n.parent] ? state.nodes[n.parent].name : 'Limbo')}.`;
  } else {
    const parts = [];
    if (s.containers) parts.push(`${s.containers} container${s.containers === 1 ? '' : 's'} inside ${s.containers === 1 ? 'is' : 'are'} deleted`);
    if (s.items) parts.push(`${s.items} item${s.items === 1 ? '' : 's'} go${s.items === 1 ? 'es' : ''} to Limbo`);
    if (s.groups) parts.push(`${s.groups} group${s.groups === 1 ? '' : 's'} go${s.groups === 1 ? 'es' : ''} to Limbo intact`);
    text = parts.length ? parts.join('; ') + '.' : 'It’s empty.';
  }
  confirmSheet({
    title: `Delete “${n.name}”?`, text, ok: 'Delete', danger: true,
    onOk: () => { const snap = snapshot(); doDeleteNode(id); commit(); toast(`Deleted “${n.name}”`, snap); },
  });
}

/* ----- add sheet ----- */
function openAddSheet(targetId) {
  const target = state.nodes[targetId] || state.nodes[LIMBO];
  const inGroup = target.kind === 'group';
  const draft = { asContainer: false, mobile: false, asGroup: false, groupName: '', usage: [], freq: null, tags: '', text: '' };
  const readFields = () => {
    const t = $('#f-lines', sheetBody); if (t) draft.text = t.value;
    const g = $('#f-groupname', sheetBody); if (g) draft.groupName = g.value;
    const tg = $('#f-tags', sheetBody); if (tg) draft.tags = tg.value;
  };
  openSheet({
    focus: '#f-lines',
    html: () => `<h2>Add to ${esc(nodeEmoji(target))} ${esc(target.name)}</h2><div class="sub">${esc(pathText(target.id))}</div>
      <div class="field"><label for="f-lines">One per line. Add “x2” for a quantity.</label>
        <textarea id="f-lines" placeholder="head torch x2&#10;glue gun&#10;pinking shears">${esc(draft.text)}</textarea></div>
      ${inGroup ? '' : `<label class="check"><input type="checkbox" id="f-container" ${draft.asContainer ? 'checked' : ''}> Add as containers (storage)</label>`}
      ${draft.asContainer ? `<div class="field">${segHtml('mobile', [['fixed', 'Fixed'], ['mobile', 'Mobile']], draft.mobile ? 'mobile' : 'fixed')}
        <div class="note" style="margin-top:6px">${target.kind === 'room' ? `Each line becomes storage at the top level of ${esc(target.name)}.` : `Each line becomes a container inside ${esc(target.name)}.`}</div></div>` : ''}
      ${inGroup || draft.asContainer ? '' : `<label class="check"><input type="checkbox" id="f-asgroup" ${draft.asGroup ? 'checked' : ''}> Put these items in a new group</label>
        ${draft.asGroup ? `<div class="field"><input id="f-groupname" type="text" placeholder="Group name, e.g. Storm clothing" value="${esc(draft.groupName)}"></div>` : ''}`}
      ${draft.asContainer ? '' : `<details class="details" ${draft.tags || draft.usage.length || draft.freq ? 'open' : ''}><summary>Details for all of these (optional)</summary>
        <div class="field"><label for="f-tags">Tags (comma separated)</label><input id="f-tags" type="text" value="${esc(draft.tags)}" autocapitalize="none">${tagSuggestHtml(parseTags(draft.tags))}</div>
        <div class="field"><span class="label">${USED_IN_LABEL}</span>${usageOptions().length ? segHtml('usage', usageOptions(), draft.usage) : '<div class="note">Add rooms first.</div>'}</div>
        <div class="field"><span class="label">How often they’re used</span>${segHtml('freq', FREQS, draft.freq)}</div></details>`}
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-act="add">Add</button></div>`,
    change(e) {
      readFields();
      if (e.target.id === 'f-container') { draft.asContainer = e.target.checked; if (draft.asContainer) draft.asGroup = false; drawSheet(); }
      if (e.target.id === 'f-asgroup') { draft.asGroup = e.target.checked; drawSheet(); if (draft.asGroup) { const g = $('#f-groupname', sheetBody); if (g) g.focus(); } }
    },
    click(e) {
      const b = e.target.closest('[data-mobile],[data-usage],[data-freq],[data-addtag],[data-act]');
      if (!b) return;
      readFields();
      if (b.dataset.mobile) { draft.mobile = b.dataset.mobile === 'mobile'; drawSheet(); return; }
      if (b.dataset.usage) { const r = b.dataset.usage; draft.usage = draft.usage.includes(r) ? draft.usage.filter((x) => x !== r) : [...draft.usage, r]; drawSheet(); return; }
      if (b.dataset.freq) { draft.freq = draft.freq === b.dataset.freq ? null : b.dataset.freq; drawSheet(); return; }
      if (b.dataset.addtag) { const t = parseTags(draft.tags); if (!t.includes(b.dataset.addtag)) t.push(b.dataset.addtag); draft.tags = t.join(', '); drawSheet(); return; }
      if (b.dataset.act !== 'add') return;
      const lines = draft.text.split('\n').map(parseLine).filter(Boolean);
      if (!lines.length) { toast('Type at least one line'); return; }
      if (draft.asContainer) {
        for (const l of lines) addNode({ kind: 'storage', name: l.name, emoji: '📦', parent: target.id, mobile: draft.mobile });
      } else {
        let parent = target.id;
        if (draft.asGroup) {
          if (lines.length < 2) { toast('A group needs at least 2 items'); return; }
          parent = addNode({ kind: 'group', name: draft.groupName.trim() || 'New group', parent: target.id });
          ui.expanded[parent] = true;
        }
        addItems(parent, lines, { tags: parseTags(draft.tags), usage: draft.usage, freq: draft.freq });
      }
      for (const p of pathNodes(target.id)) ui.expanded[p.id] = true;
      saveUi();
      closeSheet();
      commit();
      toast(`Added ${lines.length} ${draft.asContainer ? 'container' : 'item'}${lines.length === 1 ? '' : 's'}`);
    },
  });
}

/* ----- location picker ----- */
/* opts: onDone() after a move; choose(nodeId) to just pick a place; noGroups; title */
function openPicker(payload, opts = {}) {
  const itemIds = payload.items || [];
  const nodeIds = payload.nodes || [];
  let sel = null;
  const exp = ui.pickerExpanded;
  const first = state.items[itemIds[0]] || state.nodes[nodeIds[0]];
  if (first) for (const p of pathNodes(first.parent)) exp[p.id] = true;
  const label = itemIds.length + nodeIds.length === 1 && first ? `“${first.name}”` : `${itemIds.length + nodeIds.length} things`;
  const invalid = (tid) => (nodeIds.length > 0 && !validTargetForNodes(nodeIds, tid))
    || (opts.noGroups && state.nodes[tid] && state.nodes[tid].kind === 'group');
  const rowsHtml = (pid, depth) => kidsOf(pid).map((n) => {
    const kids = kidsOf(n.id).filter((k) => !nodeIds.includes(k.id));
    if (nodeIds.includes(n.id)) return '';
    const dis = invalid(n.id);
    const open = !!exp[n.id];
    const row = `<div class="p-row ${sel === n.id ? 'sel' : ''} ${dis ? 'disabled' : ''}" style="padding-left:${4 + depth * 16}px">
      <button class="twisty ${kids.length ? '' : 'leaf'}" data-ptoggle="${n.id}">${open ? '▼' : '▶'}</button>
      <span class="node-emoji">${esc(nodeEmoji(n))}</span>
      <button class="p-name" data-pick="${n.id}" ${dis ? 'disabled' : ''}>${esc(n.name)}</button></div>`;
    const body = open && kids.length ? rowsHtml(n.id, depth + 1) : '';
    return n.kind === 'room' ? `<div class="p-room" style="${roomVars(n)}">${row}${body}</div>` : row + body;
  }).join('');
  openSheet({
    html: () => `<h2>${opts.title ? esc(opts.title) : `Move ${esc(label)}`}</h2><div class="sub">Choose where it should go.</div>
      <div class="picker">${rowsHtml(null, 0)}</div>
      <div class="field"><span class="label">To</span><div>${sel ? esc(pathText(sel)) : '<span class="note">Nothing chosen</span>'}</div></div>
      <div class="actions"><button class="btn" data-close>Cancel</button>
        ${opts.choose
    ? `<button class="btn primary" data-pact="choose" ${sel ? '' : 'disabled'}>Use this place</button>`
    : `<button class="btn" data-pact="plan" ${sel ? '' : 'disabled'}>Propose move</button>
        <button class="btn primary" data-pact="move" ${sel ? '' : 'disabled'}>Move</button>`}</div>`,
    click(e) {
      const t = e.target.closest('[data-ptoggle]');
      if (t) { exp[t.dataset.ptoggle] = !exp[t.dataset.ptoggle]; drawSheet(); return; }
      const p = e.target.closest('[data-pick]');
      if (p && !p.disabled) { sel = p.dataset.pick; drawSheet(); return; }
      const a = e.target.closest('[data-pact]');
      if (a && sel) {
        if (a.dataset.pact === 'choose') { opts.choose(sel); return; }
        closeSheet();
        applyMove(payload, sel, a.dataset.pact === 'move' ? 'move' : 'plan');
        if (opts.onDone) opts.onDone();
      }
    },
  });
}

/* ----- drop prompt ----- */
function promptDrop(payload, target) {
  const its = (payload.items || []).map((id) => state.items[id]).filter(Boolean);
  const ns = (payload.nodes || []).map((id) => state.nodes[id]).filter(Boolean);
  const all = [...its, ...ns];
  if (!all.length || !state.nodes[target]) return;
  if (ns.length && !validTargetForNodes(ns.map((n) => n.id), target)) { toast('Storage and groups can’t go there'); return; }
  if (all.every((x) => x.parent === target && !x.plan)) return; // dropped back where it was
  const label = all.length === 1 ? `“${all[0].name}”` : `${all.length} things`;
  const to = pathText(target);
  if (all.length === 1 && all[0].plan === target) {
    confirmSheet({ title: `Move ${label}?`, text: `This is its planned destination: ${esc(to)}. Confirm the move is done?`, ok: 'Move', onOk: () => applyMove(payload, target, 'move') });
    return;
  }
  const hasPlans = all.some((x) => x.plan);
  confirmSheet({
    title: `Move ${label}`,
    text: `To ${esc(to)}`,
    ok: 'Move',
    onOk: () => applyMove(payload, target, 'move'),
    extra: [{ label: hasPlans ? 'Change plan to here' : 'Propose move', onClick: () => applyMove(payload, target, 'plan') }],
  });
}

/* ----- selection actions ----- */
function openBulkSheet() {
  const ids = [...ui.selected].filter((id) => state.items[id]);
  const draft = { tags: '', usage: [], usageTouched: false, freq: undefined, seasonMode: 'keep', season: defaultSeason() };
  openSheet({
    html: () => `<h2>Details for ${ids.length} item${ids.length === 1 ? '' : 's'}</h2>
      <div class="sub">Only what you change here is applied.</div>
      <div class="field"><label for="f-tags">Add tags (comma separated)</label><input id="f-tags" type="text" value="${esc(draft.tags)}" autocapitalize="none">${tagSuggestHtml(parseTags(draft.tags))}</div>
      <div class="field"><span class="label">${USED_IN_LABEL}${draft.usageTouched ? ' <span class="note">(replaces existing)</span>' : ''}</span>${usageOptions().length ? segHtml('usage', usageOptions(), draft.usage) : '<div class="note">Add rooms first.</div>'}</div>
      <div class="field"><span class="label">How often they’re used</span>${segHtml('freq', FREQS, draft.freq)}</div>
      <div class="field"><span class="label">Seasonal</span>${segHtml('smode', [['keep', 'Leave as is'], ['on', 'Seasonal'], ['off', 'Not seasonal']], draft.seasonMode)}
        ${draft.seasonMode === 'on' ? `<div class="row" style="margin-top:6px">In use from ${monthSelect('f-sstart', draft.season.start)} to ${monthSelect('f-send', draft.season.end)}</div>` : ''}</div>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-act="apply">Apply</button></div>`,
    change(e) { if (e.target.matches('#f-sstart,#f-send')) draft.season = readSeason(sheetBody) || draft.season; },
    click(e) {
      const tf = $('#f-tags', sheetBody); if (tf) draft.tags = tf.value;
      const b = e.target.closest('[data-usage],[data-freq],[data-addtag],[data-smode],[data-act]');
      if (!b) return;
      if (b.dataset.smode) { draft.season = readSeason(sheetBody) || draft.season; draft.seasonMode = b.dataset.smode; drawSheet(); return; }
      if (b.dataset.usage) { draft.usageTouched = true; const r = b.dataset.usage; draft.usage = draft.usage.includes(r) ? draft.usage.filter((x) => x !== r) : [...draft.usage, r]; drawSheet(); return; }
      if (b.dataset.freq) { draft.freq = draft.freq === b.dataset.freq ? undefined : b.dataset.freq; drawSheet(); return; }
      if (b.dataset.addtag) { const t = parseTags(draft.tags); if (!t.includes(b.dataset.addtag)) t.push(b.dataset.addtag); draft.tags = t.join(', '); drawSheet(); return; }
      if (b.dataset.act === 'apply') {
        const add = parseTags(draft.tags);
        for (const id of ids) {
          const it = state.items[id];
          for (const t of add) if (!it.tags.includes(t)) it.tags.push(t);
          if (draft.usageTouched) it.usage = [...draft.usage];
          if (draft.freq !== undefined) it.freq = draft.freq;
          if (draft.seasonMode === 'on') it.season = { ...draft.season };
          if (draft.seasonMode === 'off') it.season = null;
        }
        closeSheet(); commit(); toast(`Updated ${ids.length} item${ids.length === 1 ? '' : 's'}`);
      }
    },
  });
}

function groupSelection() {
  const ids = [...ui.selected].filter((id) => state.items[id]);
  if (ids.length < 2) { toast('Select at least 2 items to make a group'); return; }
  let name = '';
  openSheet({
    focus: '#f-gname',
    html: () => `<h2>New group</h2><div class="sub">Created where “${esc(state.items[ids[0]].name)}” is. Items elsewhere can be moved or proposed to move in.</div>
      <div class="field"><input id="f-gname" type="text" placeholder="Group name" value="${esc(name)}"></div>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-act="make">Create group</button></div>`,
    click(e) {
      if (!e.target.closest('[data-act="make"]')) return;
      name = ($('#f-gname', sheetBody).value || '').trim() || 'New group';
      const firstParent = state.items[ids[0]].parent;
      let home = firstParent;
      if (state.nodes[home].kind === 'group') home = state.nodes[home].parent;
      const snap = snapshot();
      const gid = addNode({ kind: 'group', name, parent: home });
      ui.expanded[gid] = true; ui.expanded[home] = true; saveUi();
      const local = ids.filter((id) => {
        const p = state.items[id].parent;
        return p === home || (state.nodes[p] && state.nodes[p].kind === 'group' && state.nodes[p].parent === home);
      });
      const others = ids.filter((id) => !local.includes(id));
      const srcGroups = new Set();
      for (const id of local) {
        const it = state.items[id];
        const p = state.nodes[it.parent];
        if (p && p.kind === 'group') srcGroups.add(p.id);
        it.parent = gid; it.plan = null;
      }
      dissolveCheck(srcGroups);
      ui.selected.clear();
      closeSheet();
      commit();
      if (others.length) promptDrop({ items: others }, gid);
      else toast(`Created group “${name}”`, snap);
    },
  });
}

/* ----- settings ----- */
function openSettings() {
  openSheet({
    html: () => {
      const d = daysAgo(state.meta.lastBackup);
      const imp = state.meta.lastImport;
      const canShare = !!(navigator.canShare && window.File);
      return `<h2>Settings</h2>
      <div class="field"><span class="label">Backup</span>
        <div>Last backup: ${d === null ? 'never' : d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`}</div>
        ${imp ? `<div class="note">Data imported ${new Date(imp.at).toLocaleDateString()} from a backup made ${imp.exported ? new Date(imp.exported).toLocaleDateString() : 'on an unknown date'}.</div>` : ''}
        <div class="row" style="margin-top:8px">
          <button class="btn primary" data-act="download">Download backup</button>
          ${canShare ? '<button class="btn" data-act="share">Share backup…</button>' : ''}
          <button class="btn" data-act="import">Import backup…</button>
        </div>
        <input type="file" id="f-import" accept=".json,application/json" class="hidden">
        <div class="note" style="margin-top:6px">Importing replaces everything on this device.</div></div>
      <div class="field"><span class="label">Tags</span><button class="btn" data-act="tags">Manage tags</button></div>
      <h3 class="set-head">Suggestions</h3>
      <div class="field"><span class="label">In a prime room, suggest moving out anything used less often than</span>${segHtml('lvlprm', LEVEL_OPTIONS, state.settings.primeRoomMin)}</div>
      <div class="field"><span class="label">In prime storage in a normal room, suggest moving out anything used less often than</span>${segHtml('lvlpsm', LEVEL_OPTIONS, state.settings.primeStorageMin)}</div>
      <div class="field"><span class="label">In an awkward room or spot, suggest moving up anything used at least</span>${segHtml('lvlawk', LEVEL_OPTIONS, state.settings.awkwardUpAt)}</div>
      <div class="field"><label for="set-seasonGap">Seasonal items count as rarely used when out of season for at least (months)</label>
        <input id="set-seasonGap" type="number" min="0" max="11" inputmode="numeric" value="${state.settings.seasonGap}" style="max-width:90px"></div>
      <div class="field"><label for="set-createMin">Suggest a new group when at least this many items match</label>
        <input id="set-createMin" type="number" min="2" max="50" inputmode="numeric" value="${state.settings.createMin}" style="max-width:90px"></div>
      <div class="field"><label for="set-oddOneOutMin">Suggest removing an item that doesn’t fit only in groups of at least</label>
        <input id="set-oddOneOutMin" type="number" min="3" max="50" inputmode="numeric" value="${state.settings.oddOneOutMin}" style="max-width:90px"></div>
      <div class="field"><label for="set-backupDays">Remind me to back up after (days)</label>
        <input id="set-backupDays" type="number" min="1" max="365" inputmode="numeric" value="${state.settings.backupDays}" style="max-width:90px"></div>
      <div class="field"><button class="btn small" data-act="set-defaults">Restore default settings</button></div>
      <div class="field"><span class="label">Storage</span><div class="note" id="persist-note">Checking…</div></div>
      <div class="actions"><button class="btn primary" data-close>Done</button></div>
      <div class="version">Stowed ${APP_VERSION}</div>`;
    },
    mount(root) {
      const note = $('#persist-note', root);
      if (navigator.storage && navigator.storage.persisted) {
        navigator.storage.persisted().then((p) => {
          if (note) note.textContent = p ? 'Data is stored persistently on this device.' : 'The browser may clear data under storage pressure. Keep regular backups.';
        }).catch(() => { if (note) note.textContent = 'Unknown. Keep regular backups.'; });
      } else if (note) note.textContent = 'Unknown. Keep regular backups.';
    },
    change(e) {
      if (e.target.id === 'f-import' && e.target.files[0]) importBackup(e.target.files[0]);
      const m = e.target.id && e.target.id.match(/^set-(seasonGap|createMin|oddOneOutMin|backupDays)$/);
      if (m) {
        state.settings = normalizeSettings({ ...state.settings, [m[1]]: e.target.value });
        e.target.value = state.settings[m[1]];
        commit();
      }
    },
    click(e) {
      const lv = e.target.closest('[data-lvlprm],[data-lvlpsm],[data-lvlawk]');
      if (lv) {
        const key = lv.dataset.lvlprm ? 'primeRoomMin' : lv.dataset.lvlpsm ? 'primeStorageMin' : 'awkwardUpAt';
        state.settings[key] = lv.dataset.lvlprm || lv.dataset.lvlpsm || lv.dataset.lvlawk;
        commit(); drawSheet();
        return;
      }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'download') exportBackup(false);
      if (b.dataset.act === 'share') exportBackup(true);
      if (b.dataset.act === 'import') $('#f-import', sheetBody).click();
      if (b.dataset.act === 'tags') openTagManager();
      if (b.dataset.act === 'set-defaults') { state.settings = Object.assign({}, SETTING_DEFAULTS); commit(); drawSheet(); toast('Default settings restored'); }
    },
  });
}

function openTagManager() {
  openSheet({
    html: () => {
      const tags = allTags();
      return `<h2>Tags</h2>
        ${tags.length ? tags.map(([t, n]) => `<div class="list-row"><div class="grow"><div class="title">#${esc(t)}</div><div class="path">${n} item${n === 1 ? '' : 's'}</div></div>
          <button class="btn small" data-rename="${esc(t)}">Rename</button><button class="btn small danger" data-deltag="${esc(t)}">Delete</button></div>`).join('') : '<div class="note">No tags yet.</div>'}
        <div class="actions"><button class="btn" data-act="back">Back</button><button class="btn primary" data-close>Done</button></div>`;
    },
    click(e) {
      const r = e.target.closest('[data-rename]');
      const d = e.target.closest('[data-deltag]');
      if (e.target.closest('[data-act="back"]')) { openSettings(); return; }
      if (r) renameTag(r.dataset.rename);
      if (d) {
        const t = d.dataset.deltag;
        const n = Object.values(state.items).filter((i) => i.tags.includes(t)).length;
        confirmSheet({
          title: `Delete tag “${t}”?`, text: `It’s removed from ${n} item${n === 1 ? '' : 's'}.`, ok: 'Delete', danger: true,
          onOk: () => { const snap = snapshot(); for (const it of Object.values(state.items)) it.tags = it.tags.filter((x) => x !== t); commit(); toast(`Deleted tag “${t}”`, snap); openTagManager(); },
        });
      }
    },
  });
}

function renameTag(oldTag) {
  openSheet({
    focus: '#f-tag',
    html: () => `<h2>Rename tag</h2><div class="field"><input id="f-tag" type="text" value="${esc(oldTag)}" autocapitalize="none"></div>
      <div class="note">If the new name already exists, the two tags are merged.</div>
      <div class="actions"><button class="btn" data-act="back">Cancel</button><button class="btn primary" data-act="save">Rename</button></div>`,
    click(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'back') { openTagManager(); return; }
      const nt = parseTags($('#f-tag', sheetBody).value)[0];
      if (!nt) { toast('Enter a tag name'); return; }
      for (const it of Object.values(state.items)) {
        if (it.tags.includes(oldTag)) it.tags = parseTags(it.tags.map((x) => (x === oldTag ? nt : x)).join(','));
      }
      commit();
      openTagManager();
    },
  });
}

/* ----- backup ----- */
function backupBlob() {
  const data = { app: 'stowed', schema: 1, version: APP_VERSION, exported: new Date().toISOString(), nodes: state.nodes, items: state.items, dismissed: state.dismissed, settings: state.settings };
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}
function backupName() { return `stowed-backup-${new Date().toISOString().slice(0, 10)}.json`; }
function markBackup() { state.meta.lastBackup = Date.now(); commit(); if (sheetCtl) drawSheet(); }

async function exportBackup(share) {
  await flushSave();
  const blob = backupBlob();
  const name = backupName();
  if (share) {
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        markBackup();
        toast('Backup shared');
        return;
      }
      toast('Sharing files isn’t supported here; downloading instead');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('Sharing failed; downloading instead');
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  markBackup();
  toast(`Downloaded ${name}`);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { toast('That file isn’t a valid backup'); return; }
    if (!data || data.app !== 'stowed' || typeof data.nodes !== 'object' || typeof data.items !== 'object') {
      toast('That file isn’t a Stowed backup');
      return;
    }
    const n = Object.keys(data.items).length;
    const when = data.exported ? new Date(data.exported).toLocaleString() : 'an unknown date';
    confirmSheet({
      title: 'Replace all data?',
      text: `This replaces everything on this device with the backup from ${esc(when)} (${n} item${n === 1 ? '' : 's'}).`,
      ok: 'Replace', danger: true,
      onOk: () => {
        const snap = snapshot();
        const next = normalize({ nodes: data.nodes, items: data.items, dismissed: data.dismissed, settings: data.settings || state.settings, meta: state.meta });
        state.nodes = next.nodes;
        state.items = next.items;
        state.dismissed = next.dismissed;
        state.settings = next.settings;
        state.meta.lastImport = { at: Date.now(), exported: data.exported || null };
        ui.selected.clear();
        commit();
        toast('Backup imported', snap);
      },
    });
  };
  reader.onerror = () => toast('Could not read that file');
  reader.readAsText(file);
}

/* ----- toast ----- */
let toastTimer = null;
function toast(msg, undoSnap) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undoSnap ? '<button data-undo>Undo</button>' : ''}`;
  t.classList.remove('hidden');
  const btn = $('[data-undo]', t);
  if (btn) btn.onclick = () => { t.classList.add('hidden'); restore(undoSnap); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), undoSnap ? 8000 : 3000);
}

/* ----- reveal a node in the tree ----- */
function reveal(nodeId, itemId) {
  for (const p of pathNodes(nodeId)) ui.expanded[p.id] = true;
  saveUi();
  ui.search = '';
  $('#search').value = '';
  ui.view = 'rooms';
  render();
  requestAnimationFrame(() => {
    const el = itemId ? document.querySelector(`[data-item="${itemId}"]:not([data-ghost])`) : document.querySelector(`[data-node-row="${nodeId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.animate([{ outline: '3px solid var(--accent)' }, { outline: '3px solid transparent' }], { duration: 1600 });
    }
  });
}

/* ============================================================
   Event handling
   ============================================================ */
let suppressClickUntil = 0;

function handleAction(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case 'toggle': ui.expanded[id] = !ui.expanded[id]; saveUi(); render(); break;
    case 'access': {
      const n = state.nodes[id];
      n.access = ACCESS[(ACCESS.indexOf(n.access) + 1) % ACCESS.length];
      commit();
      toast(`${n.name}: ${ACCESS_LABEL[n.access]}`);
      break;
    }
    case 'add': openAddSheet(id); break;
    case 'edit-node': openNodeSheet(id); break;
    case 'add-room': openNodeSheet(null); break;
    case 'fab': openAddSheet(LIMBO); break;
    case 'settings': openSettings(); break;
    case 'backup': exportBackup(false); break;
    case 'reveal': reveal(id); break;
    case 'select':
      ui.select = !ui.select;
      if (!ui.select) ui.selected.clear();
      render();
      break;
    case 'sel-details': openBulkSheet(); break;
    case 'sug-scope':
      openPicker({}, {
        title: 'Suggestions for…',
        choose: (sel) => showSuggestionsFor({ kind: 'node', id: sel }),
      });
      break;
    case 'sug-scope-all': showSuggestionsFor(null); break;
    case 'reset-sugs':
      confirmSheet({
        title: 'Reset suggestions?',
        text: 'Everything you’ve dismissed is forgotten and suggestions are worked out again from scratch.',
        ok: 'Reset',
        onOk: () => {
          const snap = snapshot();
          state.dismissed = {};
          commit();
          toast(`Suggestions recalculated: ${lastSugs.length}`, snap);
        },
      });
      break;
    case 'sel-move': openPicker({ items: [...ui.selected] }, { onDone: () => { ui.selected.clear(); render(); } }); break;
    case 'sel-group': groupSelection(); break;
    case 'sel-delete': {
      const ids = [...ui.selected];
      confirmSheet({
        title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`, ok: 'Delete', danger: true,
        onOk: () => { const snap = snapshot(); deleteItems(ids); commit(); toast(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, snap); },
      });
      break;
    }
    case 'plan-ok': {
      const x = el.dataset.kind === 'node' ? state.nodes[id] : state.items[id];
      if (x && x.plan) applyMove(el.dataset.kind === 'node' ? { nodes: [id] } : { items: [id] }, x.plan, 'move');
      break;
    }
    case 'plan-cancel': cancelPlans(el.dataset.kind === 'node' ? { nodes: [id] } : { items: [id] }); break;
    case 'plan-all': {
      const its = Object.values(state.items).filter((i) => i.plan);
      const ns = Object.values(state.nodes).filter((n) => n.plan);
      confirmSheet({
        title: 'Confirm all planned moves?', text: `${its.length + ns.length} move${its.length + ns.length === 1 ? '' : 's'} will be marked as done.`, ok: 'Confirm all',
        onOk: () => {
          const snap = snapshot();
          const srcGroups = new Set();
          for (const n of ns) { if (validTargetForNodes([n.id], n.plan)) n.parent = n.plan; n.plan = null; }
          for (const i of its) {
            const p = state.nodes[i.parent];
            if (p && p.kind === 'group') srcGroups.add(p.id);
            i.parent = i.plan; i.plan = null;
          }
          dissolveCheck(srcGroups);
          commit();
          toast('All planned moves confirmed', snap);
        },
      });
      break;
    }
    default: break;
  }
}

function itemTap(id, isGhost) {
  if (ui.select && !isGhost) {
    if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id);
    render();
    return;
  }
  openItemSheet(id);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#sheet-root') || e.target.closest('#toast')) return;
  if (Date.now() < suppressClickUntil) { suppressClickUntil = 0; e.preventDefault(); e.stopPropagation(); return; }
  const sa = e.target.closest('[data-sact]');
  if (sa) { handleSuggestion(sa.dataset.sact, lastSugs[+sa.dataset.sug]); return; }
  const a = e.target.closest('[data-action]');
  if (a) { handleAction(a.dataset.action, a); return; }
  const it = e.target.closest('[data-item]');
  if (it) { itemTap(it.dataset.item, !!it.dataset.ghost); return; }
  const v = e.target.closest('[data-view]');
  if (v) {
    ui.view = v.dataset.view;
    ui.search = '';
    $('#search').value = '';
    saveUi();
    render();
    window.scrollTo(0, 0);
  }
}, true);

$('#search').addEventListener('input', (e) => { ui.search = e.target.value; render(); });

/* ----- drag and drop (long-press on touch, drag with mouse) ----- */
let press = null;
let drag = null;
let autoScrollRaf = null;

/* Draggable things: tree chips and rows, or chips inside the split sheet. */
function dragSource(target) {
  if (sheetCtl) return sheetCtl.split ? target.closest('#sheet-body [data-split-drag]') : null;
  if (target.closest('.mini-btn')) return null;
  return target.closest('#app [data-drag-item], #app [data-drag-node]');
}

function payloadFor(el) {
  if (el.dataset.splitDrag) return { split: el.dataset.splitDrag, items: [], nodes: [] };
  if (el.dataset.dragItem) {
    const id = el.dataset.dragItem;
    if (ui.select && ui.selected.has(id)) return { items: [...ui.selected], nodes: [] };
    return { items: [id], nodes: [] };
  }
  return { items: [], nodes: [el.dataset.dragNode] };
}
function payloadLabel(p, el) {
  if (p.split) return el.textContent;
  const n = p.items.length + p.nodes.length;
  if (n !== 1) return `${n} things`;
  const x = state.items[p.items[0]] || state.nodes[p.nodes[0]];
  return x ? x.name : '';
}

function startDrag(el, x, y) {
  press = null;
  const payload = payloadFor(el);
  drag = { payload, el, x, y, startX: x, startY: y, target: null, hoverId: null, hoverSince: 0, split: !!payload.split };
  const g = $('#drag-ghost');
  g.textContent = payloadLabel(payload, el);
  g.classList.remove('hidden');
  document.body.classList.add('dragging');
  el.classList.add('dragging-src');
  if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* ignore */ } }
  moveDrag(x, y);
  if (!drag.split) autoScroll();
}

function moveDrag(x, y) {
  drag.x = x; drag.y = y;
  const g = $('#drag-ghost');
  g.style.left = `${x}px`;
  g.style.top = `${y}px`;
  document.querySelectorAll('.drop-hover').forEach((n) => n.classList.remove('drop-hover'));
  const under = document.elementFromPoint(x, y);
  if (drag.split) {
    const side = under && under.closest('#sheet-body [data-split-side]');
    drag.target = side ? side.dataset.splitSide : null;
    if (side) side.classList.add('drop-hover');
    return;
  }
  const hit = under && under.closest('#app [data-drop]');
  drag.target = hit ? hit.dataset.drop : null;
  if (hit) hit.classList.add('drop-hover');
  // Hovering over a collapsed row opens it after a moment.
  const row = under && under.closest('#app [data-node-row]');
  const rid = row ? row.dataset.nodeRow : null;
  if (rid !== drag.hoverId) { drag.hoverId = rid; drag.hoverSince = Date.now(); }
  else if (rid && !isOpen(rid) && Date.now() - drag.hoverSince > 650) {
    ui.expanded[rid] = true; saveUi(); render();
    drag.hoverSince = Date.now();
  }
}

function autoScroll() {
  cancelAnimationFrame(autoScrollRaf);
  const step = () => {
    if (!drag) return;
    const topEdge = $('.topbar').getBoundingClientRect().bottom + 40;
    if (drag.y < topEdge) window.scrollBy(0, -10);
    else if (drag.y > window.innerHeight - 70) window.scrollBy(0, 10);
    autoScrollRaf = requestAnimationFrame(step);
  };
  autoScrollRaf = requestAnimationFrame(step);
}

function endDrag(cancelled) {
  if (!drag) return;
  const d = drag;
  drag = null;
  cancelAnimationFrame(autoScrollRaf);
  $('#drag-ghost').classList.add('hidden');
  document.body.classList.remove('dragging');
  document.querySelectorAll('.drop-hover').forEach((n) => n.classList.remove('drop-hover'));
  document.querySelectorAll('.dragging-src').forEach((n) => n.classList.remove('dragging-src'));
  // The browser fires a stray click right after a mouse drag ends; swallow only that one.
  suppressClickUntil = Date.now() + 120;
  // A long press released without moving is not a drop.
  const moved = Math.hypot(d.x - d.startX, d.y - d.startY) > 15;
  if (cancelled || !moved || !d.target) return;
  if (d.split) { if (sheetCtl && sheetCtl.splitDrop) sheetCtl.splitDrop(d.payload.split, d.target); }
  else promptDrop(d.payload, d.target);
}

function cancelPress() { if (press) { clearTimeout(press.timer); press = null; } }

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { cancelPress(); return; }
  const el = dragSource(e.target);
  if (!el) return;
  const t = e.touches[0];
  press = { el, x: t.clientX, y: t.clientY, timer: setTimeout(() => { if (press) startDrag(press.el, press.x, press.y); }, 380) };
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  const t = e.touches[0];
  if (drag) { e.preventDefault(); moveDrag(t.clientX, t.clientY); return; }
  if (press && Math.hypot(t.clientX - press.x, t.clientY - press.y) > 10) cancelPress();
}, { passive: false });

document.addEventListener('touchend', (e) => {
  if (drag) { e.preventDefault(); endDrag(false); }
  cancelPress();
}, { passive: false });
document.addEventListener('touchcancel', () => { endDrag(true); cancelPress(); });

document.addEventListener('contextmenu', (e) => { if (press || drag) e.preventDefault(); });

document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const el = dragSource(e.target);
  if (!el) return;
  press = { el, x: e.clientX, y: e.clientY, mouse: true };
});
document.addEventListener('mousemove', (e) => {
  if (drag) { moveDrag(e.clientX, e.clientY); return; }
  if (press && press.mouse && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) startDrag(press.el, e.clientX, e.clientY);
});
document.addEventListener('mouseup', () => {
  if (drag) endDrag(false);
  press = null;
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && saveTimer) flushSave(); });
window.addEventListener('pagehide', () => { if (saveTimer) flushSave(); });

/* ============================================================
   Start
   ============================================================ */
async function init() {
  let loaded = null;
  try { loaded = await idbGet('state'); } catch (e) {
    console.error(e);
    storageOk = false;
  }
  state = normalize(loaded || freshState());
  loadUi();
  if (!state.nodes[LIMBO]) state.nodes[LIMBO] = freshState().nodes[LIMBO];
  render();
  if (!storageOk) toast('This browser isn’t letting the app save. Data will be lost on close.');
  if (!loaded && storageOk) flushSave();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((r) => r.update())
      .catch((e) => console.warn('SW registration failed', e));
  }
}
init();
