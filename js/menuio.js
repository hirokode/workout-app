// 定型メニューの取り込み。
// 別の AI にメニューを作ってもらうための依頼文を作り、返ってきた JSON をテンプレートとして取り込む。
// 種目は名前で探し、無ければ新しく作る。同じ名前のテンプレートがあれば中身を置き換える。

import * as store from './store.js';
import { uuid } from './util.js';
import { PARTS } from './seed.js';

const TYPES = ['strength', 'bodyweight', 'cardio'];
const TYPE_LABEL = { strength: '筋トレ', bodyweight: '自重', cardio: '有酸素' };

const EXAMPLE = {
  templates: [
    {
      name: 'ラン：ゆっくり長く',
      weekday: null,
      items: [
        { exercise: 'ランニング', type: 'cardio', part: '有酸素', sets: 1, duration_min: 40, distance_km: 6, note: '歩き5分 → 6:20/kmで30分 → 歩き5分' }
      ]
    },
    {
      name: 'スイム：基礎',
      weekday: null,
      items: [
        { exercise: '水泳', type: 'cardio', part: '有酸素', sets: 1, duration_min: 30, distance_km: 0.8, note: 'W-up 100m → クロール50m×8（各30秒休み）→ ゆっくり100m' }
      ]
    }
  ]
};

// 別の AI に渡す依頼文（種目の一覧は、今アプリにあるものを入れる）
export function buildPrompt() {
  const exs = store.all('exercises').filter(e => e.active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const list = exs.map(e => `- ${e.name}（${TYPE_LABEL[e.type] || e.type}${e.type === 'cardio' ? '' : '・' + String(e.parts || '').split(',').join('・')}）`).join('\n');
  return `あなたはトレーニングと有酸素運動にくわしいコーチです。私のワークアウト記録アプリに取り込む「定型メニュー」を作ってください。

【私について】（わかる範囲で書き換えてください）
- 年齢・性別：
- 身長・体重：
- 運動歴：
- ランニング：例）今は30分なら続けて走れる
- 水泳：例）クロールで50mなら泳げる
- 1回に使える時間：例）45分
- 目的：例）体力をつける・体重を月0.5kgずつ増やす

【守ってほしい条件】
- 家で血圧を測って記録しています（目安 135/85）。血圧が上がりやすい追い込み方は避けてください
- 全種目で息を止めない（上げるときに吐く）
- 筋トレは「あと2回いけそう」で止める。1〜3回しか上がらない高重量やMAX測定は入れない
- 有酸素は会話できる強度（目安ペース 6:00〜6:30/km、心拍 130〜145bpm）

【作ってほしいもの】
1. ランニングのパターンを2〜3個（例：ゆっくり長く／短め／ウォーキングを混ぜる）
2. スイミングのパターンを2〜3個
3. それぞれ、ウォームアップ・メイン・クールダウンの中身と、目安の時間（分）・距離（km）

【アプリにある種目】（できるだけこの名前をそのまま使ってください。新しい種目が必要なら新しい名前で書いてください）
${list}

【出力のしかた】
はじめに、各パターンのねらいを短く説明してください。
そのあと、アプリに貼り付けるための JSON を、下の形のとおりに1つのコードブロックで出してください。
- name：パターンの名前（20文字以内）
- exercise：種目の名前（上の一覧の名前をそのまま）
- type：strength（重量×回数）／bodyweight（自重）／cardio（有酸素）のどれか
- part：胸・背中・肩・腕・脚・体幹・有酸素 のどれか
- sets：筋トレはセット数、有酸素は 1
- duration_min（分）・distance_km（km）：有酸素の目安。無ければ書かない
- note：メニューの中身（150文字以内。例「歩き5分 → 6:20/kmで30分 → 歩き5分」）
- weekday：null のまま（曜日はアプリで決めます）

${JSON.stringify(EXAMPLE, null, 2)}
`;
}

function num(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) && n >= min && n <= max ? n : null;
}

