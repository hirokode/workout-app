// 端末内のデータ（IndexedDB）。
// 起動時に全部を読み込んでメモリに持ち、変更はすぐ IndexedDB に書く。
// 変更した行は「未同期」（outbox）に積み、sync.js がまとめてサーバーに送る。
// 削除は行を消さずに deleted=true にする（サーバーや別の端末に削除を伝えるため）。

import { nowIso } from './util.js';
import { seedExercises, seedTemplates, SEED_VERSION } from './seed.js';

export const TABLES = ['exercises', 'logs', 'templates', 'conditions', 'settings', 'plans'];

// サーバー（スプレッドシート）の列と型。gas/Db.js の SCHEMA と列名をそろえる
const FIELDS = {
  exercises: { id: 's', name: 's', type: 's', parts: 's', step: 'n', initial_weight: 'n', per_hand: 'b', sort_order: 'n',
    active: 'b', created_at: 's', updated_at: 's', deleted: 'b' },
  logs: { id: 's', date: 's', exercise_id: 's', kind: 's', set_no: 'n', weight: 'n', reps: 'n', added_weight: 'n',
    duration_min: 'n', distance_km: 'n', calories: 'n', memo: 's', created_at: 's', updated_at: 's', deleted: 'b' },
  templates: { id: 's', name: 's', items: 'j', weekday: 'n', sort_order: 'n', created_at: 's', updated_at: 's', deleted: 'b' },
  conditions: { id: 's', date: 's', am_sys: 'n', am_dia: 'n', pm_sys: 'n', pm_dia: 'n', weight: 'n', memo: 's',
    field_times: 'j', created_at: 's', updated_at: 's', deleted: 'b' },
  settings: { id: 's', value: 's', updated_at: 's', deleted: 'b' },
  plans: { id: 's', date: 's', template_id: 's', status: 's', created_at: 's', updated_at: 's', deleted: 'b' }
};

// 体調の項目のまとまり（朝の血圧・夜の血圧・体重・メモ）。まとまりごとに新しいほうを残す
export const CONDITION_GROUPS = { am: ['am_sys', 'am_dia'], pm: ['pm_sys', 'pm_dia'], weight: ['weight'], memo: ['memo'] };

const DB_NAME = 'workout-app';
const DB_VERSION = 2; // 2：plans（予定）を追加

let idb = null;
const data = {};
TABLES.forEach(t => { data[t] = new Map(); });
const meta = { outbox: {}, since: '', seeded: false, seedVersion: 0 };
const listeners = new Set();
let ver = 0; // 変更のたびに増える（calc.js の集計の作り直しの目印）

