// 画面の描画と操作。
// 画面は「#/home」のようなアドレス（ハッシュ）で切り替える。描画は文字列の HTML を #app に入れる方式。
// 記録は store.js（端末）に保存してすぐ画面を更新し、サーバーとの同期は sync.js が裏で行う。

import * as store from './store.js';
import * as sync from './sync.js';
import * as calc from './calc.js';
import * as charts from './charts.js';
import * as plan from './plan.js';
import * as menuio from './menuio.js';
import * as target from './target.js';
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
  open: {},         // 開いている折りたたみ（種目カードのメニューの中身など）
  welcome: false,   // できなかった予定を自動でずらしたあと、ひとこと出す
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
  // 折りたたみの開け閉めを覚えておく（描き直しても閉じないように）
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (d && d.dataset && d.dataset.fold) state.open[d.dataset.fold] = d.open;
  }, true);
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
    if (moved) { state.welcome = true; if (route().name === 'home') maybeWelcomeBack(); }
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

// 下のタブのアイコン（線のアイコン。色は文字色に合わせる）
const TAB_ICONS = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h4.5v-6h4v6h4.5V9"/>',
  history: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  trends: '<path d="M4 19.5h16"/><path d="m5 15 4.5-4.5 3.5 3.5L19 8"/><path d="M15 8h4v4"/>',
  body: '<path d="M12 19.5s-7.5-4.6-7.5-10.2A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 7.5 2.3c0 5.6-7.5 10.2-7.5 10.2z"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'
};
const TABS = [['home', '今日'], ['history', 'カレンダー'], ['trends', '推移'], ['body', '体調'], ['settings', '設定']];

function renderTabbar(active) {
  const tab = active === 'ex' || active === 'pick' ? 'home' : ['schedule', 'import', 'plan'].includes(active) ? 'settings' : active;
  document.getElementById('tabbar').innerHTML = TABS.map(([id, label]) =>
    `<a href="#/${id}" class="tab ${tab === id ? 'active' : ''}" ${tab === id ? 'aria-current="page"' : ''}>
      <span class="tab-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[id]}</svg></span>
      <span class="tab-label">${label}</span></a>`).join('');
}

// ---------- ホーム（今日） ----------

function viewHome() {
  const today = todayJst();
  const s = calc.daySummary(today);
  const lanes = todayLanes(today);
  return {
    title: '今日 ' + fmtDate(today),
    html: `
      ${progressCard(today, lanes, s)}
      ${lanes.map(l => laneCard(l, today)).join('')}
      ${counterCard(today)}
      ${partsCard(today, lanes, s)}
      ${offRailCard(today, lanes, s)}
      <a class="link-wide" href="#/pick">＋ ほかの種目を記録</a>`,
    after() { maybeWelcomeBack(); }
  };
}

// 今日のレール（筋トレ・有酸素）と、その種目・進み具合
function todayLanes(today) {
  return plan.LANES.map(lane => {
    const x = plan.planOn(today, lane);
    if (!x) return null;
    const tpl = store.get('templates', x.template_id);
    const items = (tpl.items || []).map(it => ({ it, ex: store.get('exercises', it.exercise_id) })).filter(o => o.ex)
      .map(o => ({ ...o, pg: itemProgress(o.ex, o.it, today) }));
    return { lane, tpl, items, done: items.filter(o => o.pg.complete).length };
  }).filter(Boolean);
}

