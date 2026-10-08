// 予定（レール）。どの日にどのメニューをやるかを先に決めておき、ホームではその日の分だけを出す。
//
// しくみ
// - レールは2本：筋トレ（lane=s）と有酸素（lane=c）。1日に各1件まで（id は筋トレ＝日付、有酸素＝日付_c）
// - 「予定の作り方」（設定の schedule_pattern）で、曜日ごとに筋トレ・有酸素のメニューを決める。
//   「はじめの期間」（intro_until まで）は別の曜日割り（例：ランは導入メニュー）にできる
// - 今日から6週間先までの予定を作る。先を足すときは、そのレールの順番（月曜から並べた曜日割り。seq＝何番目か）の続きから
// - その日にそのレールの記録（筋トレ／有酸素。懸垂カウンターは除く）があれば「できた」
// - できなかった日の予定は、次に開いたときに自動で後ろへずれる（その先の予定も1つずつ後ろへ）。今日の分を自分でずらすこともできる

import * as store from './store.js';
import { laneDays } from './calc.js';
import { addDays, weekday } from './util.js';

export const LANES = ['s', 'c'];
export const LANE_LABEL = { s: '筋トレ', c: '有酸素' };
const HORIZON_DAYS = 42;
const PATTERN_KEY = 'schedule_pattern';
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // 月曜から

export const planId = (date, lane) => (lane === 'c' ? date + '_c' : date);
export const laneOf = x => (x.lane === 'c' ? 'c' : 's');

function validTemplate(id) {
  return id && store.get('templates', id) ? id : null;
}

// ---------- 曜日割り ----------
// { version: 2, intro_until: 'YYYY-MM-DD' | null, intro: {曜日: {s, c}}, main: {曜日: {s, c}} }

function emptyDays() {
  const d = {};
  ORDER.forEach(wd => { d[wd] = { s: null, c: null }; });
  return d;
}

function normDays(src) {
  const d = emptyDays();
  Object.keys(src || {}).forEach(wd => {
    const v = src[wd];
    if (!(wd in d)) return;
    if (typeof v === 'string') d[wd].s = v; // 版1の形（曜日→筋トレのテンプレート）
    else if (v && typeof v === 'object') d[wd] = { s: v.s || null, c: v.c || null };
  });
  return d;
}

export function pattern() {
  const s = store.get('settings', PATTERN_KEY);
  let raw = null;
  if (s && s.value) {
    try { raw = JSON.parse(s.value); } catch (e) { raw = null; }
  }
  if (raw && raw.version === 2) {
    return { version: 2, intro_until: raw.intro_until || null, intro: raw.intro ? normDays(raw.intro) : null, main: normDays(raw.main) };
  }
  // まだ版2になっていない：版1の形か、テンプレートの「提案する曜日」から作る
  let main;
  if (raw && typeof raw === 'object') main = normDays(raw);
  else {
    main = emptyDays();
    store.all('templates').forEach(t => { if (t.weekday != null && main[t.weekday] && !main[t.weekday].s) main[t.weekday].s = t.id; });
  }
  return { version: 1, intro_until: null, intro: null, main };
}

export async function savePattern(p) {
  await store.put('settings', { id: PATTERN_KEY, value: JSON.stringify({ version: 2, intro_until: p.intro_until || null, intro: p.intro || null, main: p.main }) });
}

function templateIdByName(name, fallbackId) {
  if (store.get('templates', fallbackId)) return fallbackId;
  const t = store.all('templates').find(x => x.name === name);
  return t ? t.id : null;
}

