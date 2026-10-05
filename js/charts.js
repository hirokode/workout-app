// グラフ（Chart.js。lib/chart.umd.min.js を同梱しているので、電波が無くても表示できる）。
// 同じ canvas に描き直すときは、前のグラフを消してから描く。

const charts = new Map();

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function destroyAll() {
  charts.forEach(c => c.destroy());
  charts.clear();
}

function draw(canvas, config) {
  if (!canvas || !window.Chart) return null;
  const old = charts.get(canvas.id);
  if (old) old.destroy();
  const Chart = window.Chart;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--line');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const chart = new Chart(canvas, config);
  charts.set(canvas.id, chart);
  return chart;
}

const baseOptions = (unit, extra = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.formattedValue}${unit}` } }
  },
  scales: {
    x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 }, grid: { display: false } },
    y: { ticks: { maxTicksLimit: 5 }, ...extra.y }
  },
  ...extra.root
});

// 種目の推移（1本の折れ線）
export function lineChart(canvas, labels, values, label, unit) {
  const color = css('--accent');
  return draw(canvas, {
    type: 'line',
    data: { labels, datasets: [{ label, data: values, borderColor: color, backgroundColor: color, pointRadius: 3, tension: 0.2 }] },
    options: baseOptions(unit)
  });
}

// 棒グラフ（週ごとの運動日数・ボリューム）
export function barChart(canvas, labels, values, label, unit) {
  const color = css('--accent');
  return draw(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label, data: values, backgroundColor: color, borderRadius: 4 }] },
    options: baseOptions(unit, { y: { beginAtZero: true } })
  });
}

// 血圧：上・下の値（点）と7日移動平均（線）、基準線（135・85）
// 警告色は使わない（淡々と表示する）
export function bpChart(canvas, labels, sys, dia, sysAvg, diaAvg) {
  const c1 = css('--bp-sys');
  const c2 = css('--bp-dia');
  const ref = css('--muted');
  const flat = v => labels.map(() => v);
  return draw(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '上（7日平均）', data: sysAvg, borderColor: c1, pointRadius: 0, borderWidth: 2.5, tension: 0.3, spanGaps: true },
        { label: '下（7日平均）', data: diaAvg, borderColor: c2, pointRadius: 0, borderWidth: 2.5, tension: 0.3, spanGaps: true },
        { label: '上', data: sys, borderColor: 'transparent', backgroundColor: c1, pointRadius: 2.5, showLine: false },
        { label: '下', data: dia, borderColor: 'transparent', backgroundColor: c2, pointRadius: 2.5, showLine: false },
        { label: '基準 135', data: flat(135), borderColor: ref, borderDash: [5, 4], borderWidth: 1, pointRadius: 0 },
        { label: '基準 85', data: flat(85), borderColor: ref, borderDash: [5, 4], borderWidth: 1, pointRadius: 0 }
      ]
    },
    options: baseOptions('', { y: { suggestedMin: 60, suggestedMax: 150 } })
  });
}

// 体重と目標ペースの参考線
export function weightChart(canvas, labels, weights, goal) {
  const c = css('--accent');
  return draw(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: '体重', data: weights, borderColor: c, backgroundColor: c, pointRadius: 2.5, tension: 0.2, spanGaps: true },
        { label: '目標ペース', data: goal, borderColor: css('--muted'), borderDash: [5, 4], borderWidth: 1, pointRadius: 0 }
      ]
    },
    options: baseOptions('kg')
  });
}
