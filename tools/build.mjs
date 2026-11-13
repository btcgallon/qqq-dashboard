// 把每只标的最近 300 根日K + 全部年K注入 index.html，作为断网时的离线快照
// 用法：先 node tools/fetch-data.mjs --no-build 更新 data/，再 node tools/build.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const htmlPath = path.join(root, "index.html");
const dir = path.join(root, "data");

const CODES = ["QQQ", "NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "TSLA"];
// QQQ 沿用最早的 id，其余 fallback-NVDA / fallback-year-NVDA
const elId = (code, year) =>
  code === "QQQ" ? (year ? "fallback-year" : "fallback-data")
    : (year ? "fallback-year-" : "fallback-") + code;

let html = fs.readFileSync(htmlPath, "utf8");
const patched = [];

for (const code of CODES) {
  const kPath = path.join(dir, `${code.toLowerCase()}_kline.json`);
  const yPath = path.join(dir, `${code.toLowerCase()}_year.json`);
  if (!fs.existsSync(kPath)) { console.error(`${code}: 缺 ${kPath}，跳过`); continue; }

  const raw = JSON.parse(fs.readFileSync(kPath, "utf8"));
  const rows = raw.data.klines.map(s => s.split(",")).slice(-300);
  // [日期, 开, 收, 高, 低, 量]
  const bars = rows.map(r => [r[0], +r[1], +r[2], +r[3], +r[4], Math.round(+r[5])]);
  const payload = JSON.stringify(bars);

  let yearPayload = "[]";
  if (fs.existsSync(yPath)) {
    const yRaw = JSON.parse(fs.readFileSync(yPath, "utf8"));
    // [日期, 收盘] —— yearlyStats 只需要收盘价
    yearPayload = JSON.stringify(yRaw.data.klines.map(s => s.split(",")).map(r => [r[0], +r[2]]));
  }

  let ok = true;
  for (const [name, data] of [[elId(code, false), payload], [elId(code, true), yearPayload]]) {
    const re = new RegExp(`(<script id="${name}" type="application/json">)([\\s\\S]*?)(</script>)`);
    if (!re.test(html)) { console.error(`找不到 ${name} 占位，${code} 未注入`); ok = false; break; }
    html = html.replace(re, (_, open, _old, close) => open + data + close);
  }
  if (ok) patched.push(`${code} ${rows.length}根(${rows[0][0]} → ${rows[rows.length - 1][0]})`);
}

/* 比特币的离线快照：整包 JSON 直接塞进 fallback-BTC */
const btcPath = path.join(dir, "btc.json");
if (fs.existsSync(btcPath)) {
  const payload = fs.readFileSync(btcPath, "utf8");
  const re = /(<script id="fallback-BTC" type="application\/json">)([\s\S]*?)(<\/script>)/;
  if (re.test(html)) {
    html = html.replace(re, (_, open, _old, close) => open + payload + close);
    patched.push(`BTC 离线快照 ${(payload.length / 1024).toFixed(0)}KB`);
  } else {
    console.error("找不到 fallback-BTC 占位，BTC 未注入");
  }
} else {
  console.error("缺 data/btc.json，BTC 离线快照跳过");
}

fs.writeFileSync(htmlPath, html, "utf8");
console.log("已注入：" + patched.join("，"));
console.log(`index.html ${(html.length / 1024).toFixed(0)} KB`);
