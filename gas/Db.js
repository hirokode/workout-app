// スプレッドシートの準備・読み書き。
// スプシは初回に自動で作り、IDをスクリプトプロパティ（SPREADSHEET_ID）に保存する。

// 列を増やすときは、ここの末尾に足す（既存の列の順番は変えない）。
// 既存シートの見出し行には、ensureSheet_ が足りない列を末尾に自動で追加する。
// 画面側の js/store.js の FIELDS も同じ列名にそろえる。
const SCHEMA = {
  exercises: ['id', 'name', 'type', 'parts', 'step', 'initial_weight', 'per_hand', 'sort_order', 'active',
    'created_at', 'updated_at', 'deleted', 'synced_at'],
  logs: ['id', 'date', 'exercise_id', 'kind', 'set_no', 'weight', 'reps', 'added_weight', 'duration_min', 'distance_km',
    'calories', 'memo', 'created_at', 'updated_at', 'deleted', 'synced_at'],
  templates: ['id', 'name', 'items', 'weekday', 'sort_order', 'created_at', 'updated_at', 'deleted', 'synced_at'],
  conditions: ['id', 'date', 'am_sys', 'am_dia', 'pm_sys', 'pm_dia', 'weight', 'memo', 'field_times',
    'created_at', 'updated_at', 'deleted', 'synced_at'],
  settings: ['id', 'value', 'updated_at', 'deleted', 'synced_at']
};
const SPREADSHEET_NAME = 'ワークアウト記録 データ';
const PASSCODE_KEY = 'WORKOUT_PASSCODE';

let lockDepth_ = 0;
let ss_ = null;
const sheets_ = {};

function props_() {
  return PropertiesService.getScriptProperties();
}

function checkPasscode_(passcode) {
  const expected = props_().getProperty(PASSCODE_KEY);
  if (!expected) throw apiError_('no_passcode', 'サーバー側で合言葉が設定されていません（スクリプト プロパティ ' + PASSCODE_KEY + '）');
  if (String(passcode || '') !== expected) throw apiError_('auth', '合言葉が違います');
}

// 書き込みは1件ずつ順番に処理する（同時に書いて行が壊れないように）
function withLock_(fn) {
  if (lockDepth_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw apiError_('busy', '混み合っています。少し待ってからもう一度試してください');
  lockDepth_++;
  try {
    return fn();
  } finally {
    lockDepth_--;
    lock.releaseLock();
  }
}

// ID が保存済みなのに開けないときは、新しく作らずにエラーにする（データを見失わないため）
function getSs_() {
  if (ss_) return ss_;
  const id = props_().getProperty('SPREADSHEET_ID');
  if (id) {
    ss_ = SpreadsheetApp.openById(id);
    return ss_;
  }
  return withLock_(function () {
    const id2 = props_().getProperty('SPREADSHEET_ID');
    if (id2) {
      ss_ = SpreadsheetApp.openById(id2);
      return ss_;
    }
    const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    Object.keys(SCHEMA).forEach(function (name) { ensureSheet_(ss, name); });
    ss.getSheets().forEach(function (sh) {
      if (!SCHEMA[sh.getName()]) ss.deleteSheet(sh);
    });
    props_().setProperty('SPREADSHEET_ID', ss.getId());
    ss_ = ss;
    return ss;
  });
}

// シートが無ければ作り、見出し行に足りない列があれば末尾に足す。
// 列全体を「書式なしテキスト」にする（日付や数値が勝手に変換されないように）
function ensureSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.setFrozenRows(1);
  }
  const cols = SCHEMA[name];
  const lastCol = sh.getLastColumn();
  const header = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  const missing = cols.filter(function (c) { return header.indexOf(c) < 0; });
  if (missing.length) {
    const start = header.filter(String).length + 1;
    sh.getRange(1, start, 1, missing.length).setValues([missing]);
    sh.getRange(1, start, sh.getMaxRows(), missing.length).setNumberFormat('@');
  }
  return sh;
}

function sheet_(name) {
  if (!sheets_[name]) sheets_[name] = ensureSheet_(getSs_(), name);
  return sheets_[name];
}

function header_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
}

// シートの全行をオブジェクトの配列で返す。_row はシート上の行番号
function readRows_(name) {
  const sh = sheet_(name);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const values = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getDisplayValues();
  const header = values[0];
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = { _row: i + 1 };
    header.forEach(function (h, j) { if (h) obj[h] = values[i][j]; });
    rows.push(obj);
  }
  return rows;
}

// 「=」で始まる文字は、書式がテキストでも数式として計算されてしまうので、先頭に ' を付けて文字として保存する
// （' はセルの中身には残らず、読み出すときは元の文字に戻る）
function toValues_(header, obj) {
  return header.map(function (h) {
    const v = obj[h];
    const s = v === undefined || v === null ? '' : String(v);
    return s.charAt(0) === '=' ? "'" + s : s;
  });
}

// 新しい行をまとめて末尾に書く（1行ずつ書くと遅いため）
function appendRows_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const header = header_(sh);
  const start = sh.getLastRow() + 1;
  const range = sh.getRange(start, 1, objs.length, header.length);
  range.setNumberFormat('@').setValues(objs.map(function (o) { return toValues_(header, o); }));
  objs.forEach(function (o, i) { o._row = start + i; });
}

function updateRow_(name, rowNum, obj) {
  const sh = sheet_(name);
  const header = header_(sh);
  const range = sh.getRange(rowNum, 1, 1, header.length);
  range.setNumberFormat('@').setValues([toValues_(header, obj)]);
}

// 日時は JST の「2026-10-05T08:30:00.000+09:00」の形の文字列にそろえる（文字列のまま大小比較できる）
function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
}
