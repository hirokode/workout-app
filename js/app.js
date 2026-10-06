// 画面の描画と操作。
// 画面は「#/home」のようなアドレス（ハッシュ）で切り替える。描画は文字列の HTML を #app に入れる方式。
// 記録は store.js（端末）に保存してすぐ画面を更新し、サーバーとの同期は sync.js が裏で行う。

import * as store from './store.js';
import * as sync from './sync.js';
import * as calc from './calc.js';
import * as charts from './charts.js';
import * as plan from './plan.js';
import * as menuio from './menuio.js';
import { toCsv, toPng, shareOrDownload } from './export.js';
import { APP_VERSION } from './version.js';
import { PULLUP_ID } from './seed.js';
import {
  esc, todayJst, addDays, weekStart, fmtDate, fmtShort, fmtNum, fmtInt, parseNum, round, uuid, load, store as save, WEEKDAYS
} from './util.js';

const PARTS = calc.PARTS;
const TYPE_LABEL = { strength: '筋トレ', bodyweight: '自重', cardio: '有酸素' };
const COUNTER_REPS = 2;
const DEFAULT_GOAL = 0.5; // 体重の目標ペース（kg/月）

const state = {
  inputs: {},       // 種目ごとの入力中の値 { [exId]: { date, weight, reps, added, duration, distance, calories } }
  undo: null,       // 直前の記録（取り消し用）
  histDate: null,
  calMonth: null,
  importText: '',
  importPreview: null,
  trendEx: null,
  trendMetric: null,
  bpSlot: 'am',
  bpRange: 30,
  body: null,       // 体調の入力中の値
  exportFrom: null,
  exportTo: null,
  exportMemo: true,
  draft: null,      // 設定画面の編集中の値
  persistent: true
};

let toastTimer = null;

// ---------- 起動 ----------

async function main() {
  const r = await store.init();
  state.persistent = r.persistent;
  await ensurePlans();
  window.addEventListener('hashchange', () => {
    // 体調の画面は、開き直すたびに保存済みの値（その日がなければ今日）から読み込み直す
    if (route().name === 'body') state.body = null;
    render();
    window.scrollTo(0, 0);
  });
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onInput);
  sync.onStatus(s => {
    renderSyncPill(s);
    if (s.kind === 'synced') ensurePlans();
  });
  // 日付が変わったまま開きっぱなしでも、予定が先まであるように
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ensurePlans(); });
  // 同期で届いた変更は、入力中でなければ画面に反映する
  store.onChange(source => {
    if (source !== 'server') return;
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    render();
  });
  render();
  sync.start();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js?v=' + encodeURIComponent(APP_VERSION)).catch(e => console.error(e));
  }
}

// レール（予定）の準備：できなかった予定を後ろへずらし、6週間先まで用意する。
// サーバーとつないでいて、まだ一度も同期していない端末では作らない（サーバーにある予定を上書きしないため）
let ensuring = false;
async function ensurePlans() {
  if (ensuring) return;
  if (sync.isConfigured() && !store.getSince()) return;
  ensuring = true;
  try {
    const before = store.version();
    const moved = await plan.prepare(todayJst());
    if (store.version() !== before && route().name !== 'ex') render();
    if (moved) toast('できなかった予定を、今日から先へずらしました（レールはそのまま続きます）');
  } finally {
    ensuring = false;
  }
}

function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = h.split('/');
  return { name: name || 'home', args: rest.map(decodeURIComponent) };
}

// ---------- 描画 ----------

function render() {
  charts.destroyAll();
  const r = route();
  const view = VIEWS[r.name] || VIEWS.home;
  const out = view(...r.args);
  const app = document.getElementById('app');
  app.innerHTML = topbar(out.title, out.back) + `<main class="view view-${esc(r.name)}">${out.html}</main>`;
  renderTabbar(out.tab || r.name);
  renderSyncPill(sync.status());
  if (out.after) out.after();
}

function topbar(title, back) {
  return `<header class="topbar">
    ${back ? `<a class="icon-btn" href="${esc(back)}" aria-label="戻る">‹</a>` : '<span class="icon-spacer"></span>'}
    <h1>${esc(title)}</h1>
    <button class="sync-pill" id="sync-pill" data-act="sync-pill"></button>
  </header>`;
}

function renderSyncPill(s) {
  const el = document.getElementById('sync-pill');
  if (!el) return;
  el.className = 'sync-pill sync-' + s.kind;
  el.textContent = s.text;
  el.title = s.message || '';
}

const TABS = [['home', '今日', '🏋️'], ['history', 'カレンダー', '📅'], ['trends', '推移', '📈'], ['body', '体調', '❤️'], ['settings', '設定', '⚙️']];

function renderTabbar(active) {
  const tab = active === 'ex' || active === 'pick' ? 'home' : ['schedule', 'import'].includes(active) ? 'settings' : active;
  document.getElementById('tabbar').innerHTML = TABS.map(([id, label, icon]) =>
    `<a href="#/${id}" class="tab ${tab === id ? 'active' : ''}"><span class="tab-icon" aria-hidden="true">${icon}</span>${label}</a>`).join('');
}

// ---------- ホーム（今日） ----------

function viewHome() {
  const today = todayJst();
  const s = calc.daySummary(today);
  return {
    title: '今日 ' + fmtDate(today),
    html: `
      <section class="stats">
        ${stat('セット', s.sets, '')}
        ${stat('総ボリューム', fmtInt(s.volume), 'kg')}
        ${stat('有酸素', fmtNum(s.minutes, 0) || 0, '分')}
      </section>
      ${railCard(today)}
      ${menuCard(today)}
      ${counterCard(today)}
      ${partsCard(today, s)}
      ${todayCard(s)}
      <a class="link-wide" href="#/pick">＋ レール以外の種目を記録する</a>`
  };
}

function stat(label, value, unit) {
  return `<div class="stat"><div class="stat-value">${esc(value)}<small>${esc(unit)}</small></div><div class="stat-label">${esc(label)}</div></div>`;
}

