// 初期データ（種目マスタと週テンプレート）。
// 端末で最初に起動したときに作り、最初の同期でスプレッドシートに入る。
// ID と日時を固定にしているので、別の端末で作っても重複しない（同じ行として扱われる）。

export const SEED_TS = '2026-01-01T00:00:00.000+09:00';
// 初期データの版。足したら上げる（端末にまだ無い ID の分だけ追加される）
export const SEED_VERSION = 4;

export const PARTS = ['胸', '背中', '肩', '腕', '脚', '体幹', '有酸素'];

// [id, 名前, タイプ, 部位（先頭が主部位）, 増減幅, 初期重量, 片手の重さで記録するか]
// 有酸素の増減幅は距離（km）の±ボタンに使う
const EXERCISES = [
  ['ex-bench', 'ベンチプレス', 'strength', '胸', 2.5, 25, false],
  ['ex-narrow-bench', 'ナローベンチプレス', 'strength', '胸,腕', 2.5, 20, false],
  ['ex-incline-db', 'インクラインダンベルプレス', 'strength', '胸', 1, 10, true],
  ['ex-latpull', 'ラットプルダウン', 'strength', '背中', 2.5, 26, false],
  ['ex-onearm-row', 'ワンハンドロー', 'strength', '背中', 1, 10, true],
  ['ex-pullup', '懸垂', 'bodyweight', '背中', 1, '', false],
  ['ex-negative-pullup', 'ネガティブ懸垂', 'bodyweight', '背中', 1, '', false],
  ['ex-db-shoulder', 'ダンベルショルダープレス', 'strength', '肩', 1, 6, true],
  ['ex-side-raise', 'サイドレイズ', 'strength', '肩', 1, 4, true],
  ['ex-dips', 'ディップス／腕立て伏せ', 'bodyweight', '胸,腕', 1, '', false],
  ['ex-squat', 'スクワット', 'strength', '脚', 2.5, 35, false],
  ['ex-rdl', 'ルーマニアンデッドリフト', 'strength', '脚,背中', 2.5, 30, false],
  ['ex-leg-press', 'レッグプレス', 'strength', '脚', 2.5, 60, false],
  ['ex-calf-raise', 'カーフレイズ', 'bodyweight', '脚', 1, '', false],
  ['ex-leg-raise', 'レッグレイズ', 'bodyweight', '体幹', 1, '', false],
  ['ex-ab-roller', 'アブローラー', 'bodyweight', '体幹', 1, '', false],
  ['ex-running', 'ランニング', 'cardio', '有酸素', '', '', false],
  ['ex-bike', '自転車', 'cardio', '有酸素', '', '', false],
  ['ex-walk', '早歩き', 'cardio', '有酸素', '', '', false],
  ['ex-swim', '水泳', 'cardio', '有酸素', 0.05, '', false] // 版2で追加
];

