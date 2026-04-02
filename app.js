'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const COINS = [
  { id: 'bitcoin',      symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum',     symbol: 'ETH', name: 'Ethereum' },
  { id: 'binancecoin',  symbol: 'BNB', name: 'BNB' },
  { id: 'solana',       symbol: 'SOL', name: 'Solana' },
  { id: 'xrp',          symbol: 'XRP', name: 'XRP' },
  { id: 'dogecoin',     symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'cardano',      symbol: 'ADA', name: 'Cardano' },
  { id: 'avalanche-2',  symbol: 'AVAX', name: 'Avalanche' },
  { id: 'tron',         symbol: 'TRX', name: 'Tron' },
  { id: 'chainlink',    symbol: 'LINK', name: 'Chainlink' },
  { id: 'polkadot',     symbol: 'DOT', name: 'Polkadot' },
  { id: 'shiba-inu',    symbol: 'SHIB', name: 'Shiba Inu' },
  { id: 'uniswap',      symbol: 'UNI', name: 'Uniswap' },
  { id: 'litecoin',     symbol: 'LTC', name: 'Litecoin' },
  { id: 'near',         symbol: 'NEAR', name: 'NEAR' },
  { id: 'sui',          symbol: 'SUI', name: 'Sui' },
  { id: 'aptos',        symbol: 'APT', name: 'Aptos' },
  { id: 'injective-protocol', symbol: 'INJ', name: 'Injective' },
  { id: 'ergo',         symbol: 'ERG', name: 'Ergo' },
  { id: 'fetch-ai',     symbol: 'FET', name: 'Fetch.ai' },
];

const CG_BASE = 'https://api.coingecko.com/api/v3';
const CACHE_KEY = 'ccm_cache_v2';
const CACHE_TTL = 5 * 60 * 1000; // 5 min

let currentTf = 7;
let priceMatrix = {}; // { coinId: [prices...] }
let corrMatrix = [];  // 20×20
let pairChart = null;
let tooltip = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]; sumB += b[i];
    sumAB += a[i] * b[i];
    sumA2 += a[i] * a[i];
    sumB2 += b[i] * b[i];
  }
  const num = n * sumAB - sumA * sumB;
  const den = Math.sqrt((n * sumA2 - sumA ** 2) * (n * sumB2 - sumB ** 2));
  return den === 0 ? 0 : num / den;
}

function corrColor(r) {
  // -1 → blue, 0 → dark, +1 → red/orange
  if (r >= 0) {
    const t = r;
    const R = Math.round(255 * t + 42 * (1 - t));
    const G = Math.round(71 * (1 - t) * 0.5 + 42 * (1 - t));
    const B = Math.round(87 * (1 - t) * 0.5 + 42 * (1 - t));
    return `rgb(${R},${G},${B})`;
  } else {
    const t = -r;
    const R = Math.round(42 * (1 - t));
    const G = Math.round(42 * (1 - t) + 50 * (1 - t));
    const B = Math.round(255 * t + 42 * (1 - t));
    return `rgb(${R},${G},${B})`;
  }
}

function corrLabel(r) {
  if (r >= 0.8) return 'Very Strongly Positive';
  if (r >= 0.6) return 'Strongly Positive';
  if (r >= 0.4) return 'Moderately Positive';
  if (r >= 0.2) return 'Weakly Positive';
  if (r >= -0.2) return 'Uncorrelated';
  if (r >= -0.4) return 'Weakly Negative';
  if (r >= -0.6) return 'Moderately Negative';
  if (r >= -0.8) return 'Strongly Negative';
  return 'Very Strongly Negative';
}

function diversificationScore(matrix) {
  let sum = 0, count = 0;
  const n = matrix.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      sum += matrix[i][j];
      count++;
    }
  const avg = count > 0 ? sum / count : 0;
  // Score: 0 (all perfectly correlated) to 100 (all perfectly anti-correlated)
  return Math.round((1 - avg) * 50);
}

function setSubText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ─── Cache ────────────────────────────────────────────────────────────────────
function cacheKey(tf) { return `${CACHE_KEY}_${tf}`; }