// いちばん上：今日の進み具合（輪っか）
function progressCard(today, lanes, s) {
  const next = plan.nextPlans(today);
  const nextText = next ? `次：${fmtDate(next.date)} ${next.list.map(x => store.get('templates', x.template_id).name).join('・')}` : '';
  if (!lanes.length) {
    return `<section class="card hero rest"><div class="hero-emoji">🌙</div>
      <div class="hero-text"><b>今日はお休み</b><small>${esc(nextText || '設定 → プランでレールを作れます')}</small></div></section>`;
  }
  const total = lanes.reduce((a, l) => a + l.items.length, 0);
  const done = lanes.reduce((a, l) => a + l.done, 0);
  const pct = total ? done / total : 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  const chips = [s.sets ? `${s.sets}セット` : '', s.volume ? `${fmtInt(s.volume)}kg` : '', s.minutes ? `有酸素${fmtNum(s.minutes, 0)}分` : ''].filter(Boolean);
  return `<section class="card hero ${done === total ? 'complete' : ''}">
    <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="${r}" class="ring-bg"></circle>
      ${pct > 0 ? `<circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${(c * pct).toFixed(1)} ${c.toFixed(1)}"></circle>` : ''}
      <text x="32" y="37" text-anchor="middle">${done === total ? '🎉' : `${done}/${total}`}</text>
    </svg>
    <div class="hero-text">
      <b>${done === total ? 'ぜんぶできた！おつかれさま' : done ? `あと${total - done}つ` : `今日は${total}つ`}</b>
      ${chips.length ? `<span class="hero-chips">${chips.map(x => `<span>${esc(x)}</span>`).join('')}</span>` : ''}
      ${nextText ? `<small>${esc(nextText)}</small>` : ''}
    </div>
  </section>`;
}

// レールのカード（筋トレ／有酸素）
function laneCard(l, today) {
  const allDone = l.done === l.items.length;
  const started = plan.doneOn(today, l.lane);
  const rain = l.lane === 'c' ? plan.rainAlternative(today) : null;
  const pct = l.items.length ? Math.round(l.done / l.items.length * 100) : 0;
  return `<section class="card lane-card lane-${l.lane} ${allDone ? 'all-done' : ''}">
    <div class="lane-head">
      <span class="rail-lane">${plan.LANE_LABEL[l.lane]}</span>
      <h2>${esc(l.tpl.name)}</h2>
      <span class="lane-count">${l.done}/${l.items.length}</span>
    </div>
    <div class="lane-bar"><i style="width:${pct}%"></i></div>
    ${allDone ? `<div class="lane-done">🎉 ${plan.LANE_LABEL[l.lane]}、完了！</div>` : ''}
    ${l.items.map(o => exCard(o.ex, o.it, o.pg, today)).join('')}
    ${started ? '' : `<div class="lane-actions">
      <button class="chip-btn" data-act="plan-postpone" data-date="${today}" data-lane="${l.lane}">🌙 今日はできない</button>
      ${rain ? `<button class="chip-btn" data-act="plan-rain" data-id="${esc(rain)}">☔ 自転車にする</button>` : ''}
    </div>`}
  </section>`;
}

// 注意書きを、絵文字つきの小さな吹き出しに
function tipPill(t) {
  const icon = /シャワー|保湿/.test(t) ? '🚿' : /息|呼吸|吐/.test(t) ? '🫧' : /ペース|km|速/.test(t) ? '🐢' : /休/.test(t) ? '☕' : '💡';
  return `<span class="tip">${icon} ${esc(t)}</span>`;
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

// 今日のその種目の進み具合（筋トレ＝目標のセット数、有酸素＝1回）
function itemProgress(ex, it, today) {
  const logs = calc.exerciseLogs(ex.id).filter(l => l.date === today);
  const goal = ex.type === 'cardio' ? 1 : (it.sets || 1);
  return { logs, goal, complete: logs.length >= goal };
}

// 種目のカード：右の丸いボタン＝「目標どおりできた」（1タップで残りのセットを記録）。メニューの中身は折りたたみ
function exCard(ex, it, pg, today) {
  const t = target.targetFor(ex, it, today);
  const ns = noteSteps(it.note);
  const plain = it.note && !ns ? String(it.note).split('。').map(x => x.trim()).filter(Boolean) : [];
  const partial = pg.logs.length && !pg.complete;
  const reason = shortReason(t.reason);
  return `<div class="ex-card ${pg.complete ? 'done' : ''}">
    <div class="ex-row">
      <div class="ex-main">
        <div class="ex-name"><span class="part-dot p-${PARTS.indexOf(calc.partsOf(ex)[0])}"></span>${esc(ex.name)}</div>
        ${pg.complete
          ? `<div class="ex-done-text">✓ ${esc(groupSets(pg.logs, ex))}</div>`
          : `<div class="ex-target">${cardTarget(ex, t)}</div>`}
        <div class="ex-pills">
          ${!pg.complete && reason ? `<span class="pill ${reason.startsWith('↑') ? 'up' : ''}">${esc(reason)}</span>` : ''}
          ${!pg.complete && ex.per_hand ? '<span class="pill">片手</span>' : ''}
          ${partial ? `<span class="pill">${pg.logs.length}/${pg.goal}セット</span>` : ''}
          <a class="pill pill-link" href="#/ex/${esc(ex.id)}">✎ ${pg.complete ? '直す' : '数値で'}</a>
        </div>
      </div>
      ${pg.complete
        ? `<button class="check-badge" data-act="card-undo" data-ex="${esc(ex.id)}" aria-label="完了を取り消す"><span>✓</span><small>戻す</small></button>`
        : `<button class="check-btn" data-act="card-done" data-ex="${esc(ex.id)}" aria-label="目標どおりできた"><span>✓</span><small>${partial ? '残り' : 'できた'}</small></button>`}
    </div>
    ${ns || plain.length ? `<details class="ex-more" data-fold="${esc(ex.id)}" ${state.open[ex.id] ? 'open' : ''}>
      <summary>${ns ? `メニューの中身（${ns.steps.length}ステップ）` : 'ポイント'}</summary>
      ${ns ? stepsHtml(ex.id, ns) + (ns.tips.length ? `<div class="tip-row">${ns.tips.map(tipPill).join('')}</div>` : '') : `<ul class="bullets">${plain.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`}
    </details>` : ''}
  </div>`;
}

// カードの目標（大きく・短く）：「30kg × 10回 × 4」「10回 × 2」「34分・4.3km」
function cardTarget(ex, t) {
  if (ex.type === 'cardio') return esc(target.targetText(ex, t));
  const head = ex.type === 'strength' ? `${fmtNum(t.weight, 2)}<u>kg</u> × ` : (t.added ? `+${fmtNum(t.added, 2)}<u>kg</u> × ` : '');
  return `${head}${t.reps}<u>回</u> × ${t.sets}<u>セット</u>`;
}

// 同じ内容のセットをまとめる：「25kg×10 ×4セット」「25kg×10 ×2セット、22.5kg×8」
function groupSets(logs, ex) {
  const out = [];
  logs.forEach(l => {
    const t = setText(l, ex);
    if (out.length && out[out.length - 1].t === t) out[out.length - 1].n++;
    else out.push({ t, n: 1 });
  });
  return out.map(g => (g.n > 1 ? `${g.t} ×${g.n}${ex.type === 'cardio' ? '' : 'セット'}` : g.t)).join('、');
}

function shortReason(r) {
  if (!r) return '';
  const m = r.match(/\+([\d.]+kg|回数\+1)/);
  if (r.startsWith('前回クリア')) return m && m[1] === '回数+1' ? '↑ +1回' : `↑ +${(r.match(/\+([\d.]+)kg/) || [])[1] || ''}kg`;
  if (r.startsWith('前回と同じ')) return '前回と同じ';
  if (r.startsWith('MAX')) return 'MAXから推定';
  if (r.startsWith('初回')) return 'はじめて';
  return r;
}

// メニューのメモを手順に分ける：「A → B → C。注意1。注意2」→ 手順 [A, B, C] と注意 [注意1, 注意2]
// 手順が2つ以上（→ がある）ときだけ分ける。（ ）の中の「。」では切らない
function noteSteps(note) {
  const parts = String(note || '').split('→').map(x => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < last.length; i++) {
    const c = last[i];
    if (c === '（' || c === '(') depth++;
    else if (c === '）' || c === ')') depth = Math.max(0, depth - 1);
    else if (c === '。' && depth === 0) { cut = i; break; }
  }
  let tips = [];
  if (cut >= 0) {
    tips = last.slice(cut + 1).split('。').map(x => x.trim()).filter(Boolean);
    parts[parts.length - 1] = last.slice(0, cut).trim();
  }
  return { steps: parts, tips };
}

// 手順のチェック（その日だけ・この端末だけ。記録には入らない目印）
function stepState(today) {
  const st = load('wo.steps', null);
  return st && st.date === today ? st : { date: today, map: {} };
}

// メモの表示（記録の画面用）：手順があれば小さなカード、注意は吹き出し
function noteHtml(exId, note) {
  const ns = noteSteps(note);
  if (!ns) return `<ul class="bullets">${String(note).split('。').map(x => x.trim()).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return stepsHtml(exId, ns) + (ns.tips.length ? `<div class="tip-row">${ns.tips.map(tipPill).join('')}</div>` : '');
}

// 手順の小さなカード（タップで ✓）
function stepsHtml(exId, ns) {
  const done = stepState(todayJst()).map[exId] || [];
  return `<ol class="step-list">${ns.steps.map((x, i) => {
    const k = x.search(/[（(]/);
    const main = k > 0 ? x.slice(0, k) : x;
    const sub = k > 0 ? x.slice(k) : '';
    const on = done.includes(i);
    return `<li><button class="step-card ${on ? 'done' : ''}" data-act="step-toggle" data-ex="${esc(exId)}" data-i="${i}" aria-pressed="${on}">
      <span class="step-no">${on ? '✓' : i + 1}</span>
      <span class="step-text"><b>${esc(main)}</b>${sub ? `<small>${esc(sub.replace(/^[（(]|[）)]$/g, ''))}</small>` : ''}</span>
    </button></li>`;
  }).join('')}</ol>`;
}

// 今日のレールの中から、その種目のメニュー項目を探す
function todayItem(exId, today) {
  for (const lane of plan.LANES) {
    const x = plan.planOn(today, lane);
    const tpl = x && store.get('templates', x.template_id);
    const it = tpl && (tpl.items || []).find(i => i.exercise_id === exId);
    if (it) return { tpl, item: it, lane };
  }
  const menu = activeMenu(today);
  const it = menu && (menu.items || []).find(i => i.exercise_id === exId);
  return it ? { tpl: menu, item: it, lane: null } : null;
}

// 「目標どおりできた」：残りのセットを目標の値でまとめて記録する
async function cardDone(exId) {
  const today = todayJst();
  const ex = calc.exercise(exId);
  const found = todayItem(exId, today);
  if (!ex || !found) return;
  const t = target.targetFor(ex, found.item, today);
  const pg = itemProgress(ex, found.item, today);
  const n = Math.max(0, pg.goal - pg.logs.length);
  if (!n) return;
  const logs = Array.from({ length: n }, (_, i) => ({
    id: uuid(), date: today, exercise_id: exId, kind: 'normal', set_no: pg.logs.length + i + 1,
    weight: ex.type === 'strength' ? t.weight : null,
    reps: ex.type === 'cardio' ? null : t.reps,
    added_weight: ex.type === 'bodyweight' ? (t.added || null) : null,
    duration_min: ex.type === 'cardio' ? t.duration : null,
    distance_km: ex.type === 'cardio' ? t.distance : null,
    calories: null, memo: ''
  }));
  for (const l of logs) await store.put('logs', l);
  state.undo = { ids: logs.map(l => l.id) };
  const prs = calc.newRecords(logs[logs.length - 1]);
  render();
  const text = `${ex.name}：${target.targetText(ex, { ...t, sets: n })}`;
  if (prs.length) toast(`<span class="pr-badge">PR</span> 自己ベスト更新！ ${prs.map(p => `${esc(p.label)} ${fmtNum(p.value)}${esc(p.unit)}`).join('・')}`, { undo: true, pr: true, html: true });
  else toast(`記録しました（${esc(text)}）`, { undo: true, html: true });
}

// ちょこっと懸垂：思い立ったときに1タップで2回分を記録する（通常の記録とは別に数える）
function counterCard(today) {
  const todayReps = calc.counterReps(today, today);
  const weekReps = calc.counterReps(addDays(today, -6), today);
  const hasToday = calc.logsOn(today).some(l => l.kind === 'counter');
  return `<section class="card counter">
    <div class="counter-text">
      <h2>ちょこっと懸垂</h2>
      <small>ぶら下がったついでに、1タップで${COUNTER_REPS}回</small>
      <div class="counter-nums"><span><b>${todayReps}</b>回<em>今日</em></span><span><b>${weekReps}</b>回<em>7日間</em></span>
        ${hasToday ? '<button class="link" data-act="counter-undo">1回分戻す</button>' : ''}</div>
    </div>
    <button class="btn-counter" data-act="counter" aria-label="懸垂を${COUNTER_REPS}回記録">+${COUNTER_REPS}<small>回</small></button>
  </section>`;
}

// 今日の部位：うすい色＝今日のレールで使う部位、こい色＝記録した部位
function partsCard(today, lanes, s) {
  const week = calc.partDays(today, 7);
  const planned = new Set(lanes.flatMap(l => l.items.flatMap(o => calc.partsOf(o.ex))));
  return `<section class="card">
    <div class="card-head"><h2>今日の部位</h2><span class="legend-mini"><i class="lg-plan"></i>予定 <i class="lg-done"></i>記録済み</span></div>
    <div class="parts">
      ${PARTS.map((p, i) => {
        const st = s.parts[p] ? 'done' : planned.has(p) ? 'plan' : '';
        return `<span class="part p-${i} ${st}">${st === 'done' ? '✓ ' : ''}${esc(p)}</span>`;
      }).join('')}
    </div>
    <details class="mini-fold"><summary>直近7日間に鍛えた日数</summary>
      <div class="week-parts">
        ${PARTS.map((p, i) => `<div class="wp-row"><span class="wp-name">${esc(p)}</span>
          <span class="wp-dots">${Array.from({ length: 7 }, (_, k) => `<i class="${k < week[p] ? 'on p-' + i : ''}"></i>`).join('')}</span>
          <span class="wp-n">${week[p]}日</span></div>`).join('')}
      </div>
    </details>
  </section>`;
}

// レール以外で記録したもの
function offRailCard(today, lanes, s) {
  const inRail = new Set(lanes.flatMap(l => l.items.map(o => o.ex.id)));
  const rest = [...s.byEx.entries()].filter(([exId]) => !inRail.has(exId));
  if (!rest.length) return '';
  return `<section class="card">
    <h2>ほかの記録</h2>
    ${rest.map(([exId, ls]) => {
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
  if (ex.type !== 'cardio') {
    // 今日の目標（前回クリアなら1段階上）を最初の値にする
    const t = target.targetFor(ex, item, today);
    return { date: today, weight: ex.type === 'strength' ? t.weight : null, reps: t.reps, added: ex.type === 'bodyweight' ? (t.added || 0) : null, duration: null, distance: null, calories: null };
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
  const found = todayItem(exId, today);
  const menu = found ? found.tpl : null;
  const item = found ? found.item : null;
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
    </div>${item.note ? noteHtml(exId, item.note) : ''}`;
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
  const pc = plan.planConfig();
  const row = (href, icon, title, sub = '') => `<a class="list-row" href="${href}"><span class="row-icon">${icon}</span>
    <span class="row-main"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><span class="chev">›</span></a>`;
  return {
    title: '設定',
    html: `
      <section class="card list-card">
        ${row('#/plan', '🗓️', 'プラン', `筋トレ 週${pc.s_freq}・有酸素 ${pc.c_on ? `週${pc.c_freq}` : 'なし'}`)}
        ${row('#/templates', '📋', 'メニュー')}
        ${row('#/exercises', '🏋️', '種目')}
        ${row('#/import', '🤖', 'AI にメニューを作ってもらう')}
      </section>
      <section class="card">
        <div class="inline-setting"><span>体重の目標ペース</span>
          <span class="field-in"><input id="cfg-goal" inputmode="decimal" value="${esc(fmtNum(goalPerMonth(), 2))}">kg／月</span>
          <button class="btn btn-small" data-act="goal-save">保存</button></div>
      </section>
      <section class="card about">
        <span>バージョン <b id="app-version">${esc(APP_VERSION)}</b></span>
        <span class="hint">${state.persistent ? '' : '⚠ 一時保存（プライベートブラウズ）'}${sync.isConfigured() && store.pendingCount() ? `未同期 ${store.pendingCount()}件` : ''}</span>
      </section>
      <details class="card fold" data-fold="sync" ${state.open.sync || s.kind === 'error' ? 'open' : ''}>
        <summary><span class="row-icon">🔄</span><b>サーバーとの同期</b><span class="fold-status sync-${s.kind}">${esc(s.kind === 'local' ? '未設定' : s.text)}</span></summary>
        ${s.message ? `<p class="sync-state sync-${s.kind}">${esc(s.message)}</p>` : ''}
        <label class="field"><span>GAS の URL</span><input id="cfg-url" type="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(cfg.url)}"></label>
        <label class="field"><span>合言葉</span><input id="cfg-pass" type="password" autocomplete="off" value="${esc(cfg.passcode)}"></label>
        <button class="btn btn-primary btn-wide" data-act="cfg-save">保存して接続テスト</button>
        <div class="row-actions">
          <button class="btn" data-act="sync-now">今すぐ同期</button>
          <button class="btn" data-act="sync-reset">全部取り直す</button>
        </div>
      </details>`
  };
}

// 種目：筋トレ（自重を含む）と有酸素に分けて表示。左のつまみでドラッグして並べ替え、右のスイッチで一覧に出す／出さない
function viewExercises() {
  const list = exercisesSorted();
  const group = (title, xs, key) => `<section class="card list-card">
    <h2 class="list-title">${title}</h2>
    <div class="sort-list" data-sort-group="${key}">
      ${xs.map(e => `<div class="sort-row ${e.active ? '' : 'off'}" data-sort-id="${esc(e.id)}">
        <span class="drag-handle" aria-label="ドラッグで並べ替え">⋮⋮</span>
        <a class="sort-main" href="#/exercise/${esc(e.id)}"><span class="part-dot p-${PARTS.indexOf(calc.partsOf(e)[0])}"></span>
          <span><b>${esc(e.name)}</b><small>${esc(calc.partsOf(e).join('・'))}</small></span></a>
        <label class="switch sm" aria-label="${esc(e.name)}を一覧に出す"><input type="checkbox" data-ex-active="${esc(e.id)}" ${e.active ? 'checked' : ''}></label>
      </div>`).join('')}
    </div>
  </section>`;
  return {
    title: '種目',
    back: '#/settings',
    tab: 'settings',
    html: `${group('💪 筋トレ', list.filter(e => e.type !== 'cardio'), 's')}
      ${group('🏃 有酸素', list.filter(e => e.type === 'cardio'), 'c')}
      <a class="btn btn-wide" href="#/exercise/new">＋ 種目を追加</a>`,
    after() {
      document.querySelectorAll('.sort-list').forEach(el => enableSortable(el, saveExerciseOrder));
    }
  };
}

// ドラッグで並べ替え（つまみを押したまま上下に動かす）。onDrop には並び終えた id の配列を渡す
function enableSortable(container, onDrop) {
  container.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('[data-sort-id]');
    e.preventDefault();
    const offset = e.clientY - row.getBoundingClientRect().top;
    let tr = 0;
    row.classList.add('dragging');
    const move = ev => {
      const natural = row.getBoundingClientRect().top - tr;
      tr = ev.clientY - offset - natural;
      row.style.transform = `translateY(${tr}px)`;
      const prev = row.previousElementSibling;
      const next = row.nextElementSibling;
      if (prev && ev.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) container.insertBefore(row, prev);
      else if (next && ev.clientY > next.getBoundingClientRect().top + next.offsetHeight / 2) container.insertBefore(next, row);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      row.style.transform = '';
      row.classList.remove('dragging');
      onDrop([...container.querySelectorAll('[data-sort-id]')].map(r => r.dataset.sortId));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

// 並べ替えの保存：筋トレのグループ → 有酸素のグループの順に、表示順を振り直す
async function saveExerciseOrder() {
  const ids = [...document.querySelectorAll('.sort-list[data-sort-group="s"] [data-sort-id], .sort-list[data-sort-group="c"] [data-sort-id]')].map(r => r.dataset.sortId);
  const rest = exercisesSorted().filter(e => !ids.includes(e.id)).map(e => e.id);
  const changed = [...ids, ...rest].map((id, k) => ({ e: store.get('exercises', id), order: (k + 1) * 10 }))
    .filter(x => x.e && x.e.sort_order !== x.order).map(x => ({ ...x.e, sort_order: x.order }));
  if (changed.length) await store.putMany('exercises', changed);
}

function viewExerciseEdit(id) {
  const ex = id === 'new' ? null : store.get('exercises', id);
  if (!state.draft || state.draft.kind !== 'exercise' || state.draft.id !== (ex ? ex.id : 'new')) {
    state.draft = ex
      ? { kind: 'exercise', id: ex.id, name: ex.name, type: ex.type, parts: calc.partsOf(ex), step: ex.step, initial_weight: ex.initial_weight, per_hand: ex.per_hand, active: ex.active }
      : { kind: 'exercise', id: 'new', name: '', type: 'strength', parts: [], step: 2.5, initial_weight: null, per_hand: false, active: true };
  }
  const d = state.draft;
  const sw = (key, label) => `<label class="switch-row"><span>${label}</span><span class="switch"><input type="checkbox" data-draft-check="${key}" ${d[key] ? 'checked' : ''}></span></label>`;
  return {
    title: ex ? '種目の編集' : '種目の追加',
    back: '#/exercises',
    tab: 'settings',
    html: `<section class="card form">
      <label class="field"><span>名前</span><input data-draft="name" data-text="1" maxlength="40" value="${esc(d.name)}"></label>
      <div class="field"><span>タイプ</span><div class="seg">${Object.entries(TYPE_LABEL).map(([k, v]) => `<button class="${d.type === k ? 'on' : ''}" data-act="draft-type" data-v="${k}">${v}</button>`).join('')}</div></div>
    </section>
    <section class="card form">
      <h2>部位 <small>最初にオンにしたのが主</small></h2>
      <div class="toggle-grid">${PARTS.map((p, i) => {
        const k = d.parts.indexOf(p);
        return `<button class="toggle-chip p-${i} ${k >= 0 ? 'on' : ''}" data-act="draft-part" data-v="${esc(p)}" aria-pressed="${k >= 0}">
          <span class="tc-dot">${k >= 0 ? '✓' : ''}</span>${esc(p)}${k === 0 ? '<em>主</em>' : ''}</button>`;
      }).join('')}</div>
    </section>
    <section class="card form">
      ${d.type !== 'cardio' ? `<label class="field"><span>±ボタンの幅（${d.type === 'bodyweight' ? '加重' : '重さ'}）</span><span class="field-in"><input data-draft="step" inputmode="decimal" value="${esc(v2s(d.step))}">kg</span></label>` : ''}
      ${d.type === 'strength' ? `<label class="field"><span>はじめの重さ</span><span class="field-in"><input data-draft="initial_weight" inputmode="decimal" value="${esc(v2s(d.initial_weight))}">kg</span></label>
        ${sw('per_hand', '片手の重さで記録（ダンベル）')}` : ''}
      ${sw('active', '一覧に出す')}
    </section>
    <button class="btn btn-primary btn-wide" data-act="ex-save">保存</button>
    ${ex ? '<button class="btn btn-danger btn-wide" data-act="ex-delete">削除</button>' : ''}`
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

// メニュー：筋トレと有酸素に分けて表示（1つ目の種目のタイプで分ける）
function tplKind(t) {
  const first = (t.items || [])[0];
  const ex = first && store.getAny('exercises', first.exercise_id);
  return ex && ex.type === 'cardio' ? 'c' : 's';
}

function viewTemplates() {
  const list = templates();
  const group = (title, xs) => `<section class="card list-card">
    <h2 class="list-title">${title}</h2>
    ${xs.map(t => `<a class="list-row" href="#/template/${esc(t.id)}"><span class="row-main"><b>${esc(t.name)}</b>
      <small>${(t.items || []).length}種目</small></span><span class="chev">›</span></a>`).join('') || '<p class="hint">まだありません</p>'}
  </section>`;
  return {
    title: 'メニュー',
    back: '#/settings',
    tab: 'settings',
    html: `${group('💪 筋トレ', list.filter(t => tplKind(t) === 's'))}
      ${group('🏃 有酸素', list.filter(t => tplKind(t) === 'c'))}
      <a class="btn btn-wide" href="#/template/new">＋ メニューを追加</a>
      <a class="link-wide" href="#/import">🤖 AI にメニューを作ってもらう</a>`
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

// ---------- プラン（頻度・有酸素・パラメータ） ----------

const C_TYPE_LABEL = { run: 'ランニング', swim: '水泳', both: '両方（水泳は週1）' };

function cardioText(cfg) {
  return cfg.c_on ? `週${cfg.c_freq}回（${C_TYPE_LABEL[cfg.c_type]}）` : 'なし';
}

// 今の分け方のメニューと、自動で出した目標（画面の目安表と、AI への依頼文で使う）
function splitRows(cfg, today) {
  const ids = [...new Set(plan.S_SPLITS[cfg.s_freq] || [])];
  return ids.map(id => store.get('templates', id)).filter(Boolean).map(tpl => ({
    name: tpl.name,
    items: (tpl.items || []).map(it => {
      const ex = store.get('exercises', it.exercise_id);
      if (!ex) return null;
      const t = target.targetFor(ex, it, today, cfg);
      return { name: ex.name, type: ex.type, sets: t.sets, reps: t.reps, weight: t.weight, per_hand: ex.per_hand, reason: t.reason, text: target.targetText(ex, t) };
    }).filter(Boolean)
  }));
}

function viewPlan() {
  const today = todayJst();
  if (!state.draft || state.draft.kind !== 'plan') {
    const cfg = plan.planConfig();
    if (cfg.body_weight == null) {
      const w = calc.lastCondition('weight', addDays(today, 1));
      if (w) cfg.body_weight = round(w.weight, 1);
    }
    state.draft = { kind: 'plan', cfg };
  }
  const cfg = state.draft.cfg;
  const pt = plan.patternFromConfig(cfg);
  const seg = (k, vals, label = v => v) => `<div class="seg">${vals.map(v => `<button class="${String(cfg[k]) === String(v) ? 'on' : ''}" data-act="cfg-set" data-k="${k}" data-v="${v}">${esc(label(v))}</button>`).join('')}</div>`;
  const dayLine = (days, wd) => {
    const n = l => (days[wd][l] && store.get('templates', days[wd][l]) ? shortName(store.get('templates', days[wd][l])) : '');
    const parts = [n('s'), n('c')].filter(Boolean);
    return `<div class="week-row"><b>${WEEKDAYS[wd]}</b><span>${parts.length ? esc(parts.join('・')) : '<span class="hint">休み</span>'}</span></div>`;
  };
  const order = [1, 2, 3, 4, 5, 6, 0];
  const rows = splitRows(cfg, today);
  const num = (k, label, unit, ph = '') => `<label class="field"><span>${label}</span><span class="field-in"><input data-plan-num="${k}" inputmode="decimal" value="${esc(cfg[k] == null ? '' : cfg[k])}" placeholder="${esc(ph)}">${unit}</span></label>`;
  const fold = (key, title, body, open = false) => `<details class="card fold" data-fold="${key}" ${state.open[key] ?? open ? 'open' : ''}><summary><b>${title}</b></summary>${body}</details>`;
  return {
    title: 'プラン',
    back: '#/settings',
    tab: 'settings',
    html: `<section class="card form">
      <h2>💪 筋トレ</h2>
      ${seg('s_freq', [2, 3, 4, 5, 6], v => `週${v}`)}
      <p class="hint">${esc((plan.S_SPLITS[cfg.s_freq] || []).map(id => (store.get('templates', id) || {}).name).filter(Boolean).join(' → '))}</p>
    </section>
    <section class="card form">
      <div class="card-head"><h2>🏃 有酸素</h2>
        <label class="switch"><input type="checkbox" data-plan-check="c_on" ${cfg.c_on ? 'checked' : ''}></label></div>
      ${cfg.c_on ? `<div class="nested">
        <div class="field"><span>種類</span>${seg('c_type', ['run', 'swim', 'both'], v => ({ run: '🏃 ラン', swim: '🏊 水泳', both: '両方' })[v])}</div>
        <div class="field"><span>回数</span>${seg('c_freq', [2, 3, 4, 5, 6], v => `週${v}`)}</div>
        ${cfg.c_type === 'swim' && cfg.c_freq > 2 ? '<p class="hint">🚿 水泳は週1〜2回までがおすすめ</p>' : ''}
        ${cfg.c_type !== 'swim' ? `<details class="mini-fold" data-fold="intro" ${state.open.intro ? 'open' : ''}><summary>はじめの期間（ランを導入に）${cfg.intro_until ? `<em>${esc(fmtShort(cfg.intro_until))}まで</em>` : ''}</summary>
          <label class="switch-row"><span>はじめの期間を使う</span><span class="switch"><input type="checkbox" data-plan-check="intro" ${cfg.intro_until ? 'checked' : ''}></span></label>
          ${cfg.intro_until ? `<label class="field"><span>この日まで</span><input type="date" data-plan-date="intro_until" value="${esc(cfg.intro_until)}"></label>` : ''}
        </details>` : ''}
      </div>` : ''}
    </section>
    <section class="card">
      <h2>1週間のレール</h2>
      ${pt.intro ? `<h3>${esc(fmtShort(cfg.intro_until))}まで</h3>${order.map(wd => dayLine(pt.intro, wd)).join('')}<h3>そのあと</h3>` : ''}
      ${order.map(wd => dayLine(pt.main, wd)).join('')}
    </section>
    ${fold('params', '目標の計算に使う値', `${num('body_weight', '体重', 'kg')}
      ${num('bench_max', 'ベンチプレスの最大', 'kg', '例 45')}
      ${num('squat_max', 'スクワットの最大', 'kg', '空欄でOK')}
      ${num('pullup_max', '懸垂の最大回数', '回', '例 4')}`)}
    ${fold('targets', '今日の時点の目標', rows.map(r => `<h3>${esc(r.name)}</h3>${r.items.map(it => `<div class="target-row"><span>${esc(it.name)}</span><span>${esc(it.text)}</span></div>`).join('')}`).join(''))}
    <button class="btn btn-primary btn-wide" data-act="plan-apply">この内容でレールを作り直す</button>
    ${fold('ai', '🤖 AI に確認する', `<p class="hint">目標の重さが心配なときに。依頼文をコピーして AI に貼り、答えを取り込みます。</p>
      <button class="btn btn-wide" data-act="plan-ai">依頼文をコピー</button>
      <a class="btn btn-wide" href="#/import">答えを取り込む</a>`)}
    ${fold('advanced', 'くわしい設定', '<a class="list-row" href="#/schedule"><span class="row-main"><b>曜日割りを手で調整</b></span><span class="chev">›</span></a>')}`
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
        ${it.type === 'cardio' ? `${it.duration_min ? ` ${fmtNum(it.duration_min)}分` : ''}${it.distance_km ? ` ${fmtNum(it.distance_km, 2)}km` : ''}` : ` ${it.weight != null ? `${fmtNum(it.weight, 2)}kg × ` : ''}${it.reps ? `${it.reps}回 × ` : ''}${it.sets}セット`}
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
    title: t ? 'メニューの編集' : 'メニューの追加',
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
  plan: viewPlan,
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
    case 'card-done': await cardDone(d.ex); break;
    case 'card-undo': {
      const ex = calc.exercise(d.ex);
      const n = calc.exerciseLogs(d.ex).filter(l => l.date === todayJst()).length;
      if (!ex || !n) return;
      openModal(`<div class="sheet">
        <div class="sheet-emoji">↩️</div>
        <h2>「${esc(ex.name)}」を未完了に戻す？</h2>
        <p>今日の記録（${n}${ex.type === 'cardio' ? '件' : 'セット'}）を消して、もう一度できるようにします。</p>
        <div class="sheet-actions">
          <button class="btn btn-primary" data-act="card-undo-ok" data-ex="${esc(d.ex)}">未完了に戻す</button>
          <button class="btn" data-act="modal-close">そのままにする</button>
        </div>
      </div>`);
      break;
    }
    case 'card-undo-ok': {
      closeModal();
      const ls = calc.exerciseLogs(d.ex).filter(l => l.date === todayJst());
      for (const l of ls) await store.remove('logs', l.id);
      render();
      toast('未完了に戻しました');
      break;
    }
    case 'step-toggle': {
      const st = stepState(todayJst());
      const list = st.map[d.ex] || [];
      const i = Number(d.i);
      st.map[d.ex] = list.includes(i) ? list.filter(x => x !== i) : [...list, i];
      save('wo.steps', st);
      const on = st.map[d.ex].includes(i);
      el.classList.toggle('done', on);
      el.setAttribute('aria-pressed', String(on));
      el.querySelector('.step-no').textContent = on ? '✓' : String(i + 1);
      break;
    }
    case 'cfg-set': {
      const c = state.draft.cfg;
      c[d.k] = /^\d+$/.test(d.v) ? Number(d.v) : d.v;
      render();
      break;
    }
    case 'plan-apply': {
      if (!confirm('今日以降のまだの予定を、このプランで作り直します。よろしいですか？')) return;
      await plan.applyConfig(state.draft.cfg, todayJst());
      state.draft = null;
      location.hash = '#/home';
      toast('レールを作り直しました');
      break;
    }
    case 'plan-ai': {
      const cfg = state.draft.cfg;
      const text = menuio.buildStrengthPrompt(cfg, splitRows(cfg, todayJst()), cardioText(cfg));
      try {
        await navigator.clipboard.writeText(text);
        toast('依頼文をコピーしました。AI に貼り付けて、答えは「取り込み」へ');
      } catch (err) {
        openModal(`<h2>AI への依頼文</h2><p class="hint">自動でコピーできませんでした。下の文を長押しで全部選んでコピーしてください。</p>
          <textarea rows="14" readonly>${esc(text)}</textarea><div class="modal-actions"><button class="btn" data-act="modal-close">閉じる</button></div>`);
      }
      break;
    }
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
      const to = plan.postponeTarget(d.date, lane);
      const isToday = d.date === todayJst();
      openModal(`<div class="sheet">
        <div class="sheet-emoji">${isToday ? '🌙' : '🗓️'}</div>
        <h2>${isToday ? '今日はお休みにしよう' : '予定をうしろへ'}</h2>
        <p>「${esc(name)}」は<br><b>${to ? esc(fmtDate(to)) : '次のレールの日'}</b> にお引っ越し。<br>その先の予定も、1つずつうしろにずれます。</p>
        ${isToday ? '<p class="sheet-soft">休むのも、続けるための大事な一歩 🌱</p>' : ''}
        <div class="sheet-actions">
          <button class="btn btn-primary" data-act="plan-postpone-ok" data-date="${d.date}" data-lane="${lane}">ずらす</button>
          <button class="btn" data-act="modal-close">${isToday ? 'やっぱりやる 💪' : 'やめておく'}</button>
        </div>
      </div>`);
      break;
    }
    case 'plan-postpone-ok': {
      closeModal();
      const n = await plan.postpone(d.date, d.lane || 's', todayJst());
      await plan.ensure(todayJst());
      render();
      toast(n ? 'ずらしました。またね 👋' : 'ずらせる予定がありませんでした');
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
  } else if (ds.exActive !== undefined) {
    if (e.type !== 'change') return;
    const ex = store.get('exercises', ds.exActive);
    if (ex) store.put('exercises', { ...ex, active: el.checked }).then(() => el.closest('.sort-row').classList.toggle('off', !el.checked));
  } else if (ds.planNum !== undefined) {
    state.draft.cfg[ds.planNum] = parseNum(el.value);
    if (e.type === 'change') render();
  } else if (ds.planCheck !== undefined) {
    if (e.type !== 'change') return;
    const c = state.draft.cfg;
    if (ds.planCheck === 'intro') c.intro_until = el.checked ? addDays(todayJst(), 13) : null;
    else c[ds.planCheck] = el.checked;
    render();
  } else if (ds.planDate !== undefined) {
    state.draft.cfg[ds.planDate] = el.value || null;
    if (e.type === 'change') render();
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

// できなかった予定を自動でずらしたあとの、ひとこと
function maybeWelcomeBack() {
  if (!state.welcome) return;
  state.welcome = false;
  openModal(`<div class="sheet">
    <div class="sheet-emoji">🌱</div>
    <h2>おかえりなさい</h2>
    <p>できなかった分は、今日から先に<br>ずらしておきました。<br>レールはそのまま続きます。</p>
    <div class="sheet-actions"><button class="btn btn-primary" data-act="modal-close">今日もやろう</button></div>
  </div>`);
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