function templates() {
  return store.all('templates').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function activeMenu(today) {
  const m = load('wo.menu', null);
  if (!m || m.date !== today) return null;
  return store.get('templates', m.templateId);
}

function setsDoneToday(exId, today) {
  return calc.logsOn(today).filter(l => l.exercise_id === exId && calc.isWorkout(l)).length;
}

function menuCard(today) {
  const tpl = activeMenu(today);
  if (tpl) {
    const items = (tpl.items || []).filter(it => store.get('exercises', it.exercise_id));
    return `<section class="card">
      <div class="card-head"><h2>今日のメニュー：${esc(tpl.name)}</h2><button class="link" data-act="menu-close">閉じる</button></div>
      <div class="menu-list">
        ${items.map(it => {
          const ex = store.get('exercises', it.exercise_id);
          const done = setsDoneToday(it.exercise_id, today);
          const ok = done >= it.sets;
          return `<a class="menu-item ${ok ? 'done' : ''}" href="#/ex/${esc(ex.id)}">
            <span class="part-dot p-${PARTS.indexOf(calc.partsOf(ex)[0])}"></span>
            <span class="menu-name">${esc(ex.name)}</span>
            <span class="menu-progress">${ok ? '✓ ' : ''}${done}/${it.sets}</span>
          </a>`;
        }).join('')}
      </div>
    </section>`;
  }
  return '';
}

// 今日のレール（筋トレ・有酸素）。選ばせずに、その日の分だけを出す
function railCard(today) {
  const active = activeMenu(today);
  const rows = plan.LANES.map(lane => {
    const x = plan.planOn(today, lane);
    if (!x) return '';
    const tpl = store.get('templates', x.template_id);
    const done = plan.doneOn(today, lane);
    const running = active && active.id === tpl.id;
    const rain = lane === 'c' ? plan.rainAlternative(today) : null;
    const note = (tpl.items || []).length === 1 && tpl.items[0].note ? tpl.items[0].note : '';
    return `<div class="rail-row lane-${lane} ${done ? 'done' : ''}">
      <div class="rail-head"><span class="rail-lane">${plan.LANE_LABEL[lane]}</span>${done ? '<span class="saved">✓ できた</span>' : running ? '<span class="hint">記録中</span>' : ''}</div>
      ${running ? `<p class="rail-name">${esc(tpl.name)}</p>`
        : `<button class="btn ${done ? '' : 'btn-primary'} btn-wide" data-act="menu-start" data-id="${esc(tpl.id)}">${esc(tpl.name)}${done ? '<small>続きを記録する</small>' : ' を始める'}</button>`}
      ${note && !done ? `<p class="hint rail-note">${esc(note)}</p>` : ''}
      ${done ? '' : `<div class="plan-actions">
        <button class="link" data-act="plan-postpone" data-date="${today}" data-lane="${lane}">今日はできない（後ろにずらす）</button>
        ${rain ? `<button class="link" data-act="plan-rain" data-id="${esc(rain)}">雨なので自転車に</button>` : ''}
      </div>`}
    </div>`;
  }).join('');
  const next = plan.nextPlans(today);
  const nextText = next ? next.list.map(x => store.get('templates', x.template_id).name).join('・') : '';
  return `<section class="card rail">
    <h2>今日のレール</h2>
    ${rows || '<p class="rail-rest">今日はお休みの日です。</p>'}
    ${next ? `<p class="hint next-plan">次：${esc(fmtDate(next.date))} ${esc(nextText)}</p>` : '<p class="hint">「設定」→「予定の作り方」でレールを作れます。</p>'}
  </section>`;
}

function counterCard(today) {
  const todayReps = calc.counterReps(today, today);
  const weekReps = calc.counterReps(addDays(today, -6), today);
  const hasToday = calc.logsOn(today).some(l => l.kind === 'counter');
  return `<section class="card counter">
    <button class="btn btn-counter p-1" data-act="counter">懸垂 +${COUNTER_REPS}</button>
    <div class="counter-info">
      <div><b>${todayReps}</b> 回<small>今日</small></div>
      <div><b>${weekReps}</b> 回<small>7日間</small></div>
      ${hasToday ? '<button class="link" data-act="counter-undo">−取り消す</button>' : ''}
    </div>
  </section>`;
}

function partsCard(today, s) {
  const week = calc.partDays(today, 7);
  return `<section class="card">
    <h2>今日の部位</h2>
    <div class="parts">
      ${PARTS.map((p, i) => {
        const v = s.parts[p];
        const op = v ? Math.min(1, 0.4 + v * 0.12) : 0;
        return `<span class="part p-${i} ${v ? 'on' : ''}" style="--o:${op}">${esc(p)}${v ? `<small>${fmtNum(v)}</small>` : ''}</span>`;
      }).join('')}
    </div>
    <h3>直近7日間（鍛えた日数）</h3>
    <div class="week-parts">
      ${PARTS.map((p, i) => `<div class="wp-row"><span class="wp-name">${esc(p)}</span>
        <span class="wp-dots">${Array.from({ length: 7 }, (_, k) => `<i class="${k < week[p] ? 'on p-' + i : ''}"></i>`).join('')}</span>
        <span class="wp-n">${week[p]}日</span></div>`).join('')}
    </div>
  </section>`;
}

function todayCard(s) {
  if (!s.byEx.size) return '';
  return `<section class="card">
    <h2>今日の記録</h2>
    ${[...s.byEx.entries()].map(([exId, ls]) => {
      const ex = calc.exercise(exId);
      return `<a class="log-line" href="#/ex/${esc(exId)}">
        <span class="part-dot p-${PARTS.indexOf(calc.partsOf(ex)[0])}"></span>
        <span class="log-name">${esc(ex ? ex.name : '（削除した種目）')}</span>
        <span class="log-sets">${ls.map(l => esc(setText(l, ex))).join('、')}</span>
      </a>`;
    }).join('')}
  </section>`;
}

function setText(l, ex) {
  if (!ex) return '';
  if (ex.type === 'strength') return `${fmtNum(l.weight, 2)}kg×${l.reps ?? ''}`;
  if (ex.type === 'bodyweight') return `${l.reps ?? ''}回${l.added_weight ? `(+${fmtNum(l.added_weight, 2)}kg)` : ''}`;
  const p = [];
  if (l.duration_min) p.push(`${fmtNum(l.duration_min)}分`);
  if (l.distance_km) p.push(`${fmtNum(l.distance_km, 2)}km`);
  if (l.calories) p.push(`${fmtNum(l.calories, 0)}kcal`);
  return p.join(' ');
}

// ---------- 種目を選ぶ ----------

function exercisesSorted() {
  return store.all('exercises').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function viewPick() {
  const list = exercisesSorted().filter(e => e.active);
  return {
    title: '種目を選ぶ',
    back: '#/home',
    html: PARTS.map((p, i) => {
      const xs = list.filter(e => calc.partsOf(e)[0] === p);
      if (!xs.length) return '';
      return `<section class="card"><h2><span class="part-dot p-${i}"></span>${esc(p)}</h2>
        <div class="pick-list">${xs.map(e => `<a class="pick" href="#/ex/${esc(e.id)}">${esc(e.name)}</a>`).join('')}</div></section>`;
    }).join('') + `<p class="hint">種目の追加・並べ替えは「設定」→「種目の管理」から。</p>`
  };
}

// ---------- 記録の入力 ----------

// 入力欄の最初の値：今日の最後のセット ＞（有酸素は）メニューの目安 ＞ 前回の1セット目 ＞ 初期値
function initialInputs(ex, today, item) {
  const todaySets = calc.exerciseLogs(ex.id).filter(l => l.date === today);
  if (todaySets.length) return { date: today, ...fromLog(todaySets[todaySets.length - 1]) };
  if (ex.type === 'cardio' && item && (item.duration_min || item.distance_km)) {
    return { date: today, weight: null, reps: null, added: null, duration: item.duration_min || null, distance: item.distance_km || null, calories: null };
  }
  const prev = calc.previousSession(ex.id, today);
  if (prev) return { date: today, ...fromLog(prev.sets[0]) };
  return {
    date: today,
    weight: ex.type === 'strength' ? (ex.initial_weight ?? 20) : null,
    reps: ex.type === 'cardio' ? null : 10,
    added: ex.type === 'bodyweight' ? 0 : null,
    duration: ex.type === 'cardio' ? 30 : null,
    distance: null,
    calories: null
  };
}

function fromLog(l) {
  return { weight: l.weight, reps: l.reps, added: l.added_weight ?? 0, duration: l.duration_min, distance: l.distance_km, calories: l.calories };
}

function viewEntry(exId) {
  const ex = calc.exercise(exId);
  if (!ex) return { title: '見つかりません', back: '#/home', html: '<p class="hint">この種目は見つかりません。</p>' };
  const today = todayJst();
  const menu = activeMenu(today);
  const item = menu && (menu.items || []).find(it => it.exercise_id === exId);
  if (!state.inputs[exId] || state.inputs[exId].date !== today) state.inputs[exId] = initialInputs(ex, today, item);
  const v = state.inputs[exId];
  const todaySets = calc.exerciseLogs(exId).filter(l => l.date === today);
  const prev = calc.previousSession(exId, today);
  const n = todaySets.length + 1;
  const isCardio = ex.type === 'cardio';
  const label = todaySets.length
    ? (isCardio ? 'もう1回記録' : `同じ値でもう1セット<small>セット${n}</small>`)
    : (isCardio ? '記録する' : `記録する<small>セット${n}</small>`);

  let menuHtml = '';
  if (item) {
    const idx = menu.items.indexOf(item);
    const next = menu.items.slice(idx + 1).concat(menu.items.slice(0, idx))
      .find(it => store.get('exercises', it.exercise_id) && setsDoneToday(it.exercise_id, today) < it.sets);
    const done = todaySets.length >= item.sets;
    menuHtml = `<div class="menu-bar ${done ? 'done' : ''}">
      <span>メニュー ${todaySets.length}/${item.sets} セット${done ? ' ✓' : ''}</span>
      ${done && next ? `<a class="btn btn-small" href="#/ex/${esc(next.exercise_id)}">次：${esc(store.get('exercises', next.exercise_id).name)} ›</a>` : ''}
      ${done && !next ? '<a class="btn btn-small" href="#/home">メニュー完了 ›</a>' : ''}
    </div>${item.note ? `<p class="menu-note">${esc(item.note)}</p>` : ''}`;
  }

  return {
    title: ex.name,
    back: '#/home',
    tab: 'ex',
    html: `
      ${menuHtml}
      <section class="card prev">
        ${prev ? `<div class="prev-head">前回 ${esc(fmtDate(prev.date))}<span class="hint">タップでその値を使う</span></div>
          <div class="chip-row">${prev.sets.map((l, i) => `<button class="chip chip-prev" data-act="use-prev" data-id="${esc(l.id)}">${i + 1}: ${esc(setText(l, ex))}</button>`).join('')}</div>`
          : '<div class="prev-head">前回の記録はありません</div>'}
      </section>
      <section class="card inputs">
        ${ex.type === 'strength' ? stepper('weight', '重量', 'kg', v.weight, ex.step || 2.5) : ''}
        ${ex.type !== 'cardio' ? stepper('reps', '回数', '回', v.reps, 1) : ''}
        ${ex.type === 'bodyweight' ? stepper('added', '加重（任意）', 'kg', v.added, ex.step || 1) : ''}
        ${isCardio ? stepper('duration', '時間', '分', v.duration, 5) + stepper('distance', '距離', 'km', v.distance, ex.step || 0.5) + stepper('calories', 'カロリー（任意）', 'kcal', v.calories, 10) : ''}
        ${ex.per_hand ? '<p class="hint">重量は片手の重さで入力（ボリュームは両手分で計算）</p>' : ''}
        <button class="btn btn-primary btn-record" data-act="record" data-ex="${esc(exId)}">${label}</button>
      </section>
      ${todaySets.length ? `<section class="card">
        <h2>今日のセット</h2>
        ${todaySets.map((l, i) => `<button class="set-line" data-act="edit-log" data-id="${esc(l.id)}">
          <span class="set-no">${i + 1}</span><span>${esc(setText(l, ex))}</span>
          ${ex.type === 'strength' ? `<span class="hint">1RM≈${fmtNum(calc.e1rm(l.weight, l.reps))}</span>` : ''}</button>`).join('')}
      </section>` : ''}
      ${notes()}`
  };
}

function stepper(field, label, unit, value, step) {
  return `<div class="stepper-row">
    <label class="stepper-label" for="in-${field}">${esc(label)}</label>
    <div class="stepper">
      <button class="step-btn" data-act="step" data-f="${field}" data-d="${-step}" aria-label="${esc(label)}を${step}減らす">−${step === 1 ? '' : `<small>${fmtNum(step, 2)}</small>`}</button>
      <div class="step-input"><input id="in-${field}" data-entry="${field}" inputmode="decimal" autocomplete="off" value="${esc(v2s(value))}"><span>${esc(unit)}</span></div>
      <button class="step-btn" data-act="step" data-f="${field}" data-d="${step}" aria-label="${esc(label)}を${step}増やす">＋${step === 1 ? '' : `<small>${fmtNum(step, 2)}</small>`}</button>
    </div>
  </div>`;
}

function v2s(v) {
  return v === null || v === undefined ? '' : fmtNum(v, 2);
}

function notes() {
  return `<details class="notes">
    <summary>トレーニングの注意</summary>
    <ul>
      <li>全種目で息を止めない。上げるときに吐く</li>
      <li>10回目で「あと2回いけそう」な重量で止める。限界まで追い込まない</li>
      <li>1〜3回しか上がらない高重量・MAX測定は行わない</li>
      <li>有酸素は会話できる強度を保つ。目安ペース 6:00〜6:30/km、心拍 130〜145bpm</li>
    </ul>
  </details>`;
}

async function record(exId) {
  const ex = calc.exercise(exId);
  const v = state.inputs[exId];
  if (!ex || !v) return;
  const today = todayJst();
  if (ex.type !== 'cardio' && !(v.reps > 0)) return toast('回数を入れてください');
  if (ex.type === 'cardio' && !(v.duration > 0) && !(v.distance > 0)) return toast('時間か距離を入れてください');
  const n = calc.exerciseLogs(exId).filter(l => l.date === today).length + 1;
  const log = {
    id: uuid(), date: today, exercise_id: exId, kind: 'normal', set_no: n,
    weight: ex.type === 'strength' ? (v.weight ?? 0) : null,
    reps: ex.type === 'cardio' ? null : v.reps,
    added_weight: ex.type === 'bodyweight' ? (v.added || null) : null,
    duration_min: ex.type === 'cardio' ? v.duration : null,
    distance_km: ex.type === 'cardio' ? v.distance : null,
    calories: ex.type === 'cardio' ? v.calories : null,
    memo: ''
  };
  await store.put('logs', log);
  state.undo = { ids: [log.id] };
  const prs = calc.newRecords(log);
  render();
  if (prs.length) {
    toast(`<span class="pr-badge">PR</span> 自己ベスト更新！ ${prs.map(p => `${esc(p.label)} ${fmtNum(p.value)}${esc(p.unit)}`).join('・')}`, { undo: true, pr: true, html: true });
  } else {
    toast(`記録しました：${esc(setText(log, ex))}`, { undo: true, html: true });
  }
}

// ---------- 懸垂カウンター ----------

async function counter() {
  const log = {
    id: uuid(), date: todayJst(), exercise_id: PULLUP_ID, kind: 'counter', set_no: null,
    weight: null, reps: COUNTER_REPS, added_weight: null, duration_min: null, distance_km: null, calories: null, memo: ''
  };
  await store.put('logs', log);
  state.undo = { ids: [log.id] };
  render();
  toast(`懸垂 +${COUNTER_REPS} 回`, { undo: true });
}

async function counterUndo() {
  const list = calc.logsOn(todayJst()).filter(l => l.kind === 'counter');
  if (!list.length) return;
  await store.remove('logs', list[list.length - 1].id);
  render();
  toast('懸垂を1回分取り消しました');
}

// ---------- 履歴 ----------

function viewHistory() {
  const today = todayJst();
  const date = state.histDate || today;
  const days = calc.workoutDays();
  const ws = weekStart(today);
  const monthStart = today.slice(0, 8) + '01';
  const s = calc.daySummary(date);
  const month = state.calMonth || today.slice(0, 7);
  return {
    title: '予定と記録',
    html: `
      <section class="card">
        <div class="day-nav">
          <button class="icon-btn" data-act="cal-month" data-d="-1" aria-label="前の月">‹</button>
          <h2>${Number(month.slice(0, 4))}年${Number(month.slice(5))}月</h2>
          <button class="icon-btn" data-act="cal-month" data-d="1" aria-label="次の月">›</button>
        </div>
        ${calendar(month, today, date)}
        <p class="legend cal-legend"><span class="cal-chip done">✓</span>できた <span class="cal-chip">予</span>予定 <span class="cal-chip missed">!</span>まだ <span class="cal-chip skipped">−</span>やめた</p>
      </section>
      <section class="card">
        <div class="day-nav">
          <button class="icon-btn" data-act="hist-move" data-d="-1" aria-label="前の日">‹</button>
          <h2>${esc(fmtDate(date))}${date === today ? '<small> 今日</small>' : ''}</h2>
          <button class="icon-btn" data-act="hist-move" data-d="1" aria-label="次の日">›</button>
        </div>
        ${planPanel(date, today)}
        ${s.list.length ? dayDetail(s) : `<p class="hint">${date > today ? '' : 'この日の記録はありません。'}</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>直近3ヶ月</h2><span class="hint">今週 ${calc.countDays(days, ws, today)}日・今月 ${calc.countDays(days, monthStart, today)}日</span></div>
        ${heatmap(today, days, date)}
      </section>`
  };
}

// カレンダーのマスに入る短い名前（「ラン：導入（歩き混ぜ）」→「🏃導入」）
const EX_ICON = { 'ex-running': '🏃', 'ex-swim': '🏊', 'ex-bike': '🚴', 'ex-walk': '🚶' };
function shortName(tpl) {
  const first = (tpl.items || [])[0];
  const icon = first && EX_ICON[first.exercise_id] ? EX_ICON[first.exercise_id] : '';
  const name = icon ? tpl.name.split('：').pop().replace(/（.*?）|\(.*?\)/g, '') : tpl.name;
  return icon + (name || tpl.name);
}

// 月のカレンダー（月曜始まり）。予定のメニュー名と、できた・まだ・やめたを表示する
function calendar(month, today, selected) {
  const first = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const last = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const days = calc.workoutDays();
  let cells = ['月', '火', '水', '木', '金', '土', '日'].map(d => `<span class="cal-wd">${d}</span>`).join('');
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const chips = plan.LANES.map(lane => {
      const x = plan.planOn(d, lane);
      if (!x) return '';
      const st = plan.status(x, today);
      const mark = { done: '✓', missed: '!', skipped: '−' }[st] || '';
      return `<span class="cal-chip lane-${lane} ${st}">${mark}${esc(shortName(store.get('templates', x.template_id)))}</span>`;
    }).join('');
    cells += `<button class="cal-cell ${d.slice(0, 7) !== month ? 'out' : ''} ${d === today ? 'today' : ''} ${d === selected ? 'sel' : ''}" data-act="hist-day" data-date="${d}">
      <span class="cal-day">${Number(d.slice(8))}</span>
      ${chips || (days.has(d) ? '<span class="cal-chip done">✓</span>' : '')}
    </button>`;
  }
  return `<div class="cal">${cells}</div>`;
}

// その日のレール（ずらす・変える）
function planPanel(date, today) {
  return `<div class="plan-panel">${plan.LANES.map(lane => {
    const x = plan.planOn(date, lane);
    const st = x ? plan.status(x, today) : null;
    const tpl = x ? store.get('templates', x.template_id) : null;
    const label = { done: 'できた', skipped: 'やめた', missed: 'まだ', today: '今日', future: '予定' }[st];
    const options = '<option value="">なし</option>' + templates().map(t => `<option value="${esc(t.id)}" ${x && x.template_id === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    return `<div class="plan-row lane-${lane}">
      <span class="rail-lane">${plan.LANE_LABEL[lane]}</span>
      <span class="plan-label">${tpl ? `<span class="cal-chip ${st}">${esc(label)}</span> ${esc(tpl.name)}` : '<span class="hint">なし</span>'}</span>
      ${tpl && ['today', 'future'].includes(st) ? `<button class="link" data-act="plan-postpone" data-date="${date}" data-lane="${lane}">後ろにずらす</button>` : ''}
    </div>
    ${date >= today ? `<select class="select plan-select" data-act-change="plan-set" data-date="${date}" data-lane="${lane}" aria-label="${plan.LANE_LABEL[lane]}の予定を変える">${options}</select>` : ''}`;
  }).join('')}</div>`;
}

function heatmap(today, days, selected) {
  const weeks = 13;
  const start = addDays(weekStart(today), -7 * (weeks - 1));
  let cols = '';
  for (let w = 0; w < weeks; w++) {
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      if (date > today) { cells += '<span class="hm-cell future"></span>'; continue; }
      const info = days.get(date);
      const sets = info ? info.sets : 0;
      const lv = !sets ? 0 : sets <= 6 ? 1 : sets <= 12 ? 2 : sets <= 18 ? 3 : 4;
      cells += `<button class="hm-cell lv${lv} ${date === selected ? 'sel' : ''}" data-act="hist-day" data-date="${date}" title="${esc(fmtDate(date))} ${sets}セット" aria-label="${esc(fmtDate(date))}"></button>`;
    }
    const first = addDays(start, w * 7);
    const label = first.slice(8) <= '07' ? `${Number(first.slice(5, 7))}月` : '';
    cols += `<div class="hm-col"><span class="hm-month">${label}</span>${cells}</div>`;
  }
  return `<div class="heatmap"><div class="hm-col hm-days"><span class="hm-month"></span>${['月', '', '水', '', '金', '', '日'].map(d => `<span class="hm-dlabel">${d}</span>`).join('')}</div>${cols}</div>
    <div class="hm-legend">少<span class="hm-cell lv1"></span><span class="hm-cell lv2"></span><span class="hm-cell lv3"></span><span class="hm-cell lv4"></span>多</div>`;
}

function dayDetail(s) {
  const counters = s.list.filter(l => l.kind === 'counter');
  return `<div class="day-stats">${s.sets}セット・${fmtInt(s.volume)}kg${s.minutes ? `・有酸素${fmtNum(s.minutes, 0)}分` : ''}</div>
    ${[...s.byEx.entries()].map(([exId, ls]) => {
      const ex = calc.exercise(exId);
      return `<div class="day-ex"><h3><span class="part-dot p-${PARTS.indexOf(calc.partsOf(ex)[0])}"></span>${esc(ex ? ex.name : '（削除した種目）')}</h3>
        ${ls.map((l, i) => `<button class="set-line" data-act="edit-log" data-id="${esc(l.id)}"><span class="set-no">${i + 1}</span><span>${esc(setText(l, ex))}</span>${l.memo ? `<span class="hint">${esc(l.memo)}</span>` : ''}</button>`).join('')}
      </div>`;
    }).join('')}
    ${counters.length ? `<div class="day-ex"><h3>懸垂カウンター（合計 ${counters.reduce((a, l) => a + (l.reps || 0), 0)}回）</h3>
      ${counters.map(l => `<button class="set-line" data-act="edit-log" data-id="${esc(l.id)}"><span class="set-no">+</span><span>${l.reps}回</span><span class="hint">${esc((l.created_at || '').slice(11, 16))}</span></button>`).join('')}</div>` : ''}`;
}

// 記録の修正・削除（ダイアログ）
function openLogEditor(id) {
  const l = store.get('logs', id);
  if (!l) return;
  const ex = calc.exercise(l.exercise_id);
  const t = ex ? ex.type : 'strength';
  state.draft = { kind: 'log', id, weight: l.weight, reps: l.reps, added: l.added_weight, duration: l.duration_min, distance: l.distance_km, calories: l.calories, memo: l.memo || '' };
  const f = (key, label, unit) => `<label class="field"><span>${esc(label)}</span><span class="field-in"><input data-draft="${key}" inputmode="decimal" value="${esc(v2s(state.draft[key]))}">${esc(unit)}</span></label>`;
  openModal(`<h2>${esc(ex ? ex.name : '記録')}<small>${esc(fmtDate(l.date))}</small></h2>
    ${t === 'strength' ? f('weight', '重量', 'kg') : ''}
    ${t !== 'cardio' ? f('reps', '回数', '回') : ''}
    ${t === 'bodyweight' && l.kind !== 'counter' ? f('added', '加重', 'kg') : ''}
    ${t === 'cardio' ? f('duration', '時間', '分') + f('distance', '距離', 'km') + f('calories', 'カロリー', 'kcal') : ''}
    <label class="field"><span>メモ</span><input data-draft="memo" data-text="1" value="${esc(state.draft.memo)}" maxlength="200"></label>
    <div class="modal-actions">
      <button class="btn btn-danger" data-act="log-delete">削除</button>
      <button class="btn" data-act="modal-close">やめる</button>
      <button class="btn btn-primary" data-act="log-save">保存</button>
    </div>`);
}

async function saveLogEdit() {
  const d = state.draft;
  const l = store.get('logs', d.id);
  if (!l) return closeModal();
  await store.put('logs', {
    ...l, weight: d.weight, reps: d.reps, added_weight: d.added,
    duration_min: d.duration, distance_km: d.distance, calories: d.calories, memo: d.memo
  });
  closeModal();
  render();
  toast('修正しました');
}

async function deleteLog() {
  const d = state.draft;
  if (!confirm('この記録を削除しますか？')) return;
  await store.remove('logs', d.id);
  closeModal();
  render();
  toast('削除しました');
}

// ---------- 推移 ----------

function viewTrends() {
  const today = todayJst();
  const all = calc.logs().filter(calc.isWorkout);
  const usedIds = [...new Set(all.map(l => l.exercise_id))];
  const exs = exercisesSorted().filter(e => usedIds.includes(e.id));
  if (!state.trendEx || !usedIds.includes(state.trendEx)) state.trendEx = all.length ? all[all.length - 1].exercise_id : null;
  const ex = state.trendEx ? calc.exercise(state.trendEx) : null;
  const metrics = ex ? calc.METRICS[ex.type] : [];
  if (!metrics.find(m => m[0] === state.trendMetric)) state.trendMetric = metrics.length ? metrics[0][0] : null;
  const weeks = calc.weeklySummary(today, 8);
  const months = calc.monthlySummary(today, 6);

  const prRows = exs.map(e => {
    const b = calc.bests(e.id);
    if (!b.length) return '';
    return `<tr><th>${esc(e.name)}</th><td>${b.map(x => `${esc(x.label)} <b>${fmtNum(x.value)}${esc(x.unit)}</b><small>${esc(fmtShort(x.date))}</small>`).join('<br>')}</td></tr>`;
  }).join('');

  return {
    title: '推移',
    html: `
      <section class="card">
        <h2>種目ごとの推移</h2>
        ${ex ? `<select class="select" data-act-change="trend-ex">${exs.map(e => `<option value="${esc(e.id)}" ${e.id === ex.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
          <div class="seg">${metrics.map(([k, label]) => `<button class="${k === state.trendMetric ? 'on' : ''}" data-act="trend-metric" data-k="${k}">${esc(label)}</button>`).join('')}</div>
          <div class="chart-box"><canvas id="trend-chart"></canvas></div>
          ${state.trendMetric === 'e1rm' ? '<p class="hint">推定1RM ＝ 重量 × (1 ＋ 回数 ÷ 30)（Epley式）。記録から計算した目安で、実際に測る必要はありません。</p>' : ''}`
          : '<p class="hint">記録がたまるとここにグラフが出ます。</p>'}
      </section>
      <section class="card">
        <h2>自己ベスト</h2>
        ${prRows ? `<table class="table pr-table">${prRows}</table>` : '<p class="hint">まだありません。</p>'}
      </section>
      <section class="card">
        <h2>週ごと（直近8週）</h2>
        <div class="chart-box short"><canvas id="week-days"></canvas></div>
        <div class="chart-box short"><canvas id="week-volume"></canvas></div>
      </section>
      <section class="card">
        <h2>月ごと</h2>
        <div class="table-scroll"><table class="table">
          <thead><tr><th>月</th><th>運動日数</th><th>総ボリューム</th><th>部位（日数）</th></tr></thead>
          <tbody>${months.slice().reverse().map(m => `<tr><th>${esc(m.label)}</th><td>${m.days}日</td><td>${fmtInt(m.volume)}kg</td>
            <td class="parts-mini">${PARTS.filter(p => m.parts[p]).map(p => `<span class="p-${PARTS.indexOf(p)}">${esc(p)}${m.parts[p]}</span>`).join(' ') || '—'}</td></tr>`).join('')}</tbody>
        </table></div>
      </section>`,
    after() {
      if (ex && state.trendMetric) {
        const sr = calc.series(ex.id, state.trendMetric);
        const m = metrics.find(x => x[0] === state.trendMetric);
        charts.lineChart(document.getElementById('trend-chart'), sr.map(p => fmtShort(p.date)), sr.map(p => round(p.value, 1)), m[1], m[2]);
      }
      charts.barChart(document.getElementById('week-days'), weeks.map(w => fmtShort(w.start) + '〜'), weeks.map(w => w.days), '運動日数', '日');
      charts.barChart(document.getElementById('week-volume'), weeks.map(w => fmtShort(w.start) + '〜'), weeks.map(w => Math.round(w.volume)), '総ボリューム', 'kg');
    }
  };
}

// ---------- 体調 ----------

function loadBody(date) {
  const c = store.get('conditions', date);
  const lastW = calc.lastCondition('weight', date);
  state.body = {
    date,
    am_sys: c ? c.am_sys : null, am_dia: c ? c.am_dia : null,
    pm_sys: c ? c.pm_sys : null, pm_dia: c ? c.pm_dia : null,
    weight: c && c.weight != null ? c.weight : (lastW ? round(lastW.weight, 1) : null),
    memo: c ? c.memo || '' : ''
  };
}

function viewBody() {
  const today = todayJst();
  if (!state.body) loadBody(today);
  const b = state.body;
  const date = b.date;
  const c = store.get('conditions', date);
  const saved = g => c && (g === 'memo' ? !!c.memo : c[g === 'weight' ? 'weight' : g + '_sys'] != null);
  if (!state.exportTo) { state.exportTo = today; state.exportFrom = addDays(today, -13); }
  const months = calc.monthlyConditionAverages();

  const bpCard = (slot, title) => {
    const ls = calc.lastCondition(slot + '_sys', date);
    return `<section class="card">
      <div class="card-head"><h2>${title}</h2>${saved(slot) ? '<span class="saved">✓ 保存済み</span>' : ''}</div>
      <div class="bp-inputs">
        <label class="field"><span>上</span><input data-body="${slot}_sys" inputmode="numeric" value="${esc(v2s(b[slot + '_sys']))}" placeholder="${ls ? esc(fmtNum(ls[slot + '_sys'], 0)) : ''}"></label>
        <span class="bp-slash">/</span>
        <label class="field"><span>下</span><input data-body="${slot}_dia" inputmode="numeric" value="${esc(v2s(b[slot + '_dia']))}" placeholder="${ls ? esc(fmtNum(ls[slot + '_dia'], 0)) : ''}"></label>
      </div>
      <div class="row-actions">
        ${ls ? `<button class="btn" data-act="bp-same" data-slot="${slot}">前回と同じ<small>${esc(fmtNum(ls[slot + '_sys'], 0))}/${esc(fmtNum(ls[slot + '_dia'], 0))}</small></button>` : ''}
        <button class="btn btn-primary" data-act="body-save" data-g="${slot}">保存</button>
      </div>
    </section>`;
  };

  return {
    title: '体調',
    html: `
      <div class="day-nav">
        <button class="icon-btn" data-act="body-move" data-d="-1" aria-label="前の日">‹</button>
        <h2>${esc(fmtDate(date))}</h2>
        <button class="icon-btn" data-act="body-move" data-d="1" aria-label="次の日" ${date >= today ? 'disabled' : ''}>›</button>
      </div>
      ${bpCard('am', '朝の血圧')}
      ${bpCard('pm', '夜の血圧')}
      <section class="card">
        <div class="card-head"><h2>体重</h2>${saved('weight') ? '<span class="saved">✓ 保存済み</span>' : ''}</div>
        <div class="stepper">
          <button class="step-btn" data-act="body-step" data-d="-0.1" aria-label="0.1kg減らす">−<small>0.1</small></button>
          <div class="step-input"><input data-body="weight" inputmode="decimal" value="${esc(fmtNum(b.weight, 1))}"><span>kg</span></div>
          <button class="step-btn" data-act="body-step" data-d="0.1" aria-label="0.1kg増やす">＋<small>0.1</small></button>
        </div>
        <button class="btn btn-primary btn-wide" data-act="body-save" data-g="weight">保存</button>
      </section>
      <section class="card">
        <div class="card-head"><h2>メモ</h2>${saved('memo') ? '<span class="saved">✓ 保存済み</span>' : ''}</div>
        <textarea data-body="memo" rows="2" maxlength="500" placeholder="外食した、睡眠不足 など">${esc(b.memo)}</textarea>
        <button class="btn btn-wide" data-act="body-save" data-g="memo">保存</button>
      </section>

      <section class="card">
        <h2>血圧の推移</h2>
        <div class="seg">
          <button class="${state.bpSlot === 'am' ? 'on' : ''}" data-act="bp-slot" data-v="am">朝</button>
          <button class="${state.bpSlot === 'pm' ? 'on' : ''}" data-act="bp-slot" data-v="pm">夜</button>
          <span class="seg-gap"></span>
          <button class="${state.bpRange === 30 ? 'on' : ''}" data-act="bp-range" data-v="30">30日</button>
          <button class="${state.bpRange === 90 ? 'on' : ''}" data-act="bp-range" data-v="90">90日</button>
        </div>
        <div class="chart-box"><canvas id="bp-chart"></canvas></div>
        <p class="legend"><i class="lg-sys"></i>上 <i class="lg-dia"></i>下（点＝その日の値、線＝7日移動平均）<i class="lg-ref"></i>基準 135/85</p>
      </section>
      <section class="card">
        <h2>体重の推移（90日）</h2>
        <div class="chart-box"><canvas id="weight-chart"></canvas></div>
        <p class="legend"><i class="lg-w"></i>体重 <i class="lg-ref"></i>目標ペース（月+${esc(fmtNum(goalPerMonth(), 2))}kg・最初の記録から）</p>
      </section>
      <section class="card">
        <h2>月ごとの平均</h2>
        ${months.length ? `<div class="table-scroll"><table class="table num">
          <thead><tr><th>月</th><th>朝上</th><th>朝下</th><th>夜上</th><th>夜下</th><th>体重</th></tr></thead>
          <tbody>${months.map(m => `<tr><th>${esc(m.month.replace('-', '/'))}</th>${['am_sys', 'am_dia', 'pm_sys', 'pm_dia'].map(f => `<td>${esc(fmtNum(m.avg[f], 0)) || '—'}</td>`).join('')}<td>${esc(fmtNum(m.avg.weight, 1)) || '—'}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="hint">記録がたまるとここに出ます。</p>'}
      </section>
      <section class="card">
        <h2>受診用に書き出す</h2>
        <div class="row-actions">
          <button class="btn btn-primary" data-act="export" data-fmt="png" data-preset="14">直近2週間（画像）</button>
          <button class="btn" data-act="export" data-fmt="csv" data-preset="14">直近2週間（CSV）</button>
        </div>
        <details class="export-more">
          <summary>期間を指定する</summary>
          <div class="range">
            <input type="date" data-export="from" value="${esc(state.exportFrom)}">〜<input type="date" data-export="to" value="${esc(state.exportTo)}">
          </div>
          <label class="check"><input type="checkbox" data-export="memo" ${state.exportMemo ? 'checked' : ''}> メモも含める</label>
          <div class="row-actions">
            <button class="btn" data-act="export" data-fmt="png">画像で出力</button>
            <button class="btn" data-act="export" data-fmt="csv">CSVで出力</button>
          </div>
        </details>
      </section>`,
    after() {
      drawBodyCharts(today);
    }
  };
}

function goalPerMonth() {
  const s = store.get('settings', 'weight_goal_per_month');
  const v = s ? parseNum(s.value) : null;
  return v === null ? DEFAULT_GOAL : v;
}

function drawBodyCharts(today) {
  const conds = new Map(calc.conditions().map(c => [c.date, c]));
  const n = state.bpRange;
  const dates = Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
  const slot = state.bpSlot;
  const pts = f => dates.map(d => ({ date: d, value: conds.has(d) ? conds.get(d)[f] : null }));
  const sys = pts(slot + '_sys');
  const dia = pts(slot + '_dia');
  // 移動平均は表示範囲の前の6日も使う（左端も7日分で平均できるように）
  const ext = f => Array.from({ length: n + 6 }, (_, i) => addDays(today, i - (n + 5))).map(d => ({ date: d, value: conds.has(d) ? conds.get(d)[f] : null }));
  const avg = f => calc.movingAverage(ext(f)).slice(6).map(p => (p.value == null ? null : round(p.value, 1)));
  charts.bpChart(document.getElementById('bp-chart'), dates.map(fmtShort), sys.map(p => p.value), dia.map(p => p.value), avg(slot + '_sys'), avg(slot + '_dia'));

  const wDates = Array.from({ length: 90 }, (_, i) => addDays(today, i - 89));
  const first = calc.conditions().find(c => c.weight != null);
  const rate = goalPerMonth();
  const goal = wDates.map(d => (first && d >= first.date ? round(first.weight + rate * ((Date.parse(d) - Date.parse(first.date)) / 86400000) / 30.44, 2) : null));
  charts.weightChart(document.getElementById('weight-chart'), wDates.map(fmtShort), wDates.map(d => (conds.has(d) ? conds.get(d).weight : null)), goal);
}

async function saveBody(group) {
  const b = state.body;
  if (group === 'am' || group === 'pm') {
    const s = b[group + '_sys'];
    const d = b[group + '_dia'];
    if ((s == null) !== (d == null)) return toast('上と下の両方を入れてください');
    if (s != null && (s < 50 || s > 300 || d < 30 || d > 200)) return toast('数値を確認してください');
  }
  if (group === 'weight' && b.weight != null && (b.weight < 20 || b.weight > 300)) return toast('体重を確認してください');
  const weight = b.weight == null ? null : round(b.weight, 1);
  await store.putCondition(b.date, { ...b, weight, memo: (b.memo || '').trim() }, [group]);
  render();
  toast('保存しました');
}

async function exportBody(fmt, preset) {
  const today = todayJst();
  let from = state.exportFrom;
  let to = state.exportTo;
  let withMemo = state.exportMemo;
  if (preset) { to = today; from = addDays(today, -(Number(preset) - 1)); withMemo = true; }
  if (!from || !to || from > to) return toast('期間を確認してください');
  const hasValue = c => ['am_sys', 'am_dia', 'pm_sys', 'pm_dia', 'weight'].some(f => c[f] != null) || (withMemo && c.memo);
  const list = calc.conditions().filter(c => c.date >= from && c.date <= to && hasValue(c));
  if (!list.length) return toast('この期間の記録はありません');
  const title = `血圧・体重の記録　${from.replace(/-/g, '/')}〜${to.replace(/-/g, '/')}`;
  const blob = fmt === 'csv' ? toCsv(list, withMemo) : await toPng(list, withMemo, title);
  const r = await shareOrDownload(blob, `bp_${from}_${to}.${fmt}`);
  if (r === 'downloaded') toast('ファイルを保存しました');
}

// ---------- 設定 ----------

function viewSettings() {
  const cfg = sync.getConfig();
  const s = sync.status();
  return {
    title: '設定',
    html: `
      <section class="card">
        <h2>サーバーとの同期</h2>
        <p class="sync-state sync-${s.kind}">${esc(s.kind === 'local' ? '未設定（この端末だけに保存しています）' : s.text)}${s.message ? `<br><small>${esc(s.message)}</small>` : ''}</p>
        <label class="field"><span>GAS の URL</span><input id="cfg-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url)}"></label>
        <label class="field"><span>合言葉</span><input id="cfg-pass" type="password" autocomplete="off" value="${esc(cfg.passcode)}"></label>
        <button class="btn btn-primary btn-wide" data-act="cfg-save">保存して接続テスト</button>
        <div class="row-actions">
          <button class="btn" data-act="sync-now">今すぐ同期</button>
          <button class="btn" data-act="sync-reset">サーバーから全部取り直す</button>
        </div>
        <p class="hint">URL と合言葉はこの端末にだけ保存されます（GitHub には入りません）。</p>
      </section>
      <section class="card">
        <a class="nav-line" href="#/schedule">予定の作り方（曜日ごとのメニュー） ›</a>
        <a class="nav-line" href="#/templates">メニュー（テンプレート）の管理 ›</a>
        <a class="nav-line" href="#/import">AI にメニューを作ってもらう ›</a>
        <a class="nav-line" href="#/exercises">種目の管理 ›</a>
      </section>
      <section class="card">
        <h2>体重の目標ペース</h2>
        <div class="field-in"><input id="cfg-goal" inputmode="decimal" value="${esc(fmtNum(goalPerMonth(), 2))}"> kg／月</div>
        <button class="btn btn-wide" data-act="goal-save">保存</button>
      </section>
      <section class="card">
        <h2>このアプリについて</h2>
        <p>バージョン <b id="app-version">${esc(APP_VERSION)}</b></p>
        <p class="hint">端末の保存先：${state.persistent ? 'IndexedDB' : '<b>一時的（プライベートブラウズなど）。アプリを閉じると消えます</b>'}・未同期 ${store.pendingCount()}件</p>
      </section>`
  };
}

function viewExercises() {
  const list = exercisesSorted();
  return {
    title: '種目の管理',
    back: '#/settings',
    tab: 'settings',
    html: `<section class="card">
      ${list.map((e, i) => `<div class="mgr-line ${e.active ? '' : 'hidden-item'}">
        <a class="mgr-name" href="#/exercise/${esc(e.id)}"><span class="part-dot p-${PARTS.indexOf(calc.partsOf(e)[0])}"></span>${esc(e.name)}
          <small>${esc(TYPE_LABEL[e.type] || '')}・${esc(calc.partsOf(e).join('・'))}${e.active ? '' : '・非表示'}</small></a>
        <button class="icon-btn" data-act="ex-move" data-id="${esc(e.id)}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
        <button class="icon-btn" data-act="ex-move" data-id="${esc(e.id)}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      </div>`).join('')}
    </section>
    <a class="btn btn-wide" href="#/exercise/new">＋ 種目を追加</a>`
  };
}

function viewExerciseEdit(id) {
  const ex = id === 'new' ? null : store.get('exercises', id);
  if (!state.draft || state.draft.kind !== 'exercise' || state.draft.id !== (ex ? ex.id : 'new')) {
    state.draft = ex
      ? { kind: 'exercise', id: ex.id, name: ex.name, type: ex.type, parts: calc.partsOf(ex), step: ex.step, initial_weight: ex.initial_weight, per_hand: ex.per_hand, active: ex.active }
      : { kind: 'exercise', id: 'new', name: '', type: 'strength', parts: [], step: 2.5, initial_weight: null, per_hand: false, active: true };
  }
  const d = state.draft;
  return {
    title: ex ? '種目の編集' : '種目の追加',
    back: '#/exercises',
    tab: 'settings',
    html: `<section class="card form">
      <label class="field"><span>名前</span><input data-draft="name" data-text="1" maxlength="40" value="${esc(d.name)}"></label>
      <div class="field"><span>タイプ</span><div class="seg">${Object.entries(TYPE_LABEL).map(([k, v]) => `<button class="${d.type === k ? 'on' : ''}" data-act="draft-type" data-v="${k}">${v}</button>`).join('')}</div></div>
      <div class="field"><span>部位（最初に選んだものが主部位）</span>
        <div class="chip-row">${PARTS.map((p, i) => {
          const k = d.parts.indexOf(p);
          return `<button class="chip part-chip p-${i} ${k >= 0 ? 'on' : ''}" data-act="draft-part" data-v="${esc(p)}">${k === 0 ? '主 ' : ''}${esc(p)}</button>`;
        }).join('')}</div></div>
      ${d.type !== 'cardio' ? `<label class="field"><span>±ボタンの増減幅（${d.type === 'bodyweight' ? '加重' : '重量'}）</span><span class="field-in"><input data-draft="step" inputmode="decimal" value="${esc(v2s(d.step))}">kg</span></label>` : ''}
      ${d.type === 'strength' ? `<label class="field"><span>初期重量の目安</span><span class="field-in"><input data-draft="initial_weight" inputmode="decimal" value="${esc(v2s(d.initial_weight))}">kg</span></label>
        <label class="check"><input type="checkbox" data-draft-check="per_hand" ${d.per_hand ? 'checked' : ''}> 片手の重さで記録する（ダンベル）</label>` : ''}
      <label class="check"><input type="checkbox" data-draft-check="active" ${d.active ? 'checked' : ''}> 種目一覧に表示する</label>
      <button class="btn btn-primary btn-wide" data-act="ex-save">保存</button>
      ${ex ? '<button class="btn btn-danger btn-wide" data-act="ex-delete">削除</button>' : ''}
    </section>`
  };
}

async function saveExercise() {
  const d = state.draft;
  if (!d.name.trim()) return toast('名前を入れてください');
  if (!d.parts.length) return toast('部位を1つ以上選んでください');
  const cur = d.id === 'new' ? null : store.get('exercises', d.id);
  const maxOrder = Math.max(0, ...store.all('exercises').map(e => e.sort_order || 0));
  await store.put('exercises', {
    ...(cur || {}),
    id: cur ? cur.id : uuid(),
    name: d.name.trim(), type: d.type, parts: d.parts.join(','),
    step: d.type === 'cardio' ? null : (d.step || (d.type === 'strength' ? 2.5 : 1)),
    initial_weight: d.type === 'strength' ? d.initial_weight : null,
    per_hand: d.type === 'strength' && !!d.per_hand,
    sort_order: cur ? cur.sort_order : maxOrder + 10,
    active: !!d.active
  });
  state.draft = null;
  location.hash = '#/exercises';
  toast('保存しました');
}

// 記録があってもなくても、行は消さずに deleted=true にする（過去の記録の種目名を残すため）
async function deleteExercise() {
  const d = state.draft;
  const n = store.all('logs').filter(l => l.exercise_id === d.id).length;
  const msg = n ? `この種目には${n}件の記録があります。種目一覧から消しますか？（過去の記録は残ります）` : 'この種目を削除しますか？';
  if (!confirm(msg)) return;
  await store.remove('exercises', d.id);
  state.draft = null;
  location.hash = '#/exercises';
  toast('削除しました');
}

async function moveExercise(id, dir) {
  const list = exercisesSorted();
  const i = list.findIndex(e => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changed = list.map((e, k) => ({ e, order: (k + 1) * 10 })).filter(x => x.e.sort_order !== x.order).map(x => ({ ...x.e, sort_order: x.order }));
  await store.putMany('exercises', changed);
  render();
}

function viewTemplates() {
  const list = templates();
  return {
    title: 'テンプレートの管理',
    back: '#/settings',
    tab: 'settings',
    html: `<section class="card">
      ${list.map(t => `<a class="nav-line" href="#/template/${esc(t.id)}">${esc(t.name)}
        <small>${t.weekday != null ? WEEKDAYS[t.weekday] + '曜・' : ''}${(t.items || []).length}種目</small> ›</a>`).join('')}
    </section>
    <a class="btn btn-wide" href="#/template/new">＋ テンプレートを追加</a>
    <a class="btn btn-wide" href="#/import">AI にメニューを作ってもらう（取り込み）</a>`
  };
}

// ---------- 予定の作り方（曜日ごとのメニュー） ----------

function viewSchedule() {
  if (!state.draft || state.draft.kind !== 'schedule') state.draft = { kind: 'schedule', pattern: JSON.parse(JSON.stringify(plan.pattern())) };
  const p = state.draft.pattern;
  const list = templates();
  const order = [1, 2, 3, 4, 5, 6, 0];
  const opts = (sel, lane) => `<option value="">−</option>` + list.map(t => `<option value="${esc(t.id)}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const table = stage => `<div class="sched-table">
    <div class="sched-head"><span></span><span>筋トレ</span><span>有酸素</span></div>
    ${order.map(wd => `<div class="sched-row"><span>${WEEKDAYS[wd]}</span>
      <select class="select" data-sched="${stage}:${wd}:s" aria-label="${WEEKDAYS[wd]}曜の筋トレ">${opts(p[stage][wd].s, 's')}</select>
      <select class="select" data-sched="${stage}:${wd}:c" aria-label="${WEEKDAYS[wd]}曜の有酸素">${opts(p[stage][wd].c, 'c')}</select></div>`).join('')}
  </div>`;
  const seqText = (stage, lane) => order.map(wd => p[stage][wd][lane]).filter(id => id && store.get('templates', id)).map(id => store.get('templates', id).name).join(' → ');
  return {
    title: '予定の作り方',
    back: '#/settings',
    tab: 'settings',
    html: `<p class="hint sched-lead">曜日ごとに筋トレと有酸素を決めると、6週間先までのレールがカレンダーに入ります。できなかった日の分は、次に開いたときに自動で後ろへずれます（先の予定も1つずつ）。</p>
    <section class="card form">
      <h2>はじめの期間</h2>
      <label class="check"><input type="checkbox" data-sched-intro ${p.intro ? 'checked' : ''}> はじめの期間だけ別の曜日割りにする</label>
      ${p.intro ? `<label class="field"><span>この日まで</span><input type="date" data-sched-until value="${esc(p.intro_until || '')}"></label>
        ${table('intro')}` : ''}
    </section>
    <section class="card form">
      <h2>${p.intro ? 'そのあと（いつもの曜日割り）' : 'いつもの曜日割り'}</h2>
      ${table('main')}
      <p class="hint">順番：筋トレ ${esc(seqText('main', 's') || '−')}／有酸素 ${esc(seqText('main', 'c') || '−')}（くり返し）</p>
    </section>
    <button class="btn btn-primary btn-wide" data-act="sched-save">この内容で今日からレールを作り直す</button>
    <p class="hint">できた日・過ぎた日の予定はそのまま残ります。</p>`
  };
}

// ---------- メニューの取り込み ----------

function viewImport() {
  const pv = state.importPreview;
  return {
    title: 'メニューの取り込み',
    back: '#/templates',
    tab: 'settings',
    html: `<section class="card">
      <h2>1. AI への依頼文をコピー</h2>
      <p class="hint">ChatGPT などの AI に貼り付けると、ランニング・スイミングなどのメニューを、このアプリに取り込める形で作ってくれます。「私について」の欄は自分で書き換えてください。</p>
      <button class="btn btn-primary btn-wide" data-act="prompt-copy">依頼文をコピー</button>
      <details class="export-more"><summary>依頼文を見る</summary><textarea id="prompt-text" rows="10" readonly>${esc(menuio.buildPrompt())}</textarea></details>
    </section>
    <section class="card">
      <h2>2. AI の答えを貼り付け</h2>
      <textarea id="import-text" rows="8" placeholder="AI の答え（JSON の部分）をここに貼り付け">${esc(state.importText || '')}</textarea>
      <button class="btn btn-wide" data-act="import-read">読み込む</button>
      ${pv ? importPreview(pv) : ''}
    </section>`
  };
}

function importPreview(pv) {
  return `${pv.errors.length ? `<div class="import-errors">${pv.errors.map(e => `<p>⚠ ${esc(e)}</p>`).join('')}</div>` : ''}
    ${pv.templates.map(t => `<div class="import-tpl">
      <h3>${esc(t.name)} <small>${t.existing ? '（同じ名前のメニューを置き換え）' : '（新しいメニュー）'}</small></h3>
      ${t.items.map(it => `<p class="import-item">・${esc(it.name)}${it.isNew ? ' <small>（新しい種目として追加）</small>' : ''}
        ${it.type === 'cardio' ? `${it.duration_min ? ` ${fmtNum(it.duration_min)}分` : ''}${it.distance_km ? ` ${fmtNum(it.distance_km, 2)}km` : ''}` : ` ${it.sets}セット`}
        ${it.note ? `<br><small>${esc(it.note)}</small>` : ''}</p>`).join('')}
    </div>`).join('')}
    ${pv.templates.length ? `<button class="btn btn-primary btn-wide" data-act="import-apply">${pv.templates.length}件のメニューを取り込む</button>` : ''}`;
}

function viewTemplateEdit(id) {
  const t = id === 'new' ? null : store.get('templates', id);
  if (!state.draft || state.draft.kind !== 'template' || state.draft.id !== (t ? t.id : 'new')) {
    state.draft = t
      ? { kind: 'template', id: t.id, name: t.name, weekday: t.weekday, items: (t.items || []).map(it => ({ ...it })) }
      : { kind: 'template', id: 'new', name: '', weekday: null, items: [] };
  }
  const d = state.draft;
  const exs = exercisesSorted().filter(e => e.active);
  return {
    title: t ? 'テンプレートの編集' : 'テンプレートの追加',
    back: '#/templates',
    tab: 'settings',
    html: `<section class="card form">
      <label class="field"><span>名前</span><input data-draft="name" data-text="1" maxlength="40" value="${esc(d.name)}"></label>
      <p class="hint">どの曜日にやるかは「設定」→「予定の作り方」で決めます。</p>
      <div class="field"><span>種目とセット数</span>
        ${d.items.map((it, i) => {
          const ex = calc.exercise(it.exercise_id);
          const cardio = ex && ex.type === 'cardio';
          return `<div class="tpl-block">
            <div class="tpl-item">
              <span class="tpl-name">${esc(ex ? ex.name : '（削除した種目）')}</span>
              ${cardio ? '' : `<button class="icon-btn" data-act="tpl-sets" data-i="${i}" data-d="-1" aria-label="セットを減らす">−</button>
              <b>${it.sets}</b>
              <button class="icon-btn" data-act="tpl-sets" data-i="${i}" data-d="1" aria-label="セットを増やす">＋</button>`}
              <button class="icon-btn" data-act="tpl-move" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
              <button class="icon-btn" data-act="tpl-remove" data-i="${i}" aria-label="外す">×</button>
            </div>
            ${cardio ? `<div class="tpl-targets">
              <label class="field-in"><input data-tpl-item="${i}" data-k="duration_min" inputmode="decimal" value="${esc(v2s(it.duration_min))}">分</label>
              <label class="field-in"><input data-tpl-item="${i}" data-k="distance_km" inputmode="decimal" value="${esc(v2s(it.distance_km))}">km</label>
            </div>` : ''}
            <input class="tpl-note" data-tpl-item="${i}" data-k="note" maxlength="200" placeholder="メモ（メニューの中身・目安など）" value="${esc(it.note || '')}">
          </div>`;
        }).join('') || '<p class="hint">まだ種目がありません。</p>'}
      </div>
      <div class="tpl-add">
        <select class="select" id="tpl-add-ex">${exs.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select>
        <button class="btn" data-act="tpl-add">追加</button>
      </div>
      <button class="btn btn-primary btn-wide" data-act="tpl-save">保存</button>
      ${t ? '<button class="btn btn-danger btn-wide" data-act="tpl-delete">削除</button>' : ''}
    </section>`
  };
}

async function saveTemplate() {
  const d = state.draft;
  if (!d.name.trim()) return toast('名前を入れてください');
  if (!d.items.length) return toast('種目を1つ以上入れてください');
  const cur = d.id === 'new' ? null : store.get('templates', d.id);
  const maxOrder = Math.max(0, ...store.all('templates').map(t => t.sort_order || 0));
  await store.put('templates', {
    ...(cur || {}),
    id: cur ? cur.id : uuid(),
    name: d.name.trim(), weekday: d.weekday,
    items: d.items.map(it => {
      const o = { exercise_id: it.exercise_id, sets: it.sets };
      if (it.note && it.note.trim()) o.note = it.note.trim();
      if (it.duration_min) o.duration_min = it.duration_min;
      if (it.distance_km) o.distance_km = it.distance_km;
      return o;
    }),
    sort_order: cur ? cur.sort_order : maxOrder + 10
  });
  state.draft = null;
  location.hash = '#/templates';
  toast('保存しました');
}

// ---------- 画面の表 ----------

const VIEWS = {
  home: viewHome,
  pick: viewPick,
  ex: viewEntry,
  history: viewHistory,
  trends: viewTrends,
  body: viewBody,
  settings: viewSettings,
  exercises: viewExercises,
  exercise: viewExerciseEdit,
  templates: viewTemplates,
  template: viewTemplateEdit,
  schedule: viewSchedule,
  import: viewImport
};

// ---------- 操作 ----------

async function onClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const d = el.dataset;
  switch (act) {
    case 'sync-pill':
      if (!sync.isConfigured()) location.hash = '#/settings';
      else { const s = sync.status(); if (s.message) toast(s.message); sync.syncNow(); }
      break;
    case 'menu-start':
      save('wo.menu', { date: todayJst(), templateId: d.id });
      render();
      break;
    case 'menu-close':
      save('wo.menu', null);
      render();
      break;
    case 'counter': await counter(); break;
    case 'counter-undo': await counterUndo(); break;
    case 'step': {
      const exId = route().args[0];
      const v = state.inputs[exId];
      if (!v) return;
      const next = Math.max(0, round((v[d.f] || 0) + Number(d.d), 2));
      v[d.f] = next;
      const input = document.querySelector(`[data-entry="${d.f}"]`);
      if (input) input.value = v2s(next);
      break;
    }
    case 'use-prev': {
      const exId = route().args[0];
      const l = store.get('logs', d.id);
      if (!l) return;
      state.inputs[exId] = { date: todayJst(), ...fromLog(l) };
      render();
      break;
    }
    case 'record': await record(d.ex); break;
    case 'undo': {
      if (!state.undo) return;
      for (const id of state.undo.ids) await store.remove('logs', id);
      state.undo = null;
      hideToast();
      render();
      toast('取り消しました');
      break;
    }
    case 'edit-log': openLogEditor(d.id); break;
    case 'log-save': await saveLogEdit(); break;
    case 'log-delete': await deleteLog(); break;
    case 'modal-close': closeModal(); break;
    case 'hist-day': state.histDate = d.date; state.calMonth = d.date.slice(0, 7); render(); break;
    case 'cal-month': {
      const [y, m] = (state.calMonth || todayJst().slice(0, 7)).split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1 + Number(d.d), 1)).toISOString().slice(0, 7);
      state.calMonth = t;
      render();
      break;
    }
    case 'plan-postpone': {
      const lane = d.lane || 's';
      const x = plan.planOn(d.date, lane);
      if (!x) return;
      const name = store.get('templates', x.template_id).name;
      if (!confirm(`${fmtDate(d.date)}の「${name}」を次の${plan.LANE_LABEL[lane]}の日にずらし、その先の予定も1つずつ後ろにずらします。よろしいですか？`)) return;
      const n = await plan.postpone(d.date, lane, todayJst());
      await plan.ensure(todayJst());
      render();
      toast(n ? 'この日から先の予定を、1つずつ後ろにずらしました' : 'ずらせる予定がありませんでした');
      break;
    }
    case 'plan-rain':
      await plan.setPlan(todayJst(), 'c', d.id);
      render();
      toast('今日の有酸素を自転車に替えました');
      break;
    case 'hist-move': {
      const next = addDays(state.histDate || todayJst(), Number(d.d));
      if (next > addDays(todayJst(), 90)) return;
      state.histDate = next;
      state.calMonth = next.slice(0, 7);
      render();
      break;
    }
    case 'trend-metric': state.trendMetric = d.k; render(); break;
    case 'body-move': {
      const next = addDays(state.body.date, Number(d.d));
      if (next > todayJst()) return;
      loadBody(next);
      render();
      break;
    }
    case 'body-step': {
      state.body.weight = Math.max(0, round((state.body.weight || 0) + Number(d.d), 1));
      const input = document.querySelector('[data-body="weight"]');
      if (input) input.value = fmtNum(state.body.weight, 1);
      break;
    }
    case 'bp-same': {
      const ls = calc.lastCondition(d.slot + '_sys', state.body.date);
      if (!ls) return;
      state.body[d.slot + '_sys'] = ls[d.slot + '_sys'];
      state.body[d.slot + '_dia'] = ls[d.slot + '_dia'];
      render();
      break;
    }
    case 'body-save': await saveBody(d.g); break;
    case 'bp-slot': state.bpSlot = d.v; render(); break;
    case 'bp-range': state.bpRange = Number(d.v); render(); break;
    case 'export': await exportBody(d.fmt, d.preset); break;
    case 'cfg-save': {
      const url = document.getElementById('cfg-url').value.trim();
      const pass = document.getElementById('cfg-pass').value;
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) return toast('URL は https://script.google.com/macros/s/…/exec の形で入れてください');
      if (!pass) return toast('合言葉を入れてください');
      el.disabled = true;
      el.textContent = '接続を確認中…';
      try {
        await sync.testAndSave(url, pass);
        toast('つながりました。同期を始めます');
      } catch (err) {
        toast('つながりませんでした：' + err.message);
      }
      render();
      break;
    }
    case 'sync-now': await sync.syncNow(); render(); toast(sync.status().message || sync.status().text); break;
    case 'sync-reset':
      if (!confirm('サーバーのデータを全部取り直します（端末の未同期の記録は消えません）。よろしいですか？')) return;
      await store.resetSince();
      await sync.syncNow();
      render();
      toast(sync.status().message || '取り直しました');
      break;
    case 'goal-save': {
      const v = parseNum(document.getElementById('cfg-goal').value);
      if (v === null || v < -5 || v > 5) return toast('-5〜5 の数値で入れてください');
      await store.put('settings', { id: 'weight_goal_per_month', value: String(v) });
      toast('保存しました');
      break;
    }
    case 'ex-move': await moveExercise(d.id, Number(d.d)); break;
    case 'draft-type': state.draft.type = d.v; render(); break;
    case 'draft-part': {
      const ps = state.draft.parts;
      const k = ps.indexOf(d.v);
      if (k >= 0) ps.splice(k, 1); else ps.push(d.v);
      render();
      break;
    }
    case 'ex-save': await saveExercise(); break;
    case 'ex-delete': await deleteExercise(); break;
    case 'tpl-sets': {
      const it = state.draft.items[Number(d.i)];
      it.sets = Math.max(1, Math.min(10, it.sets + Number(d.d)));
      render();
      break;
    }
    case 'tpl-move': {
      const items = state.draft.items;
      const i = Number(d.i);
      if (i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
      render();
      break;
    }
    case 'tpl-remove': state.draft.items.splice(Number(d.i), 1); render(); break;
    case 'tpl-add': {
      const id = document.getElementById('tpl-add-ex').value;
      if (id) state.draft.items.push({ exercise_id: id, sets: 3 });
      render();
      break;
    }
    case 'tpl-save': await saveTemplate(); break;
    case 'sched-save': {
      if (!confirm('今日以降のまだの予定を、この内容で作り直します。よろしいですか？')) return;
      if (state.draft.pattern.intro && !state.draft.pattern.intro_until) return toast('はじめの期間の終わりの日を入れてください');
      const pt = state.draft.pattern;
      if (pt.intro && !pt.intro_until) return toast('はじめの期間の終わりの日を入れてください');
      await plan.savePattern(pt);
      await plan.rebuild(todayJst());
      state.draft = null;
      location.hash = '#/history';
      toast('予定を作り直しました');
      break;
    }
    case 'prompt-copy': {
      const text = menuio.buildPrompt();
      try {
        await navigator.clipboard.writeText(text);
        toast('依頼文をコピーしました。AI に貼り付けてください');
      } catch (err) {
        const ta = document.getElementById('prompt-text');
        ta.closest('details').open = true;
        ta.focus();
        ta.select();
        toast('自動でコピーできませんでした。表示された文を長押しでコピーしてください');
      }
      break;
    }
    case 'import-read':
      state.importText = document.getElementById('import-text').value;
      state.importPreview = menuio.parse(state.importText);
      render();
      break;
    case 'import-apply': {
      const r = await menuio.apply(state.importPreview);
      state.importPreview = null;
      state.importText = '';
      location.hash = '#/templates';
      toast(`メニュー${r.templates}件を取り込みました${r.exercises ? `（新しい種目${r.exercises}件）` : ''}`);
      break;
    }
    case 'tpl-delete':
      if (!confirm('このテンプレートを削除しますか？')) return;
      await store.remove('templates', state.draft.id);
      state.draft = null;
      location.hash = '#/templates';
      toast('削除しました');
      break;
    default:
      break;
  }
}

function onInput(e) {
  const el = e.target;
  const ds = el.dataset;
  if (ds.entry) {
    const v = state.inputs[route().args[0]];
    if (v) v[ds.entry] = parseNum(el.value);
  } else if (ds.body) {
    state.body[ds.body] = ds.body === 'memo' ? el.value : parseNum(el.value);
  } else if (ds.draft) {
    state.draft[ds.draft] = ds.text ? el.value : parseNum(el.value);
  } else if (ds.draftCheck) {
    state.draft[ds.draftCheck] = el.checked;
  } else if (ds.draftSelect) {
    state.draft[ds.draftSelect] = el.value === '' ? null : Number(el.value);
  } else if (ds.export) {
    if (ds.export === 'memo') state.exportMemo = el.checked;
    else if (ds.export === 'from') state.exportFrom = el.value;
    else state.exportTo = el.value;
  } else if (ds.sched !== undefined) {
    const [stage, wd, lane] = ds.sched.split(':');
    state.draft.pattern[stage][wd][lane] = el.value || null;
    if (e.type === 'change') render();
  } else if (ds.schedIntro !== undefined) {
    if (e.type !== 'change') return;
    const pt = state.draft.pattern;
    if (el.checked) {
      pt.intro = JSON.parse(JSON.stringify(pt.main));
      pt.intro_until = addDays(todayJst(), 13);
    } else {
      pt.intro = null;
      pt.intro_until = null;
    }
    render();
  } else if (ds.schedUntil !== undefined) {
    state.draft.pattern.intro_until = el.value || null;
  } else if (ds.tplItem !== undefined) {
    const it = state.draft.items[Number(ds.tplItem)];
    if (ds.k === 'note') it.note = el.value;
    else it[ds.k] = parseNum(el.value);
  } else if (ds.actChange === 'plan-set' && e.type === 'change') {
    plan.setPlan(ds.date, ds.lane || 's', el.value || null).then(() => { render(); toast('予定を変えました'); });
  } else if (ds.actChange === 'trend-ex' && e.type === 'change') {
    state.trendEx = el.value;
    state.trendMetric = null;
    render();
  }
}

// ---------- お知らせ・ダイアログ ----------

function toast(msg, { undo = false, pr = false, html = false } = {}) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.className = 'toast show' + (pr ? ' pr' : '');
  el.innerHTML = `<span class="toast-msg">${html ? msg : esc(msg)}</span>${undo ? '<button class="toast-undo" data-act="undo">取り消す</button>' : ''}`;
  toastTimer = setTimeout(hideToast, undo ? 6000 : 3000);
}

function hideToast() {
  const el = document.getElementById('toast');
  el.className = 'toast';
}

function openModal(html) {
  const el = document.getElementById('modal');
  el.innerHTML = `<div class="modal-back" data-act="modal-close"></div><div class="modal-body" role="dialog" aria-modal="true">${html}</div>`;
  el.classList.add('show');
}

function closeModal() {
  const el = document.getElementById('modal');
  el.classList.remove('show');
  el.innerHTML = '';
}

main();
