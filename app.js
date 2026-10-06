'use strict';

/* ============================================================
   Stowed — home inventory. Local-only (IndexedDB), backup files.
   ============================================================ */

const APP_VERSION = '0.1.0';
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
    if (!it.parent || !s.nodes[it.parent]) it.parent = LIMBO;
    if (!it.plan || !s.nodes[it.plan] || it.plan === it.parent) it.plan = null;
    if (!it.created) it.created = Date.now();
  }
  return s;
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
function needsInfo(it) {
  const miss = [];
  if (!it.tags.length) miss.push('tags');
  if (!it.usage.length) miss.push('used in');
  if (!it.freq) miss.push('frequency');
  return miss;
}

/* ---------- commit / undo ---------- */
function commit() { save(); render(); }
function snapshot() { return JSON.stringify({ nodes: state.nodes, items: state.items }); }
function restore(snap) {
  const o = JSON.parse(snap);
  state.nodes = o.nodes;
  state.items = o.items;
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
    order: nextOrder(), plan: null, mobile: false, isGroup: false,
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
   Rendering
   ============================================================ */
function render() {
  RC = buildIndex();
  try {
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
  if (count && (d === null || d >= 7)) {
    html = `<div class="banner"><span>Last backup: ${d === null ? 'never' : `${d} days ago`}</span>
      <button class="btn small" data-action="backup">Back up</button></div>`;
  }
  $('#banner').innerHTML = html;
}

function renderMain() {
  const main = $('#app');
  if (ui.search.trim()) { main.innerHTML = renderSearch(); return; }
  if (ui.view === 'moves') main.innerHTML = renderMoves();
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
  return `<button class="${cls.join(' ')}" data-item="${it.id}" data-drag-item="${it.id}">${esc(it.name)}${it.qty > 1 ? `<span class="qty">×${it.qty}</span>` : ''}</button>`;
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
  if (!its.length) return `<div class="empty">Every item has tags, usage locations and frequency.</div>`;
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
      <div class="field"><span class="label">Used in</span>${usage.length ? segHtml('usage', usage, it.usage) : '<div class="note">Add rooms first.</div>'}</div>
      <div class="field"><span class="label">How often it’s used</span>${segHtml('freq', FREQS, it.freq)}</div>
      <div class="field"><span class="label">Location</span>
        <div class="row"><span class="grow">${esc(pathText(it.parent))}</span>
        <button class="btn small" data-act="relocate">Move…</button><button class="btn small" data-act="show">Show</button></div></div>
      ${it.plan ? `<div class="field"><span class="label">Planned move</span>
        <div>→ ${esc(pathText(it.plan))}</div>
        <div class="row" style="margin-top:6px"><button class="btn small" data-act="plan-cancel">Cancel plan</button>
        <button class="btn small primary" data-act="plan-ok">Confirm move done</button></div></div>` : ''}
      <div class="actions spread"><button class="btn danger" data-act="delete">Delete</button><button class="btn primary" data-close>Done</button></div>`;
    },
    onClose: commitFields,
    change(e) { if (e.target.matches('#f-name,#f-qty,#f-tags')) { commitFields(); } },
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
      if (!isNew && n.kind !== 'room') {
        h += `<div class="field"><span class="label">Location</span><div class="row"><span class="grow">${esc(pathText(n.parent))}</span>
          <button class="btn small" data-act="relocate">Move…</button></div></div>`;
        if (n.plan) {
          h += `<div class="field"><span class="label">Planned move</span><div>→ ${esc(pathText(n.plan))}</div>
            <div class="row" style="margin-top:6px"><button class="btn small" data-act="plan-cancel">Cancel plan</button>
            <button class="btn small primary" data-act="plan-ok">Confirm move done</button></div></div>`;
        }
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
    },
    input(e) {
      if (e.target.id === 'f-emoji') {
        const g = firstGrapheme(e.target.value);
        n.emoji = g;
        if (!isNew) { save(); render(); }
      }
    },
    click(e) {
      const b = e.target.closest('[data-emoji],[data-color],[data-access],[data-mobile],[data-act]');
      if (!b) return;
      const nameField = $('#f-name', sheetBody);
      if (isNew && nameField) n.name = nameField.value;
      else commitName();
      if (b.dataset.emoji) { n.emoji = b.dataset.emoji; }
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
        <div class="field"><span class="label">Used in</span>${usageOptions().length ? segHtml('usage', usageOptions(), draft.usage) : '<div class="note">Add rooms first.</div>'}</div>
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
function openPicker(payload, onDone) {
  const itemIds = payload.items || [];
  const nodeIds = payload.nodes || [];
  let sel = null;
  const exp = ui.pickerExpanded;
  const first = state.items[itemIds[0]] || state.nodes[nodeIds[0]];
  if (first) for (const p of pathNodes(first.parent)) exp[p.id] = true;
  const label = itemIds.length + nodeIds.length === 1 ? `“${first.name}”` : `${itemIds.length + nodeIds.length} things`;
  const invalid = (tid) => nodeIds.length > 0 && !validTargetForNodes(nodeIds, tid);
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
    html: () => `<h2>Move ${esc(label)}</h2><div class="sub">Choose where it should go.</div>
      <div class="picker">${rowsHtml(null, 0)}</div>
      <div class="field"><span class="label">To</span><div>${sel ? esc(pathText(sel)) : '<span class="note">Nothing chosen</span>'}</div></div>
      <div class="actions"><button class="btn" data-close>Cancel</button>
        <button class="btn" data-pact="plan" ${sel ? '' : 'disabled'}>Propose move</button>
        <button class="btn primary" data-pact="move" ${sel ? '' : 'disabled'}>Move</button></div>`,
    click(e) {
      const t = e.target.closest('[data-ptoggle]');
      if (t) { exp[t.dataset.ptoggle] = !exp[t.dataset.ptoggle]; drawSheet(); return; }
      const p = e.target.closest('[data-pick]');
      if (p && !p.disabled) { sel = p.dataset.pick; drawSheet(); return; }
      const a = e.target.closest('[data-pact]');
      if (a && sel) {
        closeSheet();
        applyMove(payload, sel, a.dataset.pact === 'move' ? 'move' : 'plan');
        if (onDone) onDone();
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
  const draft = { tags: '', usage: [], usageTouched: false, freq: undefined };
  openSheet({
    html: () => `<h2>Details for ${ids.length} item${ids.length === 1 ? '' : 's'}</h2>
      <div class="sub">Only what you change here is applied.</div>
      <div class="field"><label for="f-tags">Add tags (comma separated)</label><input id="f-tags" type="text" value="${esc(draft.tags)}" autocapitalize="none">${tagSuggestHtml(parseTags(draft.tags))}</div>
      <div class="field"><span class="label">Used in ${draft.usageTouched ? '(replaces existing)' : ''}</span>${usageOptions().length ? segHtml('usage', usageOptions(), draft.usage) : '<div class="note">Add rooms first.</div>'}</div>
      <div class="field"><span class="label">How often they’re used</span>${segHtml('freq', FREQS, draft.freq)}</div>
      <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" data-act="apply">Apply</button></div>`,
    click(e) {
      const tf = $('#f-tags', sheetBody); if (tf) draft.tags = tf.value;
      const b = e.target.closest('[data-usage],[data-freq],[data-addtag],[data-act]');
      if (!b) return;
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
    },
    click(e) {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'download') exportBackup(false);
      if (b.dataset.act === 'share') exportBackup(true);
      if (b.dataset.act === 'import') $('#f-import', sheetBody).click();
      if (b.dataset.act === 'tags') openTagManager();
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
  const data = { app: 'stowed', schema: 1, version: APP_VERSION, exported: new Date().toISOString(), nodes: state.nodes, items: state.items };
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
        const next = normalize({ nodes: data.nodes, items: data.items, meta: state.meta });
        state.nodes = next.nodes;
        state.items = next.items;
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
    case 'sel-move': openPicker({ items: [...ui.selected] }, () => { ui.selected.clear(); render(); }); break;
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

function payloadFor(el) {
  if (el.dataset.dragItem) {
    const id = el.dataset.dragItem;
    if (ui.select && ui.selected.has(id)) return { items: [...ui.selected], nodes: [] };
    return { items: [id], nodes: [] };
  }
  return { items: [], nodes: [el.dataset.dragNode] };
}
function payloadLabel(p) {
  const n = p.items.length + p.nodes.length;
  if (n !== 1) return `${n} things`;
  const x = state.items[p.items[0]] || state.nodes[p.nodes[0]];
  return x ? x.name : '';
}

function startDrag(el, x, y) {
  press = null;
  const payload = payloadFor(el);
  drag = { payload, el, x, y, startX: x, startY: y, target: null, hoverId: null, hoverSince: 0 };
  const g = $('#drag-ghost');
  g.textContent = payloadLabel(payload);
  g.classList.remove('hidden');
  document.body.classList.add('dragging');
  el.classList.add('dragging-src');
  if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* ignore */ } }
  moveDrag(x, y);
  autoScroll();
}

function moveDrag(x, y) {
  drag.x = x; drag.y = y;
  const g = $('#drag-ghost');
  g.style.left = `${x}px`;
  g.style.top = `${y}px`;
  document.querySelectorAll('.drop-hover').forEach((n) => n.classList.remove('drop-hover'));
  const under = document.elementFromPoint(x, y);
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
  if (!cancelled && moved && d.target) promptDrop(d.payload, d.target);
}

function cancelPress() { if (press) { clearTimeout(press.timer); press = null; } }

document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1 || sheetCtl) { cancelPress(); return; }
  const el = e.target.closest('#app [data-drag-item], #app [data-drag-node]');
  if (!el || e.target.closest('.mini-btn')) return;
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
  if (e.button !== 0 || sheetCtl) return;
  const el = e.target.closest('#app [data-drag-item], #app [data-drag-node]');
  if (!el || e.target.closest('.mini-btn')) return;
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
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
}
init();
