// 集計（ボリューム・自己ベスト・部位・サマリー・移動平均）。
// 自己ベストは保存せず、毎回記録から計算する（過去の記録を直したり消したりしても食い違わないように）。
//
// ボリュームの数え方
// - 筋トレ：重量 × 回数。片手の重さで記録する種目（ダンベル）は両手分として ×2
// - 自重：（その日までの最新の体重 ＋ 加重）× 回数。体重が未記録なら 加重 × 回数
// - 有酸素：ボリュームには入れない（運動時間として数える）

import * as store from './store.js';
import { addDays, weekStart, daysBetween } from './util.js';
import { PARTS } from './seed.js';

export { PARTS };

export function exercise(id) {
  return store.getAny('exercises', id);
}

export function partsOf(ex) {
  return ex && ex.parts ? String(ex.parts).split(',').map(s => s.trim()).filter(Boolean) : [];
}

// データが変わるまで計算結果を使い回す（記録が増えても画面が重くならないように）
function memo(fn) {
  let v = -1;
  let cached;
  return () => {
    if (v !== store.version()) { cached = fn(); v = store.version(); }
    return cached;
  };
}

// 有効な記録（削除されていないもの）。日付→作成順に並べる
export const logs = memo(() => store.all('logs')
  .sort((a, b) => (a.date === b.date ? (a.created_at < b.created_at ? -1 : 1) : (a.date < b.date ? -1 : 1))));

export function logsOn(date) {
  return logs().filter(l => l.date === date);
}

// 懸垂カウンターは「運動日」「部位」「自己ベスト」には数えない
export function isWorkout(l) {
  return l.kind !== 'counter';
}

// ---------- 体重 ----------

const weights = memo(() => store.all('conditions').filter(c => c.weight != null).sort((a, b) => (a.date < b.date ? -1 : 1)));

// その日まで（その日を含む）の最新の体重
export function bodyWeightOn(date) {
  let w = null;
  for (const c of weights()) {
    if (c.date > date) break;
    w = c.weight;
  }
  return w;
}

// ---------- ボリューム・1RM ----------

export function setVolume(l, ex = exercise(l.exercise_id)) {
  if (!ex) return 0;
  const reps = l.reps || 0;
  if (ex.type === 'strength') return (l.weight || 0) * reps * (ex.per_hand ? 2 : 1);
  if (ex.type === 'bodyweight') return ((bodyWeightOn(l.date) || 0) + (l.added_weight || 0)) * reps;
  return 0;
}

