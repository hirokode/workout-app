// ワークアウト記録 API の入口。
// 画面（GitHub Pages）から fetch の POST で {action, passcode, ...} が届く。
// 返り値は {ok:true, data} または {ok:false, error, message}。

// 関数の表は呼ばれたときに作る（GAS はファイルを順番に読むので、他のファイルの関数を一番外側で参照しないため）
function actions_() {
  return {
    ping: apiPing_,
    sync: apiSync_
  };
}

// 動作確認用。ブラウザで /exec を開くと {ok:true} が返る（データは返さない）
function doGet() {
  return json_({ ok: true, app: 'workout-app' });
}

function doPost(e) {
  let res;
  try {
    if (!e || !e.postData || !e.postData.contents) throw apiError_('bad_request', 'リクエストが空です');
    const req = JSON.parse(e.postData.contents);
    checkPasscode_(req.passcode);
    const actions = actions_();
    const fn = Object.prototype.hasOwnProperty.call(actions, req.action) ? actions[req.action] : null;
    if (!fn) throw apiError_('bad_action', '不明な操作です');
    res = { ok: true, data: fn(req) };
  } catch (err) {
    if (err && err.apiCode) {
      res = { ok: false, error: err.apiCode, message: err.message };
    } else {
      console.error(err && err.stack ? err.stack : err);
      res = { ok: false, error: 'server', message: 'サーバーでエラーが起きました（' + (err && err.message ? err.message : err) + '）' };
    }
  }
  return json_(res);
}

// Apps Script エディタで1回だけ ▶実行する関数。
// 権限の承認ダイアログを出すのと、スプレッドシートの作成を兼ねる。
// （実行しなくても、最初の同期で自動作成される）
function setup() {
  const ss = getSs_();
  Object.keys(SCHEMA).forEach(function (name) { sheet_(name); });
  Logger.log('準備ができました。データのスプレッドシート：' + ss.getUrl());
  if (!props_().getProperty(PASSCODE_KEY)) {
    Logger.log('まだ合言葉が設定されていません。「プロジェクトの設定」→「スクリプト プロパティ」に ' + PASSCODE_KEY + ' を追加してください');
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, message) {
  const err = new Error(message);
  err.apiCode = code;
  return err;
}
