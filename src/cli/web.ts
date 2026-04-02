import { getDb } from "../store/db.js";
import { getPnLSummary } from "../settlement/pnl.js";
import { logger } from "../logger.js";

const PORT = 3456;

/**
 * Simple web dashboard served by Bun.
 * Reads from SQLite, renders equity curve + positions + stats.
 */
export function startWebDashboard(): void {
  Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/data") {
        return Response.json(getDashboardData());
      }

      return new Response(HTML, {
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  logger.info({ port: PORT }, "Web dashboard started");
}

function getDashboardData() {
  const db = getDb();
  const pnl = getPnLSummary();

  const positions = db.query(
    `SELECT * FROM positions ORDER BY entry_time DESC LIMIT 100`,
  ).all() as any[];

  const signals = db.query(
    `SELECT * FROM signals ORDER BY created_at DESC LIMIT 50`,
  ).all() as any[];

  // Build equity curve from settled positions
  const settled = db.query(
    `SELECT settle_time, pnl FROM positions WHERE status IN ('won','lost') ORDER BY settle_time ASC`,
  ).all() as any[];

  let cumPnl = 0;
  const equityCurve = settled.map((p) => {
    cumPnl += p.pnl ?? 0;
    return { time: p.settle_time, pnl: cumPnl };
  });

  // City breakdown
  const cityStats = db.query(`
    SELECT city,
      COUNT(*) as total,
      SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) as losses,
      SUM(COALESCE(pnl,0)) as pnl
    FROM positions WHERE status IN ('won','lost')
    GROUP BY city
  `).all() as any[];

  return {
    pnl,
    positions: positions.map(mapPos),
    signals,
    equityCurve,
    cityStats,
  };
}

function mapPos(r: any) {
  return {
    id: r.id,
    city: r.city,
    date: r.date,
    metric: r.metric,
    bracketType: r.bracket_type,
    bracketMin: r.bracket_min,
    bracketMax: r.bracket_max,
    side: r.side,
    entryPrice: r.entry_price,
    size: r.size,
    edge: r.edge,
    status: r.status,
    pnl: r.pnl,
    actualTemp: r.actual_temp,
    entryTime: r.entry_time,
    settleTime: r.settle_time,
    modelProbability: r.model_probability,
  };
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ElementClaw Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Michroma&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0d1a14; --surface: rgba(26,58,42,0.4); --surface-solid: #11241a;
    --border: #1a3a2a; --border-bright: #2d5a41;
    --text: #e0e7e3; --dim: #7a9c8a; --green: #4ade80;
    --red: #ff4466; --yellow: #ffd60a; --cyan: #4ade80;
    --purple: #2d5a41;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Space Mono', 'SF Mono', monospace;
    background: var(--bg); color: var(--text);
    padding: 24px; min-height: 100vh;
  }
  h1 { font-family: 'Michroma', sans-serif; color: var(--cyan); font-size: 24px; margin-bottom: 8px; text-transform: uppercase; letter-spacing: -0.5px; }
  .subtitle { color: var(--dim); font-size: 12px; margin-bottom: 24px; text-transform: uppercase; letter-spacing: 0.05em; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    padding: 20px; transition: border-color 0.3s;
  }
  .card:hover { border-color: var(--green); }
  .card-label { color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .card-value { font-family: 'Michroma', sans-serif; font-size: 24px; font-weight: 400; margin-top: 4px; }
  .positive { color: var(--green); }
  .negative { color: var(--red); }
  .chart-container { background: var(--surface); border: 1px solid var(--border); padding: 20px; margin-bottom: 24px; transition: border-color 0.3s; }
  .chart-container:hover { border-color: var(--green); }
  .chart-title { font-family: 'Michroma', sans-serif; color: var(--dim); font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
  canvas { width: 100%; height: 200px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { color: var(--dim); text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; }
  td { padding: 8px 12px; border-bottom: 1px solid rgba(26,58,42,0.3); }
  tbody tr:hover { background: rgba(74,222,128,0.04); }
  .won { color: var(--green); }
  .lost { color: var(--red); }
  .open { color: var(--yellow); }
  .section { margin-bottom: 24px; }
  .section-title { font-family: 'Michroma', sans-serif; color: var(--cyan); font-size: 12px; font-weight: 400; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .badge {
    display: inline-block; padding: 2px 8px;
    font-size: 9px; font-weight: 700; letter-spacing: 0.04em;
  }
  .badge-won { background: rgba(74,222,128,0.15); color: var(--green); }
  .badge-lost { background: rgba(255,68,102,0.15); color: var(--red); }
  .badge-open { background: rgba(255,214,10,0.15); color: var(--yellow); }
  .heatmap { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .heat-cell {
    background: var(--surface); border: 1px solid var(--border);
    padding: 12px; text-align: center; transition: border-color 0.3s;
  }
  .heat-cell:hover { border-color: var(--green); }
  .heat-city { font-size: 10px; font-weight: 700; margin-bottom: 4px; letter-spacing: 0.08em; }
  .heat-stat { font-family: 'Michroma', sans-serif; font-size: 18px; font-weight: 400; }
  .refresh { color: var(--dim); font-size: 10px; margin-top: 16px; text-transform: uppercase; letter-spacing: 0.06em; }
</style>
</head>
<body>
<h1>ElementClaw</h1>
<p class="subtitle">Weather Prediction Market Bot &mdash; Polymarket</p>

<div id="stats" class="grid"></div>

<div class="chart-container">
  <div class="chart-title">Equity Curve</div>
  <canvas id="equityChart"></canvas>
</div>

<div class="section">
  <div class="section-title">City Performance</div>
  <div id="heatmap" class="heatmap"></div>
</div>

<div class="section">
  <div class="section-title">Positions</div>
  <div class="card">
    <table>
      <thead><tr>
        <th>City</th><th>Date</th><th>Side</th><th>Entry</th><th>Size</th>
        <th>Edge</th><th>Actual</th><th>P&L</th><th>Status</th>
      </tr></thead>
      <tbody id="positions"></tbody>
    </table>
  </div>
</div>

<p class="refresh">Auto-refreshes every 30s</p>

<script>
async function load() {
  const res = await fetch('/api/data');
  const d = await res.json();

  // Stats cards
  document.getElementById('stats').innerHTML =
    card('Total P&L', fmt(d.pnl.totalPnl), d.pnl.totalPnl >= 0) +
    card('Win Rate', d.pnl.totalTrades > 0 ? (d.pnl.winRate * 100).toFixed(1) + '%' : 'N/A') +
    card('Trades', d.pnl.totalTrades) +
    card('Open', d.pnl.openPositions) +
    card('Exposure', '$' + d.pnl.openExposure.toFixed(2));

  // Positions table
  document.getElementById('positions').innerHTML = d.positions.map(p =>
    '<tr>' +
    '<td>' + p.city + '</td>' +
    '<td>' + p.date + '</td>' +
    '<td>' + p.side + '</td>' +
    '<td>' + (p.entryPrice * 100).toFixed(1) + '¢</td>' +
    '<td>$' + p.size.toFixed(2) + '</td>' +
    '<td>' + (p.edge * 100).toFixed(1) + '%</td>' +
    '<td>' + (p.actualTemp != null ? p.actualTemp + '°F' : '—') + '</td>' +
    '<td class="' + (p.pnl >= 0 ? 'positive' : 'negative') + '">' +
      (p.pnl != null ? fmt(p.pnl) : '—') + '</td>' +
    '<td><span class="badge badge-' + p.status + '">' + p.status.toUpperCase() + '</span></td>' +
    '</tr>'
  ).join('');

  // City heatmap
  document.getElementById('heatmap').innerHTML = d.cityStats.map(c =>
    '<div class="heat-cell">' +
    '<div class="heat-city">' + c.city.toUpperCase() + '</div>' +
    '<div class="heat-stat ' + (c.pnl >= 0 ? 'positive' : 'negative') + '">' + fmt(c.pnl) + '</div>' +
    '<div style="color:var(--dim);font-size:11px">' + c.wins + 'W / ' + c.losses + 'L</div>' +
    '</div>'
  ).join('');

  // Equity chart
  drawChart(d.equityCurve);
}

function fmt(n) {
  if (n == null) return '—';
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}

function card(label, value, positive) {
  const cls = positive === true ? 'positive' : positive === false ? 'negative' : '';
  return '<div class="card"><div class="card-label">' + label +
    '</div><div class="card-value ' + cls + '">' + value + '</div></div>';
}

function drawChart(data) {
  const canvas = document.getElementById('equityChart');
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.offsetWidth * 2;
  canvas.height = 400;
  ctx.scale(2, 2);

  const w = canvas.offsetWidth;
  const h = 200;

  if (data.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '14px monospace';
    ctx.fillText('Waiting for settlements...', w / 2 - 100, h / 2);
    return;
  }

  const pnls = data.map(d => d.pnl);
  const min = Math.min(0, ...pnls);
  const max = Math.max(0, ...pnls);
  const range = max - min || 1;
  const pad = 20;

  ctx.strokeStyle = '#1a3a2a';
  ctx.lineWidth = 0.5;
  const zeroY = pad + (max / range) * (h - 2 * pad);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(w, zeroY);
  ctx.stroke();

  ctx.strokeStyle = pnls[pnls.length - 1] >= 0 ? '#4ade80' : '#ff4466';
  ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = pad + ((max - d.pnl) / range) * (h - 2 * pad);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

load();
setInterval(load, 30000);
</script>
</body>
</html>`;
