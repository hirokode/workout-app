# workout-app（ワークアウト記録）

筋トレ・有酸素・懸垂・体調（血圧・体重）を記録する、自分用のスマホアプリ（PWA）。
電波が無くても記録でき、つながったときに Google スプレッドシートへ自動で同期する。

- アプリ：https://hirokode.github.io/workout-app/ （GitHub Pages を有効にした後）
- 開発のルール・しくみ：`AGENTS.md`

---

## はじめてのセットアップ（1回だけ・PCで行う）

上から順にやれば終わります。コマンドは PowerShell 用です。

### 1. コードを main に入れる

GitHub のリポジトリ `hirokode/workout-app` の Pull Request（`claude/initial-app` ブランチ）をマージします。

> マージ直後に GitHub の「Actions」タブで「GASにデプロイ」が**赤（失敗）になりますが、正常です**（手順5の Secrets をまだ登録していないため）。手順6でやり直します。

### 2. PC にコードを取ってくる

```bash
cd "C:\Users\hiro2\dev\apps"; if (Test-Path workout-app) { cd workout-app; git checkout main; git pull } else { git clone https://github.com/hirokode/workout-app.git; cd workout-app }
```

（ここで一度、PCのブラウザでも動くか見ておくと安心です → 下の「PCで画面だけ確認する」）

### 3. Apps Script のプロジェクトを作って、コードを置く

```bash
cd "C:\Users\hiro2\dev\apps\workout-app\gas"; clasp create --type standalone --title "workout-app" --rootDir .
```

`clasp create` は `appsscript.json` を初期状態で上書きしてしまうので、リポジトリの内容に戻してからアップロードします。

```bash
cd "C:\Users\hiro2\dev\apps\workout-app\gas"; git checkout -- appsscript.json; clasp push -f
```

`git status` で `.clasp.json` が一覧に**出てこない**こと（.gitignore 済み）を確認してください。

### 4. 承認・合言葉・最初のデプロイ（ブラウザ）

1. `clasp open`（下のコマンド）で Apps Script のエディタを開く
   ```bash
   cd "C:\Users\hiro2\dev\apps\workout-app\gas"; clasp open
   ```
2. 左の「ファイル」で **Code.gs** を開き、上の関数の選択欄で **setup** を選んで「▶ 実行」
3. 「承認が必要です」→「権限を確認」→ 自分のアカウント →「このアプリは Google で確認されていません」→「詳細」→「workout-app（安全ではないページ）に移動」→「許可」
4. 下の「実行ログ」に「準備ができました。データのスプレッドシート：https://…」と出れば成功（Google ドライブに「ワークアウト記録 データ」ができています）
5. 左の **歯車（プロジェクトの設定）** →いちばん下の「スクリプト プロパティ」→「スクリプト プロパティを追加」
   - プロパティ：`WORKOUT_PASSCODE`（この綴りのまま）
   - 値：好きな合言葉（アプリに入れるもの。メモしておく）
   - 「スクリプト プロパティを保存」
6. 右上の **「デプロイ」→「新しいデプロイ」**
   - 「種類の選択」の歯車 →「ウェブアプリ」
   - 説明：`本番`
   - 次のユーザーとして実行：**自分**
   - アクセスできるユーザー：**全員**（「Google アカウントを持つ全員」ではない方）
   - 「デプロイ」
7. 表示された **ウェブアプリの URL**（`https://script.google.com/macros/s/…/exec`）をコピーし、`C:\Users\hiro2\dev\apps\workout-app\アプリURL.txt` に貼って保存（.gitignore 済み）。`/s/` と `/exec` に挟まれた部分が **デプロイID**
8. 確認：その URL をブラウザで開くと `{"ok":true,"app":"workout-app"}` と出る

**以後、「新しいデプロイ」は作らないでください**（URL が変わってしまいます）。更新は GitHub Actions が同じ URL のまま行います。

### 5. GitHub Secrets を登録する（自動デプロイ用）

前提：https://script.google.com/home/usersettings で「Google Apps Script API」がオンになっていること。

```bash
cd "C:\Users\hiro2\dev\apps\workout-app"; cmd /c "gh secret set CLASPRC_JSON < %USERPROFILE%\.clasprc.json"; gh secret set GAS_SCRIPT_ID --body (Get-Content gas\.clasp.json -Raw | ConvertFrom-Json).scriptId
```

デプロイIDは、次を実行して出てくる入力欄に貼り付けます（`アプリURL.txt` から）。

```bash
cd "C:\Users\hiro2\dev\apps\workout-app"; gh secret set GAS_DEPLOYMENT_ID
```

確認（名前だけ出ます）：`CLASPRC_JSON`・`GAS_SCRIPT_ID`・`GAS_DEPLOYMENT_ID` の3つが出れば完了。

```bash
cd "C:\Users\hiro2\dev\apps\workout-app"; gh secret list
```

### 6. 自動デプロイが動くか確認する

GitHub の `hirokode/workout-app` →「Actions」→ 左の「GASにデプロイ」→ 右の「Run workflow」→「Run workflow」。
しばらくして **緑のチェック** になれば成功です。

### 7. GitHub Pages を有効にする

