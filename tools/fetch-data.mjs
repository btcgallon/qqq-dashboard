// 拉最新的 QQQ 日K / 年K 到 data/，然后跑 build.mjs 重注离线快照
// 用法: node tools/fetch-data.mjs [再跑 build]
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const kline = (secid, klt, lmt) =>
  "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
  `?secid=${secid}&klt=${klt}&fqt=1&beg=0&end=20500101&lmt=${lmt}` +
  "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, referer: "https://quote.eastmoney.com/" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const t = await r.text();
  return JSON.parse(t);
}

const jobs = [
  ["qqq_kline.json", kline("105.QQQ", 101, 400)],
  ["qqq_year.json", kline("105.QQQ", 106, 80)]
];

for (const [name, url] of jobs) {
  const j = await getJSON(url);
  const rows = j?.data?.klines || [];
  if (!rows.length) throw new Error(name + ": 没拿到 K 线");
  const last = rows[rows.length - 1].split(",");
  fs.writeFileSync(path.join(root, "data", name), JSON.stringify(j), "utf8");
  console.log(name, rows.length, "根，最后", last[0], "收", last[2]);
}

if (!process.argv.includes("--no-build")) {
  await import("./build.mjs");
}
