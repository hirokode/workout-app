// 小さな道具（日付・数値・文字の表示）。
// 日付は JST の「YYYY-MM-DD」の文字列で扱う。Date オブジェクトは画面とサーバーの間で受け渡さない。

const JST_MS = 9 * 60 * 60 * 1000;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 今日（JST）
export function todayJst() {
  return new Date(Date.now() + JST_MS).toISOString().slice(0, 10);
}

// 今の日時（JST）。「2026-10-05T08:30:00.000+09:00」の形（文字列のまま大小比較できる）
export function nowIso() {
  return new Date(Date.now() + JST_MS).toISOString().replace('Z', '+09:00');
}

export function addDays(date, n) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 0=日曜 … 6=土曜
export function weekday(date) {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

// その週の月曜日
export function weekStart(date) {
  return addDays(date, -((weekday(date) + 6) % 7));
}

export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

export function fmtDate(date) {
  if (!date) return '';
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}（${WEEKDAYS[weekday(date)]}）`;
}

export function fmtShort(date) {
  if (!date) return '';
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 数値の表示。小数は必要なときだけ出す（60 → "60"、62.5 → "62.5"）
export function fmtNum(n, digits = 1) {
  if (n === null || n === undefined || n === '' || !isFinite(n)) return '';
  const p = Math.pow(10, digits);
  return String(Math.round(Number(n) * p) / p);
}

// 1234567 → "1,234,567"
export function fmtInt(n) {
  return Math.round(Number(n) || 0).toLocaleString('ja-JP');
}

// 入力欄の文字を数値に。空なら null
export function parseNum(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/,/g, '');
  if (t === '') return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

export function round(n, digits = 2) {
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// localStorage（プライベートブラウズなどで使えないこともあるので、失敗しても止まらないようにする）
export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}

export function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 保存できなくても動作は続ける
  }
}
