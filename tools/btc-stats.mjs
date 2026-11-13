// 拉全量 BTC 数据，算一遍候选指标 + 历史分位，用来标定阈值
// 用法: node tools/btc-stats.mjs
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const T = 25000;
const j = async (url) => {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
};
const pctRank = (arr, v) => {
  const xs = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  let lo = 0; for (const x of xs) if (x < v) lo++;
  return +(lo / xs.length * 100).toFixed(1);
};
const pctl = (arr, p) => {
  const xs = arr.filter(Number.isFinite).sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
};
const ma = (arr, n, i = arr.length - 1) => {
  if (i + 1 < n) return null;
  let s = 0; for (let k = i - n + 1; k <= i; k++) s += arr[k];
  return s / n;
};
const day = t => new Date(t).toISOString().slice(0, 10);

// ---------- 行情 ----------
const dRaw = await j("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000");
const wRaw = await j("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1w&limit=1000");
const D = dRaw.map(k => ({ d: day(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7] }));
const W = wRaw.map(k => ({ d: day(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
const px = D.at(-1).c;
console.log("price", px, "daily", D.length, D[0].d, "→", D.at(-1).d, "| weekly", W.length, W[0].d);

// Mayer / 200DMA
const closes = D.map(x => x.c);
const ma200 = ma(closes, 200);
const mayer = px / ma200;
const mayerHist = [];
for (let i = 199; i < closes.length; i++) mayerHist.push(closes[i] / ma(closes, 200, i));
console.log("200DMA", ma200.toFixed(0), "Mayer", mayer.toFixed(3), "pct", pctRank(mayerHist, mayer),
  "hist p5/p50/p95", pctl(mayerHist, .05).toFixed(2), pctl(mayerHist, .5).toFixed(2), pctl(mayerHist, .95).toFixed(2));

// 200W MA
const wc = W.map(x => x.c);
const wma200 = ma(wc, 200);
console.log("200WMA", wma200 ? wma200.toFixed(0) : null, "ratio", wma200 ? (px / wma200).toFixed(3) : null);
const wma200Hist = [];
for (let i = 199; i < wc.length; i++) wma200Hist.push(wc[i] / ma(wc, 200, i));
console.log("  ratio hist p5/p50/p95", pctl(wma200Hist, .05).toFixed(2), pctl(wma200Hist, .5).toFixed(2), pctl(wma200Hist, .95).toFixed(2));

// ATH / drawdown
const ath = Math.max(...W.map(x => x.h));
const athWeek = W.find(x => x.h === ath).d;
console.log("ATH", ath, athWeek, "drawdown", ((px / ath - 1) * 100).toFixed(1) + "%");

// RSI14
function rsi(cl, n = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; d > 0 ? g += d : l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return 100 - 100 / (1 + g / (l || 1e-9));
}
console.log("RSI14", rsi(closes).toFixed(1));

// 30d 年化波动
const rets = [];
for (let i = closes.length - 30; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1));
const vol = sd * Math.sqrt(365);
const volHist = [];
for (let i = 240; i < closes.length; i += 1) {
  const rr = [];
  for (let k = i - 29; k <= i; k++) rr.push(Math.log(closes[k] / closes[k - 1]));
  const m2 = rr.reduce((a, b) => a + b, 0) / rr.length;
  volHist.push(Math.sqrt(rr.reduce((a, b) => a + (b - m2) ** 2, 0) / (rr.length - 1)) * Math.sqrt(365));
}
console.log("vol30a", (vol * 100).toFixed(1) + "%", "pct", pctRank(volHist, vol));

// 减半周期
const halvings = [
  ["2012-11-28", 0], ["2016-07-09", 0], ["2020-05-11", 0], ["2024-04-20", 0], ["2028-04-17", 1],
].map(([d]) => new Date(d));
const lastH = halvings[3], nextH = halvings[4];
const mSince = (Date.now() - lastH) / 864e5 / 30.44;
const mToNext = (nextH - Date.now()) / 864e5 / 30.44;
console.log("halving: since", mSince.toFixed(1), "mo; to next", mToNext.toFixed(1), "mo");

// ---------- 链上 ----------
const bc = async (chart, span) =>
  (await j(`https://api.blockchain.info/charts/${chart}?format=json&timespan=${span}&cors=true`)).values;
const [rev2y, vol2y, hash2y, revAll] = await Promise.all([
  bc("miners-revenue", "2years"),
  bc("estimated-transaction-volume-usd", "2years"),
  bc("hash-rate", "2years"),
  bc("miners-revenue", "all"),
]);
console.log("bc miners-rev 2y", rev2y.length, "vol 2y", vol2y.length, "hash 2y", hash2y.length, "rev all", revAll.length);

const revs = rev2y.map(x => x.y);
const revMA365 = ma(revs, 365);
const puell = revs.at(-1) / revMA365;
const puellHist = [];
for (let i = 364; i < revs.length; i++) puellHist.push(revs[i] / ma(revs, 365, i));
console.log("miner rev/day", (revs.at(-1) / 1e6).toFixed(1) + "M", "365MA", (revMA365 / 1e6).toFixed(1) + "M",
  "Puell", puell.toFixed(3), "pct", pctRank(puellHist, puell),
  "hist p5/p50/p95", pctl(puellHist, .05).toFixed(2), pctl(puellHist, .5).toFixed(2), pctl(puellHist, .95).toFixed(2));

// thermocap
const thermo = revAll.reduce((a, x) => a + x.y, 0);
console.log("thermocap(all sum)", (thermo / 1e9).toFixed(1) + "B", "points", revAll.length,
  "first", day(revAll[0].x * 1000), "last", day(revAll.at(-1).x * 1000));

// NVT: mcap / on-chain vol 90d MA
const cmBtc = await j("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMrktCurUSD,SplyCur&frequency=1d&page_size=1000&start_time=2024-11-01");
const mcapRows = cmBtc.data.map(r => ({ d: r.time.slice(0, 10), mc: +r.CapMrktCurUSD, sply: +r.SplyCur }));
console.log("cm btc rows", mcapRows.length, "last", mcapRows.at(-1));
const mcap = mcapRows.at(-1).mc;
const vmap = new Map(vol2y.map(x => [day(x.x * 1000), x.y]));
const nvtSeries = mcapRows.map(r => (vmap.has(r.d) ? r.mc / vmap.get(r.d) : null)).filter(Number.isFinite);
const nvt90 = mcap / ma(vol2y.map(x => x.y), 90);
console.log("mcap", (mcap / 1e12).toFixed(3) + "T", "vol/day", (vol2y.at(-1).y / 1e9).toFixed(2) + "B",
  "NVT(90d)", (nvt90).toFixed(1), "pct", pctRank(nvtSeries, nvt90),
  "hist p5/p50/p95", pctl(nvtSeries, .05).toFixed(0), pctl(nvtSeries, .5).toFixed(0), pctl(nvtSeries, .95).toFixed(0));

// MC / thermocap
const mcThermo = mcap / thermo;
const mcThermoHist = mcapRows.map(r => r.mc / thermo); // 热力市值当常数，只看估值波动
console.log("MC/thermocap", mcThermo.toFixed(2), "pct(2y)", pctRank(mcThermoHist, mcThermo));

// ---------- 稳定币 ----------
const cmSt = await j("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=usdt,usdc&metrics=CapMrktCurUSD&frequency=1d&page_size=1000&start_time=2025-11-01");
const stBy = {};
for (const r of cmSt.data) {
  const d = r.time.slice(0, 10);
  (stBy[d] ||= {})[r.asset] = +r.CapMrktCurUSD;
}
const stDays = Object.keys(stBy).sort();
const stTot = stDays.map(d => (stBy[d].usdt || 0) + (stBy[d].usdc || 0));
const stNow = stTot.at(-1), st30 = stTot[Math.max(0, stTot.length - 31)];
console.log("stablecoin", (stNow / 1e9).toFixed(1) + "B", "30d", ((stNow / st30 - 1) * 100).toFixed(2) + "%", "days", stDays.length);

// ---------- 情绪 ----------
const fng = (await j("https://api.alternative.me/fng/?limit=0&format=json")).data;
const fngVals = fng.map(x => +x.value);
console.log("F&G", fng[0].value, fng[0].value_classification, "pct", pctRank(fngVals, +fng[0].value), "hist p5/p50/p95",
  pctl(fngVals, .05), pctl(fngVals, .5), pctl(fngVals, .95), "rows", fng.length);

// ---------- 衍生品 ----------
const funding = await j("https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=BTC_USDT&limit=100");
const fRates = funding.map(x => +x.r);
const fAnn = fRates.slice(-90).reduce((a, b) => a + b, 0) / Math.min(90, fRates.length) * 3 * 365;
console.log("funding rows", fRates.length, "last", fRates.at(-1), "30d ann", (fAnn * 100).toFixed(1) + "%",
  "hist p5/p50/p95", pctl(fRates, .05), pctl(fRates, .5), pctl(fRates, .95));

const stats = await j("https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=BTC_USDT&interval=1d&limit=200");
const oi = stats.map(x => +x.open_interest_usd);
const oiChg30 = oi.at(-1) / oi[Math.max(0, oi.length - 31)] - 1;
const oiChgHist = [];
for (let i = 30; i < oi.length; i++) oiChgHist.push(oi[i] / oi[i - 30] - 1);
const lsr = stats.map(x => +x.lsr_account);
console.log("stats rows", stats.length, "OI", (oi.at(-1) / 1e9).toFixed(2) + "B", "30d", (oiChg30 * 100).toFixed(1) + "%",
  "pct", pctRank(oiChgHist, oiChg30), "LSR", lsr.at(-1).toFixed(2),
  "pct", pctRank(lsr, lsr.at(-1)), "lsr p5/p50/p95", pctl(lsr, .05).toFixed(2), pctl(lsr, .5).toFixed(2), pctl(lsr, .95).toFixed(2));

// ---------- 占比 ----------
const glob = await j("https://api.coinlore.net/api/global/");
console.log("global", JSON.stringify(glob[0]).slice(0, 300));

// ---------- 宏观 ----------
const cnbc = await j("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=US10Y&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1");
const q10 = cnbc.FormattedQuoteResult.FormattedQuote[0];
console.log("US10Y", q10.last, q10.change_pct);
const em = await j("https://push2.eastmoney.com/api/qt/ulist.np/get?secids=100.UDI,100.NDX&fields=f2,f3,f4,f12,f14&fltt=2&ut=fa5fd1943c7b386f172d6893dbfba10b");
console.log("eastmoney", JSON.stringify(em.data.diff));
