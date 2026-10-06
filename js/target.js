// 今日の目標（重さ×回数×セット、有酸素は時間・距離）を自動で決める。
//
// 決め方（「あと2回いけそう」で止める前提）
// - 前回の記録がある：前回の一番重い重さで、目標の回数を全セットこなせていたら1段階上げる（筋トレ＝増減幅、自重＝回数+1）。
//   こなせていなければ同じ。下げはしない（体調の悪い日は「数値を入れる」で実際の値を記録する）
// - 前回が無い：プラン設定の MAX から目安を出す（下の MAX_RATIO。推定なので、AI に確認できるようにしてある）。
//   MAX が無い種目は、種目の「初期重量の目安」
// - 回数の目標：メニューに reps があればそれ。無ければ筋トレ10回・自重10回（懸垂は懸垂の最大回数−1）
// - 有酸素：メニューの目安の時間・距離

import * as calc from './calc.js';
import * as plan from './plan.js';

// MAX（1回だけ上がる重さ）に対する、10回×「あと2回」の目安の割合。ダンベルは片手の重さ
const MAX_RATIO = {
  'ex-bench': ['bench_max', 0.7],
  'ex-narrow-bench': ['bench_max', 0.6],
  'ex-incline-db': ['bench_max', 0.25],
  'ex-db-shoulder': ['bench_max', 0.15],
  'ex-squat': ['squat_max', 0.7],
  'ex-rdl': ['squat_max', 0.6]
};
const DEFAULT_REPS = { 'ex-negative-pullup': 3 };

function floorTo(v, step) {
  const s = step || 1;
  return Math.max(0, Math.floor(v / s + 1e-9) * s);
}

export function repsTarget(ex, item, cfg = plan.planConfig()) {
  if (item && item.reps) return item.reps;
  if (ex.id === 'ex-pullup') {
    const max = Number(cfg.pullup_max) || 0;
    return max ? Math.max(1, max - 1) : 4;
  }
  return DEFAULT_REPS[ex.id] || 10;
}

// { weight, reps, added, sets, duration, distance, reason }
export function targetFor(ex, item, today, cfg = plan.planConfig()) {
  const sets = (item && item.sets) || 1;
  if (ex.type === 'cardio') {
    return { sets: 1, duration: item && item.duration_min ? item.duration_min : null, distance: item && item.distance_km ? item.distance_km : null, reason: '' };
  }
  const reps = repsTarget(ex, item, cfg);
  const prev = calc.previousSession(ex.id, today);
  if (ex.type === 'bodyweight') {
    if (!prev) return { sets, reps, added: 0, reason: '初回の目安' };
    const added = Math.max(0, ...prev.sets.map(l => l.added_weight || 0));
    const at = prev.sets.filter(l => (l.added_weight || 0) === added);
    const best = Math.min(...at.map(l => l.reps || 0));
    const cleared = at.length >= sets && best >= reps;
    const base = Math.max(reps, best);
    return cleared
      ? { sets, reps: base + 1, added, reason: '前回クリア → 回数+1' }
      : { sets, reps: Math.max(reps, ...at.map(l => l.reps || 0)), added, reason: '前回と同じ目標' };
  }
  const step = ex.step || 2.5;
  if (prev) {
    const w = Math.max(...prev.sets.map(l => l.weight || 0));
    const at = prev.sets.filter(l => (l.weight || 0) === w);
    const cleared = at.length >= sets && at.every(l => (l.reps || 0) >= reps);
    return cleared
      ? { sets, reps, weight: w + step, reason: `前回クリア → +${step}kg` }
      : { sets, reps, weight: w, reason: '前回と同じ重さ' };
  }
  const r = MAX_RATIO[ex.id];
  if (r && Number(cfg[r[0]]) > 0) {
    return { sets, reps, weight: floorTo(Number(cfg[r[0]]) * r[1], step), reason: 'MAXからの推定（初回）' };
  }
  return { sets, reps, weight: ex.initial_weight != null ? ex.initial_weight : 20, reason: '初回の目安' };
}

export function targetText(ex, t) {
  if (ex.type === 'cardio') {
    const p = [];
    if (t.duration) p.push(`${t.duration}分`);
    if (t.distance) p.push(`${t.distance}km`);
    return p.join('・') || '自由';
  }
  if (ex.type === 'bodyweight') return `${t.reps}回${t.added ? `（+${t.added}kg）` : ''} × ${t.sets}セット`;
  return `${t.weight}kg${ex.per_hand ? '（片手）' : ''} × ${t.reps}回 × ${t.sets}セット`;
}
