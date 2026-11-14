// 拉 QQQ + 七姐妹的日K / 年K 到 data/，然后跑 build.mjs 重注离线快照
// 用法: node tools/fetch-data.mjs [--no-build]
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const CODES = [
  ["QQQ", "105.QQQ"], ["NVDA", "105.NVDA"], ["MSFT", "105.MSFT"], ["AAPL", "105.AAPL"],
  ["GOOGL", "105.GOOGL"], ["AMZN", "105.AMZN"], ["META", "105.META"], ["TSLA", "105.TSLA"],
  ["GOLD", "122.XAU"], ["SILVER", "122.XAG"]
];

const kline = (secid, klt, lmt) =>
  "https://push2his.eastmoney.com/api/qt/stock/kline/get" +
  `?secid=${secid}&klt=${klt}&fqt=1&beg=0&end=20500101&lmt=${lmt}` +
  "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": UA, referer: "https://quote.eastmoney.com/" } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return JSON.parse(await r.text());
}

const dir = path.join(root, "data");
fs.mkdirSync(dir, { recursive: true });

let failed = 0;
for (const [code, secid] of CODES) {
  for (const [suffix, klt, lmt] of [["kline", 101, 400], ["year", 106, 80]]) {
    const name = `${code.toLowerCase()}_${suffix}.json`;
    try {
      const j = await getJSON(kline(secid, klt, lmt));
      const rows = j?.data?.klines || [];
      if (!rows.length) throw new Error("没拿到 K 线");
      const last = rows[rows.length - 1].split(",");
      fs.writeFileSync(path.join(dir, name), JSON.stringify(j), "utf8");
      console.log(name.padEnd(16), rows.length, "根，最后", last[0], "收", last[2]);
    } catch (e) {
      failed++;
      console.error(name.padEnd(16), "失败：", e.message);
    }
  }
}

if (failed) console.error(`\n${failed} 项失败；其余已更新。`);

// 比特币：另一套数据源，单独一个脚本
try {
  await import("./fetch-btc.mjs");
} catch (e) {
  failed++;
  console.error("btc.json 拉取失败：", e.message);
}

if (!process.argv.includes("--no-build")) {
  await import("./build.mjs");
}
process.exitCode = failed ? 1 : 0;
