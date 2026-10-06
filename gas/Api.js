// 各 API の中身。合言葉の確認は doPost で済ませてある。
//
// 同期のしくみ（画面側 js/sync.js と対になっている）
// - 画面は端末で変えた行をまとめて送る（changes）。行は全部の列を持つ
// - 同じ id の行がすでにあれば、updated_at が新しいほうを残す（後勝ち）。削除も deleted=TRUE の行として届く
// - conditions（体調）だけは「朝の血圧・夜の血圧・体重・メモ」の項目ごとに新しいほうを残す（field_times で判定）
// - サーバーが書いた行には synced_at（サーバーの時刻）を付ける。画面は前回の now を since で送り、
//   それより後に書かれた行だけを受け取る（端末の時計がずれていても取りこぼさないように）

const MAX_CHANGES = 3000; // 1回の同期で受け付ける行数

// 列ごとの入力チェックの種類
const FIELD_RULES = {
  exercises: { id: 'id', name: 'text:40', type: 'enum:strength,bodyweight,cardio', parts: 'text:40', step: 'num',
    initial_weight: 'num', per_hand: 'bool', sort_order: 'num', active: 'bool', created_at: 'ts', updated_at: 'ts', deleted: 'bool' },
  logs: { id: 'id', date: 'date', exercise_id: 'id', kind: 'enum:normal,counter', set_no: 'num', weight: 'num', reps: 'num',
    added_weight: 'num', duration_min: 'num', distance_km: 'num', calories: 'num', memo: 'text:200',
    created_at: 'ts', updated_at: 'ts', deleted: 'bool' },
  templates: { id: 'id', name: 'text:40', items: 'json:8000', weekday: 'num', sort_order: 'num',
    created_at: 'ts', updated_at: 'ts', deleted: 'bool' },
  conditions: { id: 'date', date: 'date', am_sys: 'num', am_dia: 'num', pm_sys: 'num', pm_dia: 'num', weight: 'num',
    memo: 'text:500', field_times: 'json:500', created_at: 'ts', updated_at: 'ts', deleted: 'bool' },
  settings: { id: 'id', value: 'text:2000', updated_at: 'ts', deleted: 'bool' },
  plans: { id: 'id', date: 'date', template_id: 'id', status: 'enum:planned,skipped', created_at: 'ts', updated_at: 'ts', deleted: 'bool',
    lane: 'enum:s,c', seq: 'num' }
};
const CONDITION_GROUPS = { am: ['am_sys', 'am_dia'], pm: ['pm_sys', 'pm_dia'], weight: ['weight'], memo: ['memo'] };

// 合言葉とつながりの確認用
function apiPing_() {
  getSs_();
  return { app: 'workout-app', now: now_() };
}

// req: { since: 前回の now（初回は ''）, changes: { テーブル名: [行, …] } }
// 返り値: { now, rows: { テーブル名: [行, …] } }
function apiSync_(req) {
  const since = typeof req.since === 'string' ? req.since : '';
  const changes = req.changes && typeof req.changes === 'object' ? req.changes : {};
  let total = 0;
  const cleaned = {};
  Object.keys(SCHEMA).forEach(function (table) {
    const list = Array.isArray(changes[table]) ? changes[table] : [];
    total += list.length;
    cleaned[table] = list.map(function (row) { return clean_(table, row); });
  });
  if (total > MAX_CHANGES) throw apiError_('too_many', '一度に送る件数が多すぎます');

  return withLock_(function () {
    const now = now_();
    const out = {};
    Object.keys(SCHEMA).forEach(function (table) {
      out[table] = applyChanges_(table, cleaned[table], since, now);
    });
    return { now: now, rows: out };
  });
}

// 1つのシートに変更を書き、画面に返す行（since より後に書かれた行＋採用しなかった送信分のサーバー側の行）を返す
function applyChanges_(table, incoming, since, now) {
  const rows = readRows_(table);
  const byId = {};
  rows.forEach(function (r) { if (r.id) byId[r.id] = r; });
  const extra = {};
  const added = [];

  incoming.forEach(function (inc) {
    const cur = byId[inc.id];
    let next;
    if (!cur) {
      next = inc;
    } else if (table === 'conditions') {
      next = mergeCondition_(cur, inc);
    } else if (String(inc.updated_at) >= String(cur.updated_at)) {
      next = inc;
    } else {
      extra[cur.id] = cur; // サーバーのほうが新しいので、そちらを画面に返す
      return;
    }
    next.synced_at = now;
    if (cur) {
      next._row = cur._row;
      updateRow_(table, cur._row, next);
    } else {
      added.push(next);
    }
    byId[next.id] = next;
  });
  appendRows_(table, added);

  const result = [];
  Object.keys(byId).forEach(function (id) {
    const r = byId[id];
    if (String(r.synced_at || '') > since || extra[id]) result.push(strip_(r));
  });
  return result;
}

// 体調の行を項目ごとにまとめる（朝だけ入れた端末と、夜だけ入れた端末の両方の値を残す）
function mergeCondition_(a, b) {
  const ta = parseJson_(a.field_times);
  const tb = parseJson_(b.field_times);
  const newer = String(b.updated_at) >= String(a.updated_at) ? b : a;
  const out = {};
  Object.keys(newer).forEach(function (k) { out[k] = newer[k]; });
  const times = {};
  Object.keys(CONDITION_GROUPS).forEach(function (g) {
    const useB = String(tb[g] || '') >= String(ta[g] || '');
    const src = useB ? b : a;
    CONDITION_GROUPS[g].forEach(function (f) { out[f] = src[f]; });
    const t = useB ? tb[g] : ta[g];
    if (t) times[g] = t;
  });
  out.field_times = JSON.stringify(times);
  const created = [a.created_at, b.created_at].filter(Boolean).sort();
  out.created_at = created.length ? created[0] : '';
  return out;
}

// 届いた行を、決まった列だけ・決まった形にそろえる
function clean_(table, row) {
  if (!row || typeof row !== 'object') throw apiError_('invalid', 'データの形が正しくありません');
  const rules = FIELD_RULES[table];
  const out = {};
  Object.keys(rules).forEach(function (f) {
    out[f] = cleanValue_(rules[f], row[f], table + '.' + f);
  });
  if (!out.id) throw apiError_('invalid', 'ID がありません（' + table + '）');
  if (!out.updated_at) throw apiError_('invalid', '更新日時がありません（' + table + '）');
  return out;
}

function cleanValue_(rule, v, label) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  const parts = rule.split(':');
  const kind = parts[0];
  if (kind === 'bool') return v === true || s === 'TRUE' || s === 'true' ? 'TRUE' : 'FALSE';
  if (s === '') return '';
  const bad = function () { throw apiError_('invalid', '値が正しくありません（' + label + '）'); };
  if (kind === 'id') { if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) bad(); return s; }
  if (kind === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) bad(); return s; }
  if (kind === 'ts') { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(s)) bad(); return s; }
  if (kind === 'num') { if (!isFinite(Number(s))) bad(); return String(Number(s)); }
  if (kind === 'enum') { if (parts[1].split(',').indexOf(s) < 0) bad(); return s; }
  if (kind === 'text') return s.slice(0, Number(parts[1]));
  if (kind === 'json') {
    if (s.length > Number(parts[1])) bad();
    try { JSON.parse(s); } catch (e) { bad(); }
    return s;
  }
  return s;
}

function parseJson_(s) {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

function strip_(r) {
  const o = {};
  Object.keys(r).forEach(function (k) { if (k !== '_row') o[k] = r[k]; });
  return o;
}
