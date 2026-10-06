// 予定（どの日にどのメニューをやるか）。
//
// しくみ
// - 「曜日ごとのメニュー」（設定の schedule_pattern）から、今日から6週間先までの予定を作る（plans。1日1件、id＝日付）
// - 予定の並び順（ローテーション）は、月曜から順に並べた曜日ごとのメニュー。6週間より先は、最後の予定の続きから順に足していく
// - その日に運動の記録（懸垂カウンター以外）があれば「できた」とみなす
// - 後ろ倒し：その日以降のまだの予定を、次の「運動する曜日」へ1つずつずらす（全体が後ろにずれる）
// - スキップ：その日の予定だけ取りやめる（ほかの予定は動かさない）

import * as store from './store.js';
import { workoutDays } from './calc.js';
import { addDays, weekday } from './util.js';

const HORIZON_DAYS = 42;
const MISSED_LOOKBACK = 14; // 何日前までの「まだの予定」を知らせるか
const PATTERN_KEY = 'schedule_pattern';

// 曜日（0=日 … 6=土）→ テンプレートID。未設定なら、テンプレートの「提案する曜日」から作る
export function pattern() {
  const s = store.get('settings', PATTERN_KEY);
  if (s && s.value) {
    try {
      const p = JSON.parse(s.value);
      if (p && typeof p === 'object') return p;
    } catch (e) { /* 壊れていたら既定に戻す */ }
  }
  const p = {};
  store.all('templates').forEach(t => {
    if (t.weekday != null && p[t.weekday] == null) p[t.weekday] = t.id;
  });
  return p;
}

export async function savePattern(p) {
  await store.put('settings', { id: PATTERN_KEY, value: JSON.stringify(p) });
}

function validTemplate(id) {
  return id && store.get('templates', id) ? id : null;
}

// 運動する曜日（月曜から順）
function slotWeekdays(p) {
  return [1, 2, 3, 4, 5, 6, 0].filter(wd => validTemplate(p[wd]));
}

// ローテーションの順番（月曜から順のメニュー）
function sequence(p) {
  return slotWeekdays(p).map(wd => p[wd]);
}

export function plans() {
  return store.all('plans').filter(x => validTemplate(x.template_id)).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function planOn(date) {
  const x = store.get('plans', date);
  return x && validTemplate(x.template_id) ? x : null;
}

export function workedOn(date) {
  return workoutDays().has(date);
}

// 予定の状態：done（できた）／skipped／missed（過ぎたのにまだ）／today／future
export function status(x, today) {
  if (x.status === 'skipped') return 'skipped';
  if (workedOn(x.date)) return 'done';
  if (x.date < today) return 'missed';
  return x.date === today ? 'today' : 'future';
}

// 過ぎたのにまだの予定（新しい順）
export function missed(today) {
  const from = addDays(today, -MISSED_LOOKBACK);
  return plans().filter(x => x.date >= from && x.date < today && status(x, today) === 'missed').reverse();
}

// 今日から6週間先まで予定があるようにする（足りない分だけ足す）
export async function ensure(today) {
  const p = pattern();
  const slots = slotWeekdays(p);
  if (!slots.length) return;
  const seq = sequence(p);
  const all = plans();
  const last = all.length ? all[all.length - 1] : null;
  const end = addDays(today, HORIZON_DAYS);
  if (last && last.date >= end) return;
  const rows = [];
  // 予定が1件も無い（または古い）ときは、曜日のとおりに作る。続きを足すときは、最後の予定の次のメニューから順に
  const fresh = !last || last.date < today;
  let idx = last && !fresh ? seq.indexOf(last.template_id) : -1;
  let d = fresh ? today : addDays(last.date, 1);
  for (; d <= end; d = addDays(d, 1)) {
    if (!slots.includes(weekday(d))) continue;
    if (store.get('plans', d)) continue; // 自分で入れた・スキップした日はそのまま
    let tpl;
    if (fresh || idx < 0) tpl = p[weekday(d)];
    else { idx = (idx + 1) % seq.length; tpl = seq[idx]; }
    if (!fresh && idx < 0) idx = seq.indexOf(tpl);
    rows.push({ id: d, date: d, template_id: tpl, status: 'planned' });
  }
  if (rows.length) await store.putMany('plans', rows);
}

// 曜日ごとのメニューを変えたとき：今日以降の、まだの予定を作り直す（できた日・過去はそのまま）
export async function rebuild(today) {
  const del = plans().filter(x => x.date >= today && !workedOn(x.date)).map(x => ({ ...x, deleted: true }));
  if (del.length) await store.putMany('plans', del);
  await ensure(today);
}

// 後ろ倒し：from の日の予定から先の「まだの予定」を、次の運動する曜日へ1つずつずらす。
// from が過去（できなかった日）なら、今日以降の運動する曜日へ詰め直す
export async function postpone(from, today) {
  const p = pattern();
  const slots = slotWeekdays(p);
  if (!slots.length) return 0;
  const moving = plans().filter(x => x.date >= from && x.status !== 'skipped' && !workedOn(x.date) && (x.date >= today || x.date === from));
  if (!moving.length) return 0;
  const keep = new Set(plans().filter(x => x.date > from && !moving.includes(x)).map(x => x.date));
  const start = from < today ? addDays(today, -1) : from;
  const targets = [];
  for (let d = addDays(start, 1); targets.length < moving.length; d = addDays(d, 1)) {
    if (slots.includes(weekday(d)) && !keep.has(d)) targets.push(d);
  }
  const rows = new Map();
  moving.forEach(x => rows.set(x.date, { ...x, deleted: true }));
  moving.forEach((x, i) => rows.set(targets[i], { id: targets[i], date: targets[i], template_id: x.template_id, status: 'planned', deleted: false }));
  await store.putMany('plans', [...rows.values()]);
  return moving.length;
}

export async function skip(date) {
  const x = store.get('plans', date);
  if (x) await store.put('plans', { ...x, status: 'skipped' });
}

export async function unskip(date) {
  const x = store.get('plans', date);
  if (x) await store.put('plans', { ...x, status: 'planned' });
}

// その日の予定を変える（null で予定なしにする）
export async function setPlan(date, templateId) {
  const x = store.getAny('plans', date);
  if (!templateId) {
    if (x && !x.deleted) await store.put('plans', { ...x, deleted: true });
    return;
  }
  await store.put('plans', { ...(x || {}), id: date, date, template_id: templateId, status: 'planned', deleted: false });
}
