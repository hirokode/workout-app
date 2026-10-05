// 受診用の書き出し（血圧・体重）。CSV と画像（PNG）。
// iPhone のホーム画面アプリではダウンロードがうまく動かないことがあるので、共有シートを優先する。

import { fmtNum, fmtDate } from './util.js';

const COLS = ['日付', '朝 上', '朝 下', '夜 上', '夜 下', '体重(kg)'];

function rowsFor(list, withMemo) {
  return list.map(c => {
    const r = [c.date, fmtNum(c.am_sys, 0), fmtNum(c.am_dia, 0), fmtNum(c.pm_sys, 0), fmtNum(c.pm_dia, 0), c.weight == null ? '' : Number(c.weight).toFixed(1)];
    if (withMemo) r.push(c.memo || '');
    return r;
  });
}

function csvCell(s) {
  const t = String(s ?? '');
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

// Excel で開いても文字化けしないよう、先頭に BOM を付けた UTF-8
export function toCsv(list, withMemo) {
  const head = withMemo ? [...COLS, 'メモ'] : COLS;
  const lines = [head, ...rowsFor(list, withMemo)].map(r => r.map(csvCell).join(','));
  return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
}

// 表を canvas に描いて PNG にする
export function toPng(list, withMemo, title) {
  const head = withMemo ? [...COLS, 'メモ'] : COLS;
  const rows = rowsFor(list, withMemo).map(r => { r[0] = fmtDate(r[0]); return r; });
  const scale = 2;
  const pad = 16;
  const rowH = 30;
  const font = '14px -apple-system, "Hiragino Sans", "Yu Gothic UI", sans-serif';
  const ctx0 = document.createElement('canvas').getContext('2d');
  ctx0.font = font;
  const widths = head.map((h, i) => Math.max(ctx0.measureText(h).width, ...rows.map(r => ctx0.measureText(String(r[i])).width)) + 20);
  if (withMemo) widths[widths.length - 1] = Math.min(Math.max(widths[widths.length - 1], 120), 320);
  const w = widths.reduce((s, x) => s + x, 0) + pad * 2;
  const h = pad * 2 + 34 + rowH * (rows.length + 1);
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 16px -apple-system, "Hiragino Sans", "Yu Gothic UI", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, pad, pad + 12);
  ctx.font = font;
  let y = pad + 34;
  [head, ...rows].forEach((r, ri) => {
    if (ri === 0) { ctx.fillStyle = '#eef1f4'; ctx.fillRect(pad, y, w - pad * 2, rowH); }
    ctx.strokeStyle = '#d5dbe1';
    ctx.beginPath(); ctx.moveTo(pad, y + rowH); ctx.lineTo(w - pad, y + rowH); ctx.stroke();
    let x = pad;
    r.forEach((cell, ci) => {
      ctx.fillStyle = '#111111';
      ctx.font = ri === 0 ? 'bold ' + font : font;
      let text = String(cell);
      const maxW = widths[ci] - 16;
      while (text.length > 1 && ctx.measureText(text).width > maxW) text = text.slice(0, -2) + '…';
      const isNum = ci > 0 && ci < 6 && ri > 0;
      ctx.textAlign = isNum ? 'right' : 'left';
      ctx.fillText(text, isNum ? x + widths[ci] - 10 : x + 8, y + rowH / 2);
      x += widths[ci];
    });
    y += rowH;
  });
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

// 共有シート → だめならダウンロード
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}