// ---------- IndexedDB ----------

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      TABLES.forEach(t => { if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: 'id' }); });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(storeName, 'readonly');
    if (storeName === 'meta') {
      const out = {};
      const cur = tx.objectStore('meta').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) { out[c.key] = c.value; c.continue(); } else resolve(out);
      };
      cur.onerror = () => reject(cur.error);
      return;
    }
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// まとめて書く。失敗しても画面は動かし続ける（メモリには入っている）
function idbWrite(rowsByTable, metaKeys) {
  if (!idb) return Promise.resolve();
  return new Promise(resolve => {
    try {
      const names = [...Object.keys(rowsByTable), ...(metaKeys.length ? ['meta'] : [])];
      const tx = idb.transaction(names, 'readwrite');
      Object.entries(rowsByTable).forEach(([t, rows]) => {
        const os = tx.objectStore(t);
        rows.forEach(r => os.put(r));
      });
      if (metaKeys.length) {
        const os = tx.objectStore('meta');
        metaKeys.forEach(k => os.put(meta[k], k));
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => { console.error(tx.error); resolve(); };
      tx.onabort = () => { console.error(tx.error); resolve(); };
    } catch (e) {
      console.error(e);
      resolve();
    }
  });
}

// ---------- 起動 ----------

export async function init() {
  try {
    idb = await openIdb();
    for (const t of TABLES) {
      const rows = await idbAll(t);
      rows.forEach(r => data[t].set(r.id, r));
    }
    Object.assign(meta, await idbAll('meta'));
  } catch (e) {
    console.error(e);
    idb = null; // 使えない環境（プライベートブラウズなど）ではメモリだけで動かす
  }
  // 初期データ。版が上がったら、まだ無い ID の分だけ足す（削除した初期データは deleted の行が残っているので復活しない）
  const seedVer = meta.seedVersion || (meta.seeded ? 1 : 0);
  if (seedVer < SEED_VERSION) {
    const ex = seedExercises().filter(r => !data.exercises.has(r.id));
    const tp = seedTemplates().filter(r => !data.templates.has(r.id));
    ex.forEach(r => { data.exercises.set(r.id, r); meta.outbox['exercises:' + r.id] = r.updated_at; });
    tp.forEach(r => { data.templates.set(r.id, r); meta.outbox['templates:' + r.id] = r.updated_at; });
    meta.seeded = true;
    meta.seedVersion = SEED_VERSION;
    await idbWrite({ exercises: ex, templates: tp }, ['seeded', 'seedVersion', 'outbox']);
  }
  return { persistent: !!idb };
}

// ---------- 読み出し ----------

// 削除されていない行
export function all(table) {
  return [...data[table].values()].filter(r => !r.deleted);
}

export function get(table, id) {
  const r = data[table].get(id);
  return r && !r.deleted ? r : null;
}

// 削除済みも含めて（過去の記録に、削除した種目の名前を出すため）
export function getAny(table, id) {
  return data[table].get(id) || null;
}

// ---------- 書き込み ----------

// 行を保存する（新規・変更とも）。updated_at を付け、未同期に積む
export async function put(table, row) {
  const now = nowIso();
  const cur = data[table].get(row.id);
  const next = { ...row, updated_at: now };
  if (!next.created_at && table !== 'settings') next.created_at = cur && cur.created_at ? cur.created_at : now;
  if (next.deleted === undefined) next.deleted = false;
  data[table].set(next.id, next);
  meta.outbox[table + ':' + next.id] = now;
  emit();
  await idbWrite({ [table]: [next] }, ['outbox']);
  return next;
}

export async function putMany(table, rows) {
  const now = nowIso();
  const list = rows.map(row => {
    const cur = data[table].get(row.id);
    const next = { ...row, updated_at: now };
    if (!next.created_at && table !== 'settings') next.created_at = cur && cur.created_at ? cur.created_at : now;
    if (next.deleted === undefined) next.deleted = false;
    data[table].set(next.id, next);
    meta.outbox[table + ':' + next.id] = now;
    return next;
  });
  emit();
  await idbWrite({ [table]: list }, ['outbox']);
  return list;
}

export async function remove(table, id) {
  const cur = data[table].get(id);
  if (!cur) return null;
  return put(table, { ...cur, deleted: true });
}

// 体調の行を、変えたまとまりだけ更新する（朝だけ保存しても夜の値は消えない）
export async function putCondition(date, values, groups) {
  const cur = data.conditions.get(date);
  const now = nowIso();
  const row = cur ? { ...cur, deleted: false } : { id: date, date, field_times: {} };
  const times = { ...(row.field_times || {}) };
  groups.forEach(g => {
    CONDITION_GROUPS[g].forEach(f => { row[f] = values[f] ?? null; });
    times[g] = now;
  });
  row.field_times = times;
  return put('conditions', row);
}

// ---------- 同期用 ----------

export function pendingCount() {
  return Object.keys(meta.outbox).length;
}

export function getSince() {
  return meta.since || '';
}

// 未同期の行をサーバーに送る形で取り出す。sent は送った時点の印（送信中にまた変わったら消さないため）
export function takeOutbox(limit = 1000) {
  const changes = {};
  const sent = {};
  Object.entries(meta.outbox).slice(0, limit).forEach(([key, stamp]) => {
    const i = key.indexOf(':');
    const table = key.slice(0, i);
    const row = data[table] && data[table].get(key.slice(i + 1));
    sent[key] = stamp;
    if (!row) return;
    (changes[table] = changes[table] || []).push(toServer(table, row));
  });
  return { changes, sent };
}

// サーバーから届いた行を取り込む。端末に未同期のより新しい変更があれば、そちらを残す
export async function applyServer(rowsByTable, sent, now) {
  const written = {};
  Object.entries(sent).forEach(([key, stamp]) => {
    if (meta.outbox[key] === stamp) delete meta.outbox[key];
  });
  Object.entries(rowsByTable || {}).forEach(([table, rows]) => {
    if (!data[table]) return;
    rows.forEach(raw => {
      const inc = fromServer(table, raw);
      const cur = data[table].get(inc.id);
      let next = inc;
      if (cur && meta.outbox[table + ':' + inc.id]) {
        if (table === 'conditions') {
          next = mergeCondition(cur, inc);
        } else if (cur.updated_at > inc.updated_at) {
          return;
        }
      }
      data[table].set(next.id, next);
      (written[table] = written[table] || []).push(next);
    });
  });
  if (now) meta.since = now;
  emit('server');
  await idbWrite(written, ['outbox', 'since']);
}

// 「サーバーから全部取り直す」用
export async function resetSince() {
  meta.since = '';
  await idbWrite({}, ['since']);
}

export function mergeCondition(a, b) {
  const ta = a.field_times || {};
  const tb = b.field_times || {};
  const out = { ...(b.updated_at >= a.updated_at ? b : a) };
  const times = {};
  Object.entries(CONDITION_GROUPS).forEach(([g, fields]) => {
    const useB = (tb[g] || '') >= (ta[g] || '');
    const src = useB ? b : a;
    fields.forEach(f => { out[f] = src[f]; });
    const t = useB ? tb[g] : ta[g];
    if (t) times[g] = t;
  });
  out.field_times = times;
  return out;
}

// ---------- 形の変換（サーバーは全部文字列） ----------

function toServer(table, row) {
  const out = {};
  Object.entries(FIELDS[table]).forEach(([f, type]) => {
    const v = row[f];
    if (type === 'b') out[f] = v ? 'TRUE' : 'FALSE';
    else if (type === 'j') out[f] = v == null ? '' : JSON.stringify(v);
    else out[f] = v == null ? '' : String(v);
  });
  return out;
}

function fromServer(table, raw) {
  const out = {};
  Object.entries(FIELDS[table]).forEach(([f, type]) => {
    const v = raw[f];
    if (type === 'b') out[f] = v === 'TRUE' || v === true;
    else if (type === 'n') out[f] = v === '' || v == null || !isFinite(Number(v)) ? null : Number(v);
    else if (type === 'j') {
      try { out[f] = v ? JSON.parse(v) : (table === 'templates' ? [] : {}); } catch (e) { out[f] = table === 'templates' ? [] : {}; }
    } else out[f] = v == null ? '' : String(v);
  });
  return out;
}

// ---------- 変更の通知 ----------

export function version() {
  return ver;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// source：'local'（この端末での変更）／'server'（同期で届いた変更）
function emit(source = 'local') {
  ver++;
  listeners.forEach(fn => { try { fn(source); } catch (e) { console.error(e); } });
}