// 貼り付けられた文字から JSON を読み取り、取り込む内容を組み立てる（まだ保存しない）
// 返り値 { templates: [{ name, weekday, existing, items: [{ name, exercise, isNew, type, part, sets, note, duration_min, distance_km }] }], errors: [] }
export function parse(text) {
  const errors = [];
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return { templates: [], errors: ['JSON が見つかりません。AI の答えの「{」から「}」までを貼り付けてください'] };
  let json;
  try {
    json = JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    return { templates: [], errors: ['JSON の形が正しくありません（' + e.message + '）'] };
  }
  const list = Array.isArray(json) ? json : Array.isArray(json.templates) ? json.templates : [json];
  const exByName = new Map(store.all('exercises').map(e => [e.name.trim(), e]));
  const tplByName = new Map(store.all('templates').map(t => [t.name.trim(), t]));
  const out = [];
  list.forEach((t, ti) => {
    const name = String((t && t.name) || '').trim().slice(0, 40);
    if (!name) { errors.push(`${ti + 1}つ目のメニューに name がありません`); return; }
    const items = [];
    (Array.isArray(t.items) ? t.items : []).forEach((it, ii) => {
      const exName = String((it && (it.exercise || it.name)) || '').trim().slice(0, 40);
      if (!exName) { errors.push(`「${name}」の${ii + 1}つ目に exercise がありません`); return; }
      const found = exByName.get(exName);
      const type = found ? found.type : (TYPES.includes(it.type) ? it.type : null);
      if (!type) { errors.push(`「${exName}」の type がわかりません（strength／bodyweight／cardio）`); return; }
      const part = found ? null : (PARTS.includes(it.part) ? it.part : (type === 'cardio' ? '有酸素' : null));
      if (!found && !part) { errors.push(`「${exName}」の part がわかりません（${PARTS.join('・')}）`); return; }
      items.push({
        name: exName, exercise: found || null, isNew: !found, type, part,
        sets: num(it.sets, 1, 10) || (type === 'cardio' ? 1 : 3),
        note: String(it.note || '').trim().slice(0, 200),
        duration_min: num(it.duration_min, 1, 600),
        distance_km: num(it.distance_km, 0.01, 100),
        reps: type === 'cardio' ? null : num(it.reps, 1, 50),
        weight: type === 'strength' ? num(it.weight, 0, 500) : null
      });
    });
    if (!items.length) { errors.push(`「${name}」に種目がありません`); return; }
    const wd = num(t.weekday, 0, 6);
    out.push({ name, weekday: wd === null ? null : Math.round(wd), existing: tplByName.get(name) || null, items });
  });
  return { templates: out, errors };
}

// 取り込む。新しい種目を作り、テンプレートを作る（同じ名前があれば中身を置き換える）
export async function apply(parsed) {
  const newEx = new Map();
  let order = Math.max(0, ...store.all('exercises').map(e => e.sort_order || 0));
  parsed.templates.forEach(t => t.items.forEach(it => {
    if (it.isNew && !newEx.has(it.name)) {
      order += 10;
      newEx.set(it.name, {
        id: uuid(), name: it.name, type: it.type, parts: it.part,
        step: it.type === 'strength' ? 2.5 : it.type === 'bodyweight' ? 1 : 0.5,
        initial_weight: it.weight, per_hand: false, sort_order: order, active: true
      });
    }
  }));
  if (newEx.size) await store.putMany('exercises', [...newEx.values()]);
  // 開始の重さ（weight）は、種目の「初期重量の目安」に入れる（記録が無い種目の今日の目標になる）
  const weightUpd = new Map();
  parsed.templates.forEach(t => t.items.forEach(it => {
    if (it.exercise && it.weight != null && it.exercise.initial_weight !== it.weight) weightUpd.set(it.exercise.id, { ...it.exercise, initial_weight: it.weight });
  }));
  if (weightUpd.size) await store.putMany('exercises', [...weightUpd.values()]);
  let tOrder = Math.max(0, ...store.all('templates').map(t => t.sort_order || 0));
  const rows = parsed.templates.map(t => {
    const items = t.items.map(it => {
      const o = { exercise_id: it.exercise ? it.exercise.id : newEx.get(it.name).id, sets: it.sets };
      if (it.note) o.note = it.note;
      if (it.duration_min) o.duration_min = it.duration_min;
      if (it.distance_km) o.distance_km = it.distance_km;
      if (it.reps) o.reps = it.reps;
      return o;
    });
    if (t.existing) return { ...t.existing, items };
    tOrder += 10;
    return { id: uuid(), name: t.name, weekday: t.weekday, items, sort_order: tOrder };
  });
  await store.putMany('templates', rows);
  return { templates: rows.length, exercises: newEx.size };
}