// 有酸素のレールが無ければ、おすすめの曜日割りを入れる（1回だけ。版2になったら以後は触らない）
// はじめの2週間：火・木・土＝ラン導入、日＝スイム基礎／3週目から：火・木＝ラン標準、土＝週末ロング、日＝スイム基礎
async function migrate(today) {
  const p = pattern();
  if (p.version === 2) return;
  const intro = templateIdByName('ラン：導入（歩き混ぜ）', 'tpl-run-intro');
  const std = templateIdByName('ラン：標準30分', 'tpl-run-std');
  const long = templateIdByName('ラン：週末ロング', 'tpl-run-long');
  const swim = templateIdByName('スイム：基礎', 'tpl-swim-basic');
  const main = p.main;
  const hasCardio = ORDER.some(wd => main[wd].c);
  let introDays = null;
  let until = null;
  if (!hasCardio && std && long && swim && intro) {
    main[2].c = std; main[4].c = std; main[6].c = long; main[0].c = swim;
    introDays = JSON.parse(JSON.stringify(main));
    introDays[2].c = intro; introDays[4].c = intro; introDays[6].c = intro;
    until = addDays(today, 13);
  }
  await savePattern({ intro_until: until, intro: introDays, main });
  // 曜日割りが変わったので、今日以降のまだの予定を作り直す
  await rebuild(today, true);
}

function stageKey(p, d) {
  return p.intro && p.intro_until && d <= p.intro_until ? 'intro' : 'main';
}

function slotsOf(p, stage, lane) {
  const days = p[stage];
  return ORDER.filter(wd => validTemplate(days[wd][lane]));
}

// ---------- 予定の読み出し ----------

export function plans(lane) {
  return store.all('plans')
    .filter(x => validTemplate(x.template_id) && (!lane || laneOf(x) === lane))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : laneOf(a) < laneOf(b) ? -1 : 1));
}

export function planOn(date, lane) {
  const x = store.get('plans', planId(date, lane));
  return x && validTemplate(x.template_id) ? x : null;
}

export function doneOn(date, lane) {
  return laneDays()[lane].has(date);
}

// 予定の状態：done（できた）／skipped／missed（過ぎたのにまだ）／today／future
export function status(x, today) {
  if (x.status === 'skipped') return 'skipped';
  if (doneOn(x.date, laneOf(x))) return 'done';
  if (x.date < today) return 'missed';
  return x.date === today ? 'today' : 'future';
}

// ---------- 予定づくり ----------

// 準備：曜日割りの移行 → できなかった予定を後ろへ → 6週間先まで足す。後ろへずらした件数を返す
export async function prepare(today) {
  await migrate(today);
  const moved = await catchUp(today);
  await ensure(today);
  return moved;
}

// 今日から6週間先まで、各レールの予定があるようにする（足りない分だけ足す）
export async function ensure(today) {
  const p = pattern();
  const end = addDays(today, HORIZON_DAYS);
  const rows = [];
  LANES.forEach(lane => {
    const all = plans(lane);
    const last = all.length ? all[all.length - 1] : null;
    if (last && last.date >= end) return;
    const fresh = !last || last.date < today;
    let prev = fresh ? null : { stage: stageKey(p, last.date), seq: last.seq };
    for (let d = fresh ? today : addDays(last.date, 1); d <= end; d = addDays(d, 1)) {
      const stage = stageKey(p, d);
      const slots = slotsOf(p, stage, lane);
      const pos = slots.indexOf(weekday(d));
      if (pos < 0) continue;
      if (store.get('plans', planId(d, lane))) continue; // 自分で入れた日はそのまま
      // 同じ期間の続きなら順番どおり（ずらしたあとも並びが崩れないように）、そうでなければ曜日どおり
      let seq = pos;
      if (prev && prev.stage === stage && prev.seq != null && prev.seq < slots.length) seq = (prev.seq + 1) % slots.length;
      const tpl = p[stage][slots[seq]][lane];
      rows.push({ id: planId(d, lane), date: d, lane, seq, template_id: tpl, status: 'planned', deleted: false });
      prev = { stage, seq };
    }
  });
  if (rows.length) await store.putMany('plans', rows);
}