GitHub の `hirokode/workout-app` →「Settings」→ 左の「Pages」→
「Source」を **Deploy from a branch**、「Branch」を **main** と **/ (root)** にして「Save」。
1〜2分後に https://hirokode.github.io/workout-app/ が開けるようになります。

### 8. iPhone のホーム画面に追加して、つなぐ

**順番が大事です**：iPhone ではホーム画面のアプリと Safari は保存場所が別なので、**ホーム画面に追加してから**設定します。

1. Safari で https://hirokode.github.io/workout-app/ を開く
2. 共有ボタン（□に↑）→「ホーム画面に追加」→「追加」
3. ホーム画面の「ワークアウト」アイコンから起動（アドレスバーが出ないこと）
4. 下の「設定」タブ →「GAS の URL」に手順4-7の URL、「合言葉」に手順4-5の合言葉 →「保存して接続テスト」
5. 「つながりました」と出て、右上の小さな表示が **「同期済み」** になれば完了
6. スプレッドシート「ワークアウト記録 データ」の `exercises` シートに19種目が入っていることを確認

---

## 動作確認のしかた

| 確認すること | やること | 成功の目印 |
|---|---|---|
| 記録できる | ホームで「上半身A を始める」（月曜以外は「上半身A」のボタン）→ ベンチプレス →「記録する」を3回 | 「メニュー 3/4 セット」と出る。ホームの「セット」が 3 |
| 前回の値を流用 | 次の日に同じ種目を開く | 「前回 ○/○」の下に前回のセットが並び、タップするとその値が入る |
| オフライン | 機内モードにして記録 → アプリを閉じる → 機内モード解除 → アプリを開く | 機内モード中は右上が「オフライン・未同期n件」。解除後に「同期済み」になり、スプシの `logs` に重複なく入っている |
| 取り消し | 記録した直後の黒いお知らせの「取り消す」 | 今日のセットから消える |
| 懸垂カウンター | ホームの「懸垂 +2」 | 今日の回数が2増える。「−取り消す」で戻る。履歴のカレンダーの色は付かない |
| 体調 | 体調タブで朝の血圧を入れて「保存」→ 夜の分も入れて「保存」 | 両方「✓ 保存済み」。朝の値は消えない。グラフに点と線・点線（135/85）が出る |
| 書き出し | 体調タブの「直近2週間（画像）」 | 共有シートが開く（写真に保存・AirDrop などができる） |
| 更新の反映 | 設定タブの一番下 | 「バージョン」が最新の番号になっている |

### PCで画面だけ確認する

GAS につながなくても、端末（ブラウザ）だけに保存して全機能が動きます（右上が「端末のみ」）。

```bash
cd "C:\Users\hiro2\dev\apps\workout-app"; python -m http.server 8124
```

ブラウザで http://localhost:8124/ を開きます（止めるときはターミナルで Ctrl + C）。
python が無い場合は `npx http-server -p 8124 -c-1` でも同じです。

---

## つまずきやすい点

| 症状 | よくある原因 | 直し方 |
|---|---|---|
| 「つながりませんでした：サーバーの応答が読めませんでした」 | デプロイの「アクセスできるユーザー」が「全員」になっていない／URL が `/dev` で終わっている／承認していない | 手順4の 3・6 を確認。URL は `/exec` で終わるもの |
| 「合言葉が違います」 | アプリに入れた合言葉と `WORKOUT_PASSCODE` の値が違う（前後の空白も含む） | エディタの「プロジェクトの設定」→「スクリプト プロパティ」で値を確認 |
| 「サーバー側で合言葉が設定されていません」 | スクリプトプロパティの名前の綴り違い | 名前を `WORKOUT_PASSCODE` にする |
| 直したのに画面が古いまま | 古い画面が端末に残っている | ホーム画面のアプリを完全に閉じて（上にスワイプ）開き直す。設定タブのバージョン番号で確認 |
| Actions の「GASにデプロイ」が赤 | Secrets が未登録／clasp の認証切れ | 手順5をやり直す。認証切れなら PC で `clasp login` してから `CLASPRC_JSON` を登録し直す |
| 設定タブに「保存先：一時的」と出る | Safari のプライベートブラウズ | 通常モードで開く／ホーム画面のアプリから使う |
| iPhone を替えた・Safari のデータを消した | 端末のデータが消える | 設定タブで URL と合言葉を入れ直せば、スプシから全部戻る（**未同期の記録は戻らない**ので、右上が「同期済み」であることをときどき確認） |

**注意**：GAS の URL・合言葉・書き出した CSV／画像は、GitHub（公開リポジトリ）に入れないでください（`.gitignore` 済みですが、コミット前に `git status` で確認）。

## 困ったときに持ってきてほしい情報

1. アプリの **設定タブのスクリーンショット**（同期の状態の文言とバージョン番号が写るように）
2. 右上の小さな表示の文言（「同期エラー」など）
3. Actions が赤のとき：その実行を開いて、赤い ✕ の付いた手順のログの最後の10行
4. GAS 側が怪しいとき：Apps Script エディタの左の「実行数」で、失敗（赤）になっている行を開いたエラー文