// 筋トレのメニューと今日の目標を AI に確認してもらう依頼文。
// rows：[{ name, items: [{ name, type, sets, reps, weight, per_hand, reason }] }]（プラン設定の今の分け方と、自動で出した目標）
export function buildStrengthPrompt(cfg, rows, cardioText) {
  const v = x => (x === null || x === undefined || x === '' ? '（未入力）' : x);
  const menus = rows.map(r => `■ ${r.name}\n` + r.items.map(it => `- ${it.name}：${it.type === 'bodyweight' ? `${it.reps}回` : `${it.weight}kg${it.per_hand ? '（片手）' : ''} × ${it.reps}回`} × ${it.sets}セット（${it.reason}）`).join('\n')).join('\n');
  const exs = store.all('exercises').filter(e => e.active && e.type !== 'cardio').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const list = exs.map(e => `- ${e.name}（${TYPE_LABEL[e.type]}・${String(e.parts || '').split(',').join('・')}${e.per_hand ? '・片手の重さで記録' : ''}）`).join('\n');
  return `あなたは筋力トレーニングにくわしいコーチです。私のワークアウト記録アプリが自動で出した「筋トレのメニューと開始の重さ」が妥当か確認し、必要なら直してください。

【私について】（わかる範囲で書き換えてください）
- 年齢・性別：
- 身長：
- 体重：${v(cfg.body_weight)}kg
- ベンチプレスの最大（1回）：${v(cfg.bench_max)}kg
- スクワットの最大（1回）：${v(cfg.squat_max)}kg
- 懸垂の最大回数：${v(cfg.pullup_max)}回
- 運動歴：
- 目的：血圧の改善（最優先）／体重を月+0.5kgペースで増やし、体脂肪率を保ったまま筋肉をつける

【頻度】
- 筋トレ：週${cfg.s_freq}回
- 有酸素：${cardioText}

【守ってほしい条件】
- 家庭血圧が高め（目安 135/85 を超えている）で、受診予定です。血圧が上がりやすい追い込み方は避けてください
- 全種目で息を止めない（上げるときに吐く）
- 「あと2回いけそう」で止める。1〜3回しか上がらない高重量やMAX測定は入れない
- 重さの上げ方は「前回、目標の回数を全セットこなせたら次回1段階上げる」で自動にしています

【アプリが出した今のメニューと開始の重さ】
${menus}

【アプリにある種目】（この名前をそのまま使ってください）
${list}

【出力のしかた】
はじめに、直したところとその理由を短く書いてください（直す必要がなければ「このままでよい」と書いてください）。
そのあと、アプリに貼り付ける JSON を1つのコードブロックで出してください。
- JSON はコメント・末尾カンマなしの厳密な形式
- name：メニューの名前（上の ■ の名前をそのまま使うと、そのメニューが置き換わります）
- exercise：種目の名前（上の一覧の名前をそのまま）
- type：strength（重量×回数）／bodyweight（自重）
- part：胸・背中・肩・腕・脚・体幹 のどれか
- sets：セット数／reps：目標の回数
- weight：開始の重さ（kg、筋トレのみ。片手の種目は片手の重さ）
- note：注意点があれば（80文字以内）
- weekday：null のまま

{
  "templates": [
    { "name": "上半身A", "weekday": null,
      "items": [ { "exercise": "ベンチプレス", "type": "strength", "part": "胸", "sets": 3, "reps": 10, "weight": 30 } ] }
  ]
}
`;
}
