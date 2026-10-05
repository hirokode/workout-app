// GAS との同期。記録は端末に先に保存してあるので、ここは裏で動くだけ（画面の操作は止めない）。
// - 変更があれば少し待ってからまとめて送る
// - 電波が無い・失敗したときは未同期のまま残し、オンラインに戻ったときや画面を開いたときに再送する
// - GAS の URL と合言葉は端末にだけ保存する（このアプリは健康情報を扱うので、リポジトリに URL を置かない）

import * as store from './store.js';
import { load, store as save } from './util.js';

const KEY_URL = 'wo.apiUrl';
const KEY_PASS = 'wo.passcode';
const TIMEOUT = 30000;
const RETRY_MS = 60000;

let timer = null;
let running = null;
let lastError = null; // { code, message }
let state = 'idle';   // idle | syncing
const listeners = new Set();

export function getConfig() {
  return { url: load(KEY_URL, ''), passcode: load(KEY_PASS, '') };
}

export function setConfig(url, passcode) {
  save(KEY_URL, url.trim());
  save(KEY_PASS, passcode);
  lastError = null;
  emit();
}

export function isConfigured() {
  const c = getConfig();
  return !!(c.url && c.passcode);
}

// 画面上部に出す状態
// kind: local（未設定・端末だけ）／offline／syncing／pending／synced／error
export function status() {
  const n = store.pendingCount();
  if (!isConfigured()) return { kind: 'local', text: '端末のみ', pending: n };
  if (state === 'syncing') return { kind: 'syncing', text: '同期中…', pending: n };
  if (navigator.onLine === false) return { kind: 'offline', text: n ? `オフライン・未同期${n}件` : 'オフライン', pending: n };
  if (lastError) return { kind: 'error', text: n ? `未同期${n}件` : '同期エラー', pending: n, message: lastError.message, code: lastError.code };
  if (n) return { kind: 'pending', text: `未同期${n}件`, pending: n };
  return { kind: 'synced', text: '同期済み', pending: 0 };
}

export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const s = status();
  listeners.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } });
}

// GAS を呼ぶ。Content-Type を付けない（text/plain になり、CORS の事前確認が起きない）
export async function call(action, params = {}, cfg = getConfig()) {
  if (!cfg.url) throw syncError('config', 'GAS の URL が設定されていません');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      body: JSON.stringify({ action, passcode: cfg.passcode, ...params }),
      signal: ctrl.signal
    });
  } catch (e) {
    throw syncError('network', navigator.onLine === false ? '電波がありません' : '通信に失敗しました（URL が正しいか、電波を確認してください）');
  } finally {
    clearTimeout(t);
  }
  let json;
  try {
    json = await res.json();
  } catch (e) {
    throw syncError('server', 'サーバーの応答が読めませんでした（URL・GAS のデプロイ・アクセス権「全員」を確認してください）');
  }
  if (!json.ok) throw syncError(json.error, json.message);
  return json.data;
}

function syncError(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// 少し待ってから同期する（続けて記録したときに1回にまとめるため）
export function schedule(delay = 1500) {
  emit();
  if (!isConfigured()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}

export function syncNow() {
  if (running) return running;
  running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  clearTimeout(timer);
  if (!isConfigured() || navigator.onLine === false) { emit(); return; }
  // 合言葉の間違いは、設定を直すまで繰り返さない
  if (lastError && (lastError.code === 'auth' || lastError.code === 'no_passcode') && lastError.manualOnly) { emit(); return; }
  state = 'syncing';
  emit();
  try {
    // 未同期が多いときは何回かに分けて送る
    for (let i = 0; i < 20; i++) {
      const { changes, sent } = store.takeOutbox(1000);
      const data = await call('sync', { since: store.getSince(), changes });
      await store.applyServer(data.rows, sent, data.now);
      if (!store.pendingCount()) break;
    }
    lastError = null;
  } catch (e) {
    lastError = { code: e.code || 'error', message: e.message, manualOnly: e.code === 'auth' || e.code === 'no_passcode' };
    if (!lastError.manualOnly) {
      clearTimeout(timer);
      timer = setTimeout(() => { syncNow(); }, RETRY_MS);
    }
  } finally {
    state = 'idle';
    emit();
  }
}

// 設定画面の「保存して接続テスト」用。合言葉が合っていれば同期も始める
export async function testAndSave(url, passcode) {
  await call('ping', {}, { url: url.trim(), passcode });
  setConfig(url, passcode);
  return syncNow();
}

export function start() {
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => emit());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  store.onChange(source => { if (source === 'local') schedule(); });
  // 未同期が残っているときの見回り
  setInterval(() => { if (store.pendingCount() && !running) syncNow(); }, RETRY_MS);
  syncNow();
}
