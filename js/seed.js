// 初期データ（種目マスタと週テンプレート）。
// 端末で最初に起動したときに作り、最初の同期でスプレッドシートに入る。
// ID と日時を固定にしているので、別の端末で作っても重複しない（同じ行として扱われる）。

export const SEED_TS = '2026-01-01T00:00:00.000+09:00';

export const PARTS = ['胸', '背中', '肩', '腕', '脚', '体幹', '有酸素'];

// [id, 名前, タイプ, 部位（先頭が主部位）, 増減幅, 初期重量, 片手の重さで記録するか]
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
  ['ex-walk', '早歩き', 'cardio', '有酸素', '', '', false]
];

// [id, 名前, 既定の曜日（0=日 … 6=土）, [[種目ID, セット数], …]]
const TEMPLATES = [
  ['tpl-upper-a', '上半身A', 1, [['ex-bench', 4], ['ex-latpull', 3], ['ex-db-shoulder', 3], ['ex-onearm-row', 3], ['ex-dips', 2]]],
  ['tpl-lower', '下半身', 3, [['ex-squat', 4], ['ex-rdl', 3], ['ex-leg-press', 3], ['ex-calf-raise', 3], ['ex-leg-raise', 3]]],
  ['tpl-upper-b', '上半身B', 5, [['ex-incline-db', 4], ['ex-pullup', 3], ['ex-side-raise', 3], ['ex-narrow-bench', 3], ['ex-ab-roller', 3]]]
];

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
    items: items.map(([exercise_id, sets]) => ({ exercise_id, sets })),
    sort_order: (i + 1) * 10,
    created_at: SEED_TS, updated_at: SEED_TS, deleted: false
  }));
}
