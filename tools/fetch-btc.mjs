// 拉比特币全套数据到 data/btc.json，供 build.mjs 注入离线快照
// 用法: node tools/fetch-btc.mjs
// 形状必须和 index.html 里的 fetchBtcBundle() 完全一致
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "data");
fs.mkdirSync(dir, { recursive: true });

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const dayOfMs = ms => new Date(ms).toISOString().slice(0, 10);

async function json(url, ms = 30000) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}
const safe = p => p.catch(e => { console.warn("  ! ", String(e.message).slice(0, 90)); return null; });

const CM = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics";

async function klines(interval, limit) {
  const gi = interval === "1w" ? "7d" : "1d";
  try {
    const raw = await json(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=BTC_USDT&interval=${gi}&limit=${limit}`);
    const out = raw.map(r => ({ t: dayOfMs(+r[0] * 1000), o: +r[5], h: +r[3], l: +r[4], c: +r[2], v: +r[6] }))
      .filter(b => b.c > 0).sort((a, b) => a.t.localeCompare(b.t));
    if (out.length < 50) throw new Error("gate-short");
    return out;
  } catch (e) {
    const raw = await json(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
    return raw.map(k => ({ t: dayOfMs(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).filter(b => b.c > 0);
  }
}

const CNBC = "https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol" +
  "?symbols=US10Y&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1";
const EM = "https://push2.eastmoney.com/api/qt/ulist.np/get" +
  "?secids=100.UDI,100.NDX&fltt=2&fields=f2,f3,f4,f12,f14&ut=fa5fd1943c7b386f172d6893dbfba10b";

const [daily, weekly, fngRaw, cmBtc, cmSt, cmIss, cmHash, vol2,
  funding, stats, globe, coins, us10y, em, ndxK] = await Promise.all([
    safe(klines("1d", 1000)),
    safe(klines("1w", 1000)),
    safe(json("https://api.alternative.me/fng/?limit=730&format=json")),
    safe(json(CM + "?assets=btc&metrics=CapMrktCurUSD,SplyCur&frequency=1d&page_size=1000&start_time=2024-11-01")),
    safe(json(CM + "?assets=usdt,usdc&metrics=CapMrktCurUSD&frequency=1d&page_size=1000&start_time=2025-11-01")),
    safe(json(CM + "?assets=btc&metrics=IssTotUSD&frequency=1d&page_size=10000&start_time=2010-01-01", 60000)),
    safe(json(CM + "?assets=btc&metrics=HashRate&frequency=1d&page_size=1000&start_time=2024-11-01")),
    safe(json("https://api.blockchain.info/charts/estimated-transaction-volume-usd?format=json&timespan=2years&cors=true", 20000)),
    safe(json("https://api.gateio.ws/api/v4/futures/usdt/funding_rate?contract=BTC_USDT&limit=100")),
    safe(json("https://api.gateio.ws/api/v4/futures/usdt/contract_stats?contract=BTC_USDT&interval=1d&limit=200")),
    safe(json("https://api.coinlore.net/api/global/")),
    safe(json("https://api.coinlore.net/api/tickers/?start=0&limit=12")),
    safe(json(CNBC)),
    safe(json(EM)),
    safe(json("https://push2his.eastmoney.com/api/qt/stock/kline/get" +
      "?secid=100.NDX&klt=101&fqt=1&beg=20240101&end=20500101&lmt=10000" +
      "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"))
  ]);

if (!daily || daily.length < 300) { console.error("日K拉取失败，退出"); process.exit(1); }

// ---- 拼成和浏览器端一致的结构 ----
const emq = {};
if (em && em.data && Array.isArray(em.data.diff)) em.data.diff.forEach(d => { emq[d.f12] = d; });
const q10 = us10y && us10y.FormattedQuoteResult && us10y.FormattedQuoteResult.FormattedQuote
  ? us10y.FormattedQuoteResult.FormattedQuote[0] : null;
const pf = v => { const n = parseFloat(String(v).replace(/[^0-9.+-]/g, "")); return isFinite(n) ? n : null; };

let ndxDev = null;
if (ndxK && ndxK.data && ndxK.data.klines) {
  const nc = ndxK.data.klines.map(s => +s.split(",")[2]).filter(v => v > 0);
  if (nc.length >= 200) {
    const last200 = nc.slice(-200).reduce((a, b) => a + b, 0) / 200;
    ndxDev = (nc[nc.length - 1] / last200 - 1) * 100;
  }
}

const mcRows = (cmBtc && cmBtc.data ? cmBtc.data : []).map(r => ({
  t: r.time.slice(0, 10), mc: +r.CapMrktCurUSD, sply: +r.SplyCur
})).filter(r => isFinite(r.mc) && r.mc > 0);

const stByDay = {};
if (cmSt && cmSt.data) for (const r of cmSt.data) {
  const d = r.time.slice(0, 10);
  (stByDay[d] ||= {})[r.asset] = +r.CapMrktCurUSD;
}
const stSeries = Object.keys(stByDay).sort()
  .map(d => ({ t: d, v: (stByDay[d].usdt || 0) + (stByDay[d].usdc || 0), both: !!(stByDay[d].usdt && stByDay[d].usdc) }))
  .filter(x => x.v > 0 && x.both).map(x => ({ t: x.t, v: x.v }));

const vals = x => (x && Array.isArray(x.values) ? x.values : [])
  .map(p => ({ t: dayOfMs(p.x > 1e12 ? p.x : p.x * 1000), y: p.y }))
  .filter(p => isFinite(p.y)).sort((a, b) => a.t.localeCompare(b.t));
const cmSer = (rows, key) => (rows && rows.data ? rows.data : [])
  .map(r => ({ t: r.time.slice(0, 10), y: +r[key] }))
  .filter(p => isFinite(p.y) && p.y > 0).sort((a, b) => a.t.localeCompare(b.t));

const round = (v, d) => (v == null || !isFinite(v) ? v : +v.toFixed(d));
/* 离线快照要控制体积：日K/周K 只留近 320 根；
   矿工发行收入只留近 800 天，更早的累加值单独存 issCum0，热力市值照样对得上 */
const trimBars = arr => (arr || []).slice(-320).map(b => ({
  t: b.t, o: round(b.o, 2), h: round(b.h, 2), l: round(b.l, 2), c: round(b.c, 2), v: round(b.v, 2)
}));
const issAll = cmSer(cmIss, "IssTotUSD");
const issKeep = 800;
const issCut = Math.max(0, issAll.length - issKeep);
const issCum0 = issAll.slice(0, issCut).reduce((a, x) => a + x.y, 0);

const bundle = {
  daily: trimBars(daily),
  weekly: trimBars(weekly),
  fng: (fngRaw && fngRaw.data ? fngRaw.data : [])
    .map(x => ({ t: dayOfMs(+x.timestamp * 1000), v: +x.value, c: x.value_classification }))
    .sort((a, b) => a.t.localeCompare(b.t)),
  chain: {
    iss: issAll.slice(issCut).map(x => ({ t: x.t, y: round(x.y, 0) })),
    issCum0: round(issCum0, 0),
    vol2: vals(vol2).map(x => ({ t: x.t, y: round(x.y, 0) })),
    hash: cmSer(cmHash, "HashRate").map(x => ({ t: x.t, y: round(x.y, 0) })),
    mcap: mcRows.map(r => ({ t: r.t, mc: round(r.mc, 0), sply: round(r.sply, 2) })),
    stable: stSeries.map(x => ({ t: x.t, v: round(x.v, 0) }))
  },
  gate: {
    funding: (funding || []).map(x => ({ t: +x.t * 1000, r: +x.r })).filter(x => isFinite(x.r)),
    stats: (stats || []).map(x => ({
      t: +x.time * 1000, oi: round(+x.open_interest_usd, 0), lsr: +x.lsr_account, px: +x.mark_price
    })).filter(x => isFinite(x.oi) && x.oi > 0).sort((a, b) => a.t - b.t)
  },
  globe: globe && globe[0] ? {
    btc_d: +globe[0].btc_d, eth_d: +globe[0].eth_d, total_mcap: +globe[0].total_mcap,
    mcap_chg: +globe[0].mcap_change
  } : null,
  coins: coins && Array.isArray(coins.data) ? coins.data : [],
  macro: {
    us10y: q10 ? pf(q10.last) : null,
    dxy: emq.UDI ? pf(emq.UDI.f2) : null,
    dxychg: emq.UDI ? pf(emq.UDI.f3) : null,
    ndx: emq.NDX ? pf(emq.NDX.f2) : null,
    ndxchg: emq.NDX ? pf(emq.NDX.f3) : null,
    ndxDev: round(ndxDev, 2)
  },
  ts: Date.now()
};

const out = path.join(dir, "btc.json");
fs.writeFileSync(out, JSON.stringify(bundle), "utf8");
console.log(`data/btc.json ${(fs.statSync(out).size / 1024).toFixed(0)} KB`,
  `日K ${bundle.daily.length}（${bundle.daily[0].t} → ${bundle.daily.at(-1).t}）`,
  `周K ${bundle.weekly.length}`, `发行 ${bundle.chain.iss.length}`,
  `恐贪 ${bundle.fng.length}`, `NVT转账额 ${bundle.chain.vol2.length}`,
  `宏观`, JSON.stringify(bundle.macro));