// まだの予定（moving）を、start より後のレールの日へ順に詰める。done の日は飛ばす
async function shift(lane, moving, start, today) {
  if (!moving.length) return 0;
  const p = pattern();
  const keep = new Set(plans(lane).filter(x => !moving.includes(x) && x.date > start).map(x => x.date));
  const targets = [];
  for (let d = addDays(start, 1), guard = 0; targets.length < moving.length && guard < 400; d = addDays(d, 1), guard++) {
    if (slotsOf(p, stageKey(p, d), lane).includes(weekday(d)) && !keep.has(d) && !(d < today)) targets.push(d);
  }
  if (targets.length < moving.length) return 0; // レールの曜日が1つも無い
  const rows = new Map();
  moving.forEach(x => rows.set(x.id, { ...x, deleted: true }));
  moving.forEach((x, i) => {
    const d = targets[i];
    const id = planId(d, lane);
    rows.set(id, { id, date: d, lane, seq: x.seq, template_id: x.template_id, status: 'planned', deleted: false });
  });
  await store.putMany('plans', [...rows.values()]);
  return moving.length;
}

// できなかった日（今日より前でまだ）の予定があれば、今日以降へ自動でずらす
export async function catchUp(today) {
  let moved = 0;
  for (const lane of LANES) {
    const all = plans(lane);
    const missed = all.filter(x => x.date < today && status(x, today) === 'missed');
    if (!missed.length) continue;
    const future = all.filter(x => x.date >= today && x.status !== 'skipped' && !doneOn(x.date, lane));
    moved += await shift(lane, [...missed, ...future], addDays(today, -1), today);
  }
  return moved;
}

// 「今日はできない」：その日から先のまだの予定を、次のレールの日へ1つずつずらす
export async function postpone(date, lane, today) {
  const moving = plans(lane).filter(x => x.date >= date && x.status !== 'skipped' && !doneOn(x.date, lane));
  return shift(lane, moving, date, today);
}

// 曜日割りを変えたとき：今日以降の、まだの予定を作り直す
export async function rebuild(today, skipEnsure) {
  const del = plans().filter(x => x.date >= today && !doneOn(x.date, laneOf(x))).map(x => ({ ...x, deleted: true }));
  if (del.length) await store.putMany('plans', del);
  if (!skipEnsure) await ensure(today);
}

// その日の予定を変える（null で予定なしにする）
export async function setPlan(date, lane, templateId) {
  const id = planId(date, lane);
  const x = store.getAny('plans', id);
  if (!templateId) {
    if (x && !x.deleted) await store.put('plans', { ...x, deleted: true });
    return;
  }
  await store.put('plans', { ...(x || {}), id, date, lane, template_id: templateId, status: 'planned', deleted: false });
}

// 次にレールがある日（今日より後）
export function nextPlans(today) {
  const all = plans().filter(x => x.date > today && x.status !== 'skipped');
  if (!all.length) return null;
  const date = all[0].date;
  return { date, list: all.filter(x => x.date === date) };
}

// 雨の日の差し替え：今日の有酸素がランなら、自転車のメニューに替える
export function rainAlternative(today) {
  const x = planOn(today, 'c');
  if (!x || doneOn(today, 'c')) return null;
  const tpl = store.get('templates', x.template_id);
  const isRun = tpl && (tpl.items || []).some(it => it.exercise_id === 'ex-running');
  if (!isRun) return null;
  const bike = store.get('templates', 'tpl-bike-rain') || store.all('templates').find(t => (t.items || []).some(it => it.exercise_id === 'ex-bike'));
  return bike ? bike.id : null;
}

// ---------- プラン設定（頻度・有酸素・パラメータ） → 曜日割り ----------
// settings の plan_config：{ s_freq, c_on, c_type(run/swim/both), c_freq, intro_until, body_weight, bench_max, squat_max, pullup_max }

const CONFIG_KEY = 'plan_config';
export const DEFAULT_CONFIG = { s_freq: 3, c_on: true, c_type: 'both', c_freq: 4, intro_until: null, body_weight: null, bench_max: null, squat_max: null, pullup_max: null };