// 推定1RM（Epley式）：重量 × (1 + 回数 ÷ 30)
export function e1rm(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

// ---------- 1日のまとめ ----------

export function daySummary(date) {
  const list = logsOn(date);
  const work = list.filter(isWorkout);
  const byEx = new Map();
  work.forEach(l => {
    if (!byEx.has(l.exercise_id)) byEx.set(l.exercise_id, []);
    byEx.get(l.exercise_id).push(l);
  });
  let volume = 0;
  list.forEach(l => { volume += setVolume(l); });
  let minutes = 0;
  work.forEach(l => {
    const ex = exercise(l.exercise_id);
    if (ex && ex.type === 'cardio') minutes += l.duration_min || 0;
  });
  const sets = work.filter(l => { const ex = exercise(l.exercise_id); return ex && ex.type !== 'cardio'; }).length;
  return { date, list, work, byEx, volume, minutes, sets, parts: partScore(work) };
}

// 部位ごとのセット数（主部位 1、ほかの部位 0.5）
export function partScore(list) {
  const score = {};
  PARTS.forEach(p => { score[p] = 0; });
  list.forEach(l => {
    const ps = partsOf(exercise(l.exercise_id));
    ps.forEach((p, i) => { if (p in score) score[p] += i === 0 ? 1 : 0.5; });
  });
  return score;
}

// 直近 n 日で、各部位を鍛えた日数
export function partDays(endDate, days = 7) {
  const from = addDays(endDate, -(days - 1));
  const seen = {};
  PARTS.forEach(p => { seen[p] = new Set(); });
  logs().forEach(l => {
    if (l.date < from || l.date > endDate || !isWorkout(l)) return;
    partsOf(exercise(l.exercise_id)).forEach(p => { if (seen[p]) seen[p].add(l.date); });
  });
  const out = {};
  PARTS.forEach(p => { out[p] = seen[p].size; });
  return out;
}

// 運動した日（懸垂カウンターだけの日は含めない）→ その日のボリュームとセット数
export const workoutDays = memo(() => {
  const map = new Map();
  logs().forEach(l => {
    if (!isWorkout(l)) return;
    const d = map.get(l.date) || { sets: 0, volume: 0 };
    d.sets += 1;
    d.volume += setVolume(l);
    map.set(l.date, d);
  });
  return map;
});

// レール（予定）の「できた」判定用：筋トレ（有酸素以外）をした日と、有酸素をした日
export const laneDays = memo(() => {
  const s = new Set();
  const c = new Set();
  logs().forEach(l => {
    if (!isWorkout(l)) return;
    const ex = exercise(l.exercise_id);
    (ex && ex.type === 'cardio' ? c : s).add(l.date);
  });
  return { s, c };
});

export function countDays(days, from, to) {
  let n = 0;
  days.forEach((_, d) => { if (d >= from && d <= to) n++; });
  return n;
}

// 懸垂カウンター：その日の合計回数
export function counterReps(from, to) {
  return logs().filter(l => l.kind === 'counter' && l.date >= from && l.date <= to).reduce((s, l) => s + (l.reps || 0), 0);
}

// ---------- 種目ごとの記録 ----------

export function exerciseLogs(exId) {
  return logs().filter(l => l.exercise_id === exId && isWorkout(l));
}

// 前回（今日より前で最後にやった日）のセット
export function previousSession(exId, today) {
  const list = exerciseLogs(exId).filter(l => l.date < today);
  if (!list.length) return null;
  const date = list[list.length - 1].date;
  return { date, sets: list.filter(l => l.date === date) };
}

// 推移グラフ用：日ごとの値
export const METRICS = {
  strength: [['maxWeight', '最大重量', 'kg'], ['e1rm', '推定1RM', 'kg'], ['volume', '総ボリューム', 'kg']],
  bodyweight: [['maxReps', '1セットの最大回数', '回'], ['totalReps', '合計回数', '回'], ['volume', '総ボリューム', 'kg']],
  cardio: [['distance', '距離', 'km'], ['duration', '時間', '分']]
};

export function series(exId, metric) {
  const ex = exercise(exId);
  const byDate = new Map();
  exerciseLogs(exId).forEach(l => {
    const d = byDate.get(l.date) || [];
    d.push(l);
    byDate.set(l.date, d);
  });
  const out = [];
  byDate.forEach((ls, date) => {
    let v = 0;
    if (metric === 'maxWeight') v = Math.max(...ls.map(l => l.weight || 0));
    else if (metric === 'e1rm') v = Math.max(...ls.map(l => e1rm(l.weight, l.reps)));
    else if (metric === 'volume') v = ls.reduce((s, l) => s + setVolume(l, ex), 0);
    else if (metric === 'maxReps') v = Math.max(...ls.map(l => l.reps || 0));
    else if (metric === 'totalReps') v = ls.reduce((s, l) => s + (l.reps || 0), 0);
    else if (metric === 'distance') v = ls.reduce((s, l) => s + (l.distance_km || 0), 0);
    else if (metric === 'duration') v = ls.reduce((s, l) => s + (l.duration_min || 0), 0);
    out.push({ date, value: v });
  });
  return out;
}

// ---------- 自己ベスト ----------
// 筋トレ：最大重量・推定1RM／自重：1セットの最大回数・最大加重／有酸素：最長距離・最長時間
// （ペースは「会話できる強度」を守るため、自己ベストにしない）

const PR_KINDS = {
  strength: [['weight', '最大重量', 'kg', l => l.weight || 0], ['e1rm', '推定1RM', 'kg', l => e1rm(l.weight, l.reps)]],
  bodyweight: [['reps', '最大回数', '回', l => l.reps || 0], ['added', '最大加重', 'kg', l => l.added_weight || 0]],
  cardio: [['distance', '最長距離', 'km', l => l.distance_km || 0], ['duration', '最長時間', '分', l => l.duration_min || 0]]
};

// 種目ごとの今の自己ベスト [{label, unit, value, date}]
export function bests(exId) {
  const ex = exercise(exId);
  if (!ex) return [];
  const list = exerciseLogs(exId);
  return (PR_KINDS[ex.type] || []).map(([key, label, unit, fn]) => {
    let best = null;
    list.forEach(l => {
      const v = fn(l);
      if (v > 0 && (!best || v > best.value)) best = { key, label, unit, value: v, date: l.date, reps: l.reps, weight: l.weight };
    });
    return best;
  }).filter(Boolean);
}

// 記録した1セットが自己ベストを更新したか。その種目を初めてやった日は数えない（毎セットお祝いが出ないように）
export function newRecords(log) {
  const ex = exercise(log.exercise_id);
  if (!ex || !isWorkout(log)) return [];
  const others = exerciseLogs(log.exercise_id).filter(l => l.id !== log.id);
  if (!others.some(l => l.date < log.date)) return [];
  const out = [];
  (PR_KINDS[ex.type] || []).forEach(([key, label, unit, fn]) => {
    const v = fn(log);
    if (v <= 0) return;
    const prev = Math.max(0, ...others.map(fn));
    if (prev > 0 && v > prev + 1e-9) out.push({ key, label, unit, value: v, prev });
  });
  return out;
}

// ---------- 週・月のサマリー ----------

export function weeklySummary(today, weeks = 8) {
  const days = workoutDays();
  const out = [];
  let start = weekStart(today);
  for (let i = 0; i < weeks; i++) {
    const end = addDays(start, 6);
    let volume = 0;
    days.forEach((d, date) => { if (date >= start && date <= end) volume += d.volume; });
    out.unshift({ start, end, days: countDays(days, start, end), volume, parts: partsBetween(start, end) });
    start = addDays(start, -7);
  }
  return out;
}

export function monthlySummary(today, months = 6) {
  const days = workoutDays();
  const out = [];
  let [y, m] = today.split('-').map(Number);
  for (let i = 0; i < months; i++) {
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
    let volume = 0;
    days.forEach((d, date) => { if (date >= start && date <= end) volume += d.volume; });
    out.unshift({ label: `${y}/${String(m).padStart(2, '0')}`, start, end, days: countDays(days, start, end), volume, parts: partsBetween(start, end) });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return out;
}

// 期間中に各部位を鍛えた日数
export function partsBetween(from, to) {
  return partDays(to, daysBetween(from, to) + 1);
}

// ---------- 体調 ----------

export const conditions = memo(() => store.all('conditions').sort((a, b) => (a.date < b.date ? -1 : 1)));

// 直近の記録（指定日より前）で、その項目に値がある行
export function lastCondition(field, beforeDate) {
  const list = conditions().filter(c => c.date < beforeDate && c[field] != null);
  return list.length ? list[list.length - 1] : null;
}

// 7日移動平均：その日を含む直近7日のうち、記録がある日だけで平均する（記録が抜けた日は飛ばす）
export function movingAverage(points, days = 7) {
  return points.map(p => {
    if (p.value == null) return { date: p.date, value: null };
    const from = addDays(p.date, -(days - 1));
    const vals = points.filter(q => q.value != null && q.date >= from && q.date <= p.date).map(q => q.value);
    return { date: p.date, value: vals.reduce((s, v) => s + v, 0) / vals.length };
  });
}

// 月ごとの平均（朝上・朝下・夜上・夜下・体重）
export function monthlyConditionAverages() {
  const map = new Map();
  conditions().forEach(c => {
    const key = c.date.slice(0, 7);
    const m = map.get(key) || { month: key, sums: {}, counts: {} };
    ['am_sys', 'am_dia', 'pm_sys', 'pm_dia', 'weight'].forEach(f => {
      if (c[f] == null) return;
      m.sums[f] = (m.sums[f] || 0) + c[f];
      m.counts[f] = (m.counts[f] || 0) + 1;
    });
    map.set(key, m);
  });
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).map(m => {
    const avg = {};
    Object.keys(m.sums).forEach(f => { avg[f] = m.sums[f] / m.counts[f]; });
    return { month: m.month, avg };
  });
}