function loadCache(tf) {
  try {
    const raw = localStorage.getItem(cacheKey(tf));
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch { return null; }
}

function saveCache(tf, data) {
  try {
    localStorage.setItem(cacheKey(tf), JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

// ─── Data Fetching ────────────────────────────────────────────────────────────
async function fetchPriceHistory(coinId, days) {
  const url = `${CG_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=${days <= 7 ? 'hourly' : 'daily'}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.prices.map(p => p[1]);
}

async function fetchAllPrices(tf) {
  const cached = loadCache(tf);
  if (cached) return cached;

  const sub = document.getElementById('loading-sub');
  const data = {};

  for (let i = 0; i < COINS.length; i++) {
    const coin = COINS[i];
    if (sub) sub.textContent = `Loading ${coin.symbol} (${i + 1}/${COINS.length})…`;
    try {
      data[coin.id] = await fetchPriceHistory(coin.id, tf);
    } catch (e) {
      console.warn(`Failed ${coin.id}:`, e);
      data[coin.id] = [];
    }
    if (i < COINS.length - 1) await sleep(300); // respect rate limit
  }

  saveCache(tf, data);
  return data;
}

// ─── Correlation Matrix ───────────────────────────────────────────────────────
function buildCorrMatrix(prices) {
  const n = COINS.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(prices[COINS[i].id] || [], prices[COINS[j].id] || []);
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  return matrix;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderMatrix(matrix) {
  const container = document.getElementById('matrix-container');
  const n = COINS.length;

  const table = document.createElement('table');
  table.className = 'matrix-table';

  // Header row
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const emptyTh = document.createElement('th');
  emptyTh.className = 'row-header';
  headerRow.appendChild(emptyTh);
  COINS.forEach(coin => {
    const th = document.createElement('th');
    th.className = 'col-header';
    th.textContent = coin.symbol;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  matrix.forEach((row, i) => {
    const tr = document.createElement('tr');

    const rowTh = document.createElement('th');
    rowTh.className = 'row-header';
    rowTh.textContent = COINS[i].symbol;
    tr.appendChild(rowTh);

    row.forEach((val, j) => {
      const td = document.createElement('td');
      td.className = 'matrix-cell' + (i === j ? ' diagonal' : '');
      td.style.background = i === j ? '' : corrColor(val);
      td.textContent = i === j ? '—' : val.toFixed(2);
      if (i !== j) {
        td.addEventListener('click', () => showPairPanel(i, j, val));
        td.addEventListener('mouseenter', (e) => showTooltip(e, i, j, val));
        td.addEventListener('mouseleave', hideTooltip);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

function renderStats(matrix) {
  const n = COINS.length;
  const divScore = diversificationScore(matrix);

  // Diversification
  const divEl = document.getElementById('div-score');
  divEl.textContent = divScore;
  divEl.style.color = divScore >= 60 ? 'var(--green)' : divScore >= 40 ? 'var(--yellow)' : 'var(--red)';
  setSubText('div-label',
    divScore >= 60 ? 'Well Diversified' :
    divScore >= 40 ? 'Moderate Diversification' : 'High Correlation Risk');

  // BTC avg correlation
  const btcIdx = 0;
  let btcSum = 0, btcCount = 0;
  matrix[btcIdx].forEach((r, j) => { if (j !== btcIdx) { btcSum += r; btcCount++; } });
  const btcAvg = btcCount > 0 ? (btcSum / btcCount) : 0;
  const btcEl = document.getElementById('btc-corr');
  btcEl.textContent = btcAvg.toFixed(3);
  btcEl.style.color = btcAvg >= 0.5 ? 'var(--red)' : btcAvg >= 0 ? 'var(--yellow)' : 'var(--green)';

  // Most / least correlated
  let maxR = -Infinity, minR = Infinity;
  let maxI = 0, maxJ = 1, minI = 0, minJ = 1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (matrix[i][j] > maxR) { maxR = matrix[i][j]; maxI = i; maxJ = j; }
      if (matrix[i][j] < minR) { minR = matrix[i][j]; minI = i; minJ = j; }
    }
  document.getElementById('max-pair').textContent = `${COINS[maxI].symbol} / ${COINS[maxJ].symbol}`;
  document.getElementById('max-val').textContent = maxR.toFixed(3);
  document.getElementById('min-pair').textContent = `${COINS[minI].symbol} / ${COINS[minJ].symbol}`;
  document.getElementById('min-val').textContent = minR.toFixed(3);
  document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
}

function renderBtcRankings(matrix) {
  const btcIdx = 0;
  const rows = COINS.map((coin, i) => ({
    coin,
    corr: i === btcIdx ? 1 : matrix[btcIdx][i],
  }))
  .filter(r => r.coin.id !== 'bitcoin')
  .sort((a, b) => b.corr - a.corr);

  const container = document.getElementById('btc-rankings');
  container.innerHTML = '';
  rows.forEach((row, idx) => {
    const r = row.corr;
    const pct = Math.round(((r + 1) / 2) * 100);
    const barColor = r >= 0.5 ? 'var(--red)' : r >= 0 ? 'var(--yellow)' : 'var(--corr-neg)';
    const card = document.createElement('div');
    card.className = 'rank-card';
    card.innerHTML = `
      <div class="rank-num">#${idx + 1}</div>
      <div class="rank-coin">
        <div class="rank-symbol">${row.coin.symbol}</div>
        <div class="rank-name">${row.coin.name}</div>
      </div>
      <div class="rank-bar-wrap">
        <div class="rank-bar-track">
          <div class="rank-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div class="rank-corr" style="color:${barColor}">${r.toFixed(3)}</div>
      </div>`;
    container.appendChild(card);
  });
}

// ─── Pair Panel ───────────────────────────────────────────────────────────────
function showPairPanel(i, j, corrVal) {
  const panel = document.getElementById('pair-panel');
  panel.classList.remove('hidden');

  document.getElementById('pair-title').textContent =
    `${COINS[i].name} (${COINS[i].symbol}) vs ${COINS[j].name} (${COINS[j].symbol})`;

  const corrEl = document.getElementById('pair-corr-val');
  corrEl.textContent = corrVal.toFixed(4);
  corrEl.style.color = corrVal >= 0 ? 'var(--red)' : 'var(--corr-neg)';

  document.getElementById('pair-rel').textContent = corrLabel(corrVal);

  // Build chart
  const pricesA = priceMatrix[COINS[i].id] || [];
  const pricesB = priceMatrix[COINS[j].id] || [];
  const len = Math.min(pricesA.length, pricesB.length, 100);

  // Normalize to % change from first point
  const normalize = arr => {
    const base = arr[arr.length - len];
    return arr.slice(arr.length - len).map(v => ((v / base) - 1) * 100);
  };

  const normA = normalize(pricesA);
  const normB = normalize(pricesB);
  const labels = normA.map((_, k) => k + 1);

  const ctx = document.getElementById('pair-chart').getContext('2d');
  if (pairChart) pairChart.destroy();
  pairChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: COINS[i].symbol,
          data: normA,
          borderColor: '#7c5cfc',
          backgroundColor: 'rgba(124,92,252,0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
        {
          label: COINS[j].symbol,
          data: normB,
          borderColor: '#00d4aa',
          backgroundColor: 'rgba(0,212,170,0.1)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#7878a0', font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: { display: false },
        y: {
          ticks: {
            color: '#7878a0',
            callback: v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%',
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });

  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById('close-panel').addEventListener('click', () => {
  document.getElementById('pair-panel').classList.add('hidden');
  if (pairChart) { pairChart.destroy(); pairChart = null; }
});

// ─── Tooltip ──────────────────────────────────────────────────────────────────
function showTooltip(e, i, j, val) {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'tooltip-overlay';
    document.body.appendChild(tooltip);
  }
  const color = val >= 0 ? '#ff6b81' : '#4da6ff';
  tooltip.innerHTML = `<strong>${COINS[i].symbol}</strong> vs <strong>${COINS[j].symbol}</strong>
    <br>r = <span style="color:${color}">${val.toFixed(4)}</span>
    <br><span style="color:#7878a0;font-size:0.75em">${corrLabel(val)}</span>`;
  tooltip.style.display = 'block';
  moveTooltip(e);
}

function moveTooltip(e) {
  if (!tooltip) return;
  tooltip.style.left = (e.clientX + 14) + 'px';
  tooltip.style.top = (e.clientY - 10) + 'px';
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

document.addEventListener('mousemove', moveTooltip);

// ─── Main ─────────────────────────────────────────────────────────────────────
async function loadAndRender(tf) {
  const loading = document.getElementById('loading');
  const app = document.getElementById('app');
  loading.classList.remove('hidden');
  app.classList.add('hidden');

  try {
    priceMatrix = await fetchAllPrices(tf);
    corrMatrix = buildCorrMatrix(priceMatrix);

    renderMatrix(corrMatrix);
    renderStats(corrMatrix);
    renderBtcRankings(corrMatrix);

    loading.classList.add('hidden');
    app.classList.remove('hidden');
  } catch (err) {
    console.error(err);
    document.getElementById('loading-sub').textContent = 'Error loading data. Please try again.';
  }
}

// ─── Controls ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.tf-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTf = parseInt(btn.dataset.tf, 10);
    if (pairChart) { pairChart.destroy(); pairChart = null; }
    document.getElementById('pair-panel').classList.add('hidden');
    loadAndRender(currentTf);
  });
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  localStorage.removeItem(cacheKey(currentTf));
  if (pairChart) { pairChart.destroy(); pairChart = null; }
  document.getElementById('pair-panel').classList.add('hidden');
  loadAndRender(currentTf);
});

// Boot
loadAndRender(currentTf);