// [id, 名前, 既定の曜日（0=日 … 6=土、null=決めない）, [[種目ID, セット数, メモ, 目安の時間(分), 目安の距離(km)], …]]
// 有酸素の中身（時間・メニュー）は、別の AI に作ってもらって「取り込む」で上書きする想定の仮のもの
const TEMPLATES = [
  ['tpl-upper-a', '上半身A', 1, [['ex-bench', 4], ['ex-latpull', 3], ['ex-db-shoulder', 3], ['ex-onearm-row', 3], ['ex-dips', 2]]],
  ['tpl-lower', '下半身', 3, [['ex-squat', 4], ['ex-rdl', 3], ['ex-leg-press', 3], ['ex-calf-raise', 3], ['ex-leg-raise', 3]]],
  ['tpl-upper-b', '上半身B', 5, [['ex-incline-db', 4], ['ex-pullup', 3], ['ex-side-raise', 3], ['ex-narrow-bench', 3], ['ex-ab-roller', 3]]],
  ['tpl-run', 'ランニング', null, [['ex-running', 1, '会話できるペース（6:00〜6:30/km・心拍130〜145）', 30, 5]]], // 版2で追加
  ['tpl-swim', 'スイミング', null, [['ex-swim', 1, 'ゆっくり長く。息が上がったら壁で休む', 30, 1]]], // 版2で追加
  // 版3で追加：有酸素のレール用（血圧の改善が目的。会話できる強度・息を止めない・週1〜2回までの水泳）
  ['tpl-run-intro', 'ラン：導入（歩き混ぜ）', null, [['ex-running', 1, '早歩き5分 → (ラン4分＋早歩き2分)×4 → 早歩き5分。ランは6:30/kmの会話できる速さ。速く走れても上げない。慣れたらラン5分＋早歩き1分に', 34, 4.3]]],
  ['tpl-run-std', 'ラン：標準30分', null, [['ex-running', 1, '早歩き5分 → 一定ペースで30分（最初の2週は6:30/km、3週目から6:00/km）→ 早歩き5分。心拍145まで・会話できる強度。苦しければ歩いてよい', 40, 5.8]]],
  ['tpl-run-long', 'ラン：週末ロング', null, [['ex-running', 1, '早歩き5分 → 6:30/kmで40〜45分 → 早歩き5分。最初は35分から始め、毎週5分ずつ延ばす。標準より遅くてよい。途中で歩いてもよい', 55, 7.8]]],
  ['tpl-swim-basic', 'スイム：基礎', null, [['ex-swim', 1, '水中歩行5分 → クロール25m×8（2かきごとに息継ぎ、水中では鼻から吐き続ける。1本ごとに40秒休み）→ 平泳ぎでゆっくり25m×4 → 水中歩行5分。泳いだ後すぐシャワー・保湿', 35, 0.3]]],
  ['tpl-swim-long', 'スイム：少し長め', null, [['ex-swim', 1, '水中歩行5分 → クロール25m×4（各30秒休み）→ 50m×3（各60秒休み。きつければ25m×2に）→ 平泳ぎ25m×4 → 水中歩行5分。2かきごとに息継ぎ。泳いだ後すぐシャワー・保湿', 45, 0.35]]],
  ['tpl-bike-rain', '自転車：雨の日', null, [['ex-bike', 1, 'エアロバイク。軽め5分 → 会話できる強度（心拍130〜145）で30分 → 軽め5分。ペダルの回転は一定に。立ちこぎ・全力の区間は入れない', 40, null]]],
  // 版4で追加：筋トレの頻度ごとの分け方（週2＝全身A/B、週4＝上下×2、週5・6＝押す・引く・脚）。6番目は目標の回数
  ['tpl-full-a', '全身A', null, [['ex-squat', 3], ['ex-bench', 3], ['ex-latpull', 3], ['ex-db-shoulder', 2], ['ex-leg-raise', 2]]],
  ['tpl-full-b', '全身B', null, [['ex-rdl', 3], ['ex-incline-db', 3], ['ex-onearm-row', 3], ['ex-pullup', 2, '', null, null, 4], ['ex-ab-roller', 2]]],
  ['tpl-lower-b', '下半身B', null, [['ex-leg-press', 4], ['ex-rdl', 3], ['ex-calf-raise', 3], ['ex-ab-roller', 3]]],
  ['tpl-push', 'プッシュ（押す）', null, [['ex-bench', 4], ['ex-incline-db', 3], ['ex-db-shoulder', 3], ['ex-side-raise', 3], ['ex-dips', 2]]],
  ['tpl-pull', 'プル（引く）', null, [['ex-latpull', 4], ['ex-onearm-row', 3], ['ex-pullup', 3, '', null, null, 4], ['ex-leg-raise', 3]]],
  ['tpl-legs', '脚', null, [['ex-squat', 4], ['ex-rdl', 3], ['ex-leg-press', 3], ['ex-calf-raise', 3], ['ex-ab-roller', 3]]]
];

// 版2で入れた仮の有酸素メニュー。版3のメニューに置き換えたので、手を加えていなければ消す
export const RETIRED_TEMPLATES = ['tpl-run', 'tpl-swim'];

export const PULLUP_ID = 'ex-pullup';

export function seedExercises() {
  return EXERCISES.map(([id, name, type, parts, step, initial, perHand], i) => ({
    id, name, type, parts,
    step: step === '' ? null : step,
    initial_weight: initial === '' ? null : initial,
    per_hand: perHand,
    sort_order: (i + 1) * 10,
    active: true,
    created_at: SEED_TS, updated_at: SEED_TS, deleted: false
  }));
}

export function seedTemplates() {
  return TEMPLATES.map(([id, name, wd, items], i) => ({
    id, name, weekday: wd,
    items: items.map(([exercise_id, sets, note, duration_min, distance_km, reps]) => {
      const it = { exercise_id, sets };
      if (reps) it.reps = reps;
      if (note) it.note = note;
      if (duration_min) it.duration_min = duration_min;
      if (distance_km) it.distance_km = distance_km;
      return it;
    }),
    sort_order: (i + 1) * 10,
    created_at: SEED_TS, updated_at: SEED_TS, deleted: false
  }));
}