export function planConfig() {
  const s = store.get('settings', CONFIG_KEY);
  try {
    if (!s || !s.value) return { ...DEFAULT_CONFIG, intro_until: pattern().intro_until }; // まだ保存していなければ、今の曜日割りの「はじめの期間」を引き継ぐ
    return { ...DEFAULT_CONFIG, ...JSON.parse(s.value) };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

export async function savePlanConfig(cfg) {
  await store.put('settings', { id: CONFIG_KEY, value: JSON.stringify(cfg) });
}

// 筋トレの頻度ごとの分け方（ローテーションの順）と曜日
export const S_SPLITS = {
  2: ['tpl-full-a', 'tpl-full-b'],
  3: ['tpl-upper-a', 'tpl-lower', 'tpl-upper-b'],
  4: ['tpl-upper-a', 'tpl-lower', 'tpl-upper-b', 'tpl-lower-b'],
  5: ['tpl-upper-a', 'tpl-lower', 'tpl-push', 'tpl-pull', 'tpl-legs'],
  6: ['tpl-push', 'tpl-pull', 'tpl-legs', 'tpl-push', 'tpl-pull', 'tpl-legs']
};
const S_DAYS = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };
// 有酸素の曜日の選び方：筋トレの無い日を優先（火・木・土・日の順）、足りなければ筋トレの日にも入れる
const C_PREF = [2, 4, 6, 0, 3, 5, 1];

const T = {
  runIntro: 'tpl-run-intro', runStd: 'tpl-run-std', runLong: 'tpl-run-long',
  swimBasic: 'tpl-swim-basic', swimLong: 'tpl-swim-long'
};

export function patternFromConfig(cfg) {
  const main = emptyDays();
  const sFreq = Math.min(6, Math.max(2, Number(cfg.s_freq) || 3));
  S_DAYS[sFreq].forEach((wd, i) => { main[wd].s = validTemplate(S_SPLITS[sFreq][i]); });
  let intro = null;
  if (cfg.c_on) {
    const cFreq = Math.min(6, Math.max(2, Number(cfg.c_freq) || 4));
    const sDays = S_DAYS[sFreq];
    const cDays = [...C_PREF.filter(d => !sDays.includes(d)), ...C_PREF.filter(d => sDays.includes(d))].slice(0, cFreq);
    const ordered = ORDER.filter(wd => cDays.includes(wd));
    // 週末ロング：土（無ければ日、無ければ最後の日）
    const longDay = ordered.includes(6) ? 6 : ordered.includes(0) ? 0 : ordered[ordered.length - 1];
    // 両方のときの水泳の日：日（無ければ最後の日）。水泳は週1回
    const swimDay = ordered.includes(0) ? 0 : ordered[ordered.length - 1];
    ordered.forEach((wd, i) => {
      let t;
      if (cfg.c_type === 'swim') t = i % 2 === 0 ? T.swimBasic : T.swimLong;
      else if (cfg.c_type === 'both' && wd === swimDay) t = T.swimBasic;
      else t = wd === longDay && ordered.length >= 3 ? T.runLong : T.runStd;
      main[wd].c = validTemplate(t);
    });
    if (cfg.intro_until && cfg.c_type !== 'swim') {
      intro = JSON.parse(JSON.stringify(main));
      ORDER.forEach(wd => { if ([T.runStd, T.runLong].includes(intro[wd].c)) intro[wd].c = validTemplate(T.runIntro); });
    }
  }
  return { intro_until: intro ? cfg.intro_until : null, intro, main };
}

// プラン設定を保存して、今日からのレールを作り直す
export async function applyConfig(cfg, today) {
  await savePlanConfig(cfg);
  await savePattern(patternFromConfig(cfg));
  await rebuild(today);
}

// 「今日はできない」の確認用：その日の予定が移る先の日（ずらしたときの最初の行き先）
export function postponeTarget(date, lane) {
  const p = pattern();
  const keep = new Set(plans(lane).filter(x => x.date > date && (x.status === 'skipped' || doneOn(x.date, lane))).map(x => x.date));
  for (let d = addDays(date, 1), i = 0; i < 400; d = addDays(d, 1), i++) {
    if (slotsOf(p, stageKey(p, d), lane).includes(weekday(d)) && !keep.has(d)) return d;
  }
  return null;
}
