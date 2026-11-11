// 把最近 300 根日K注入 index.html，作为断网时的离线快照
// 用法：先更新 data/qqq_kline.json，再 node tools/build.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const htmlPath = path.join(root, "index.html");
const dataPath = path.join(root, "data", "qqq_kline.json");
const yearPath = path.join(root, "data", "qqq_year.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const rows = raw.data.klines.map(s => s.split(",")).slice(-300);
// [日期, 开, 收, 高, 低, 量]
const bars = rows.map(r => [r[0], +r[1], +r[2], +r[3], +r[4], Math.round(+r[5])]);
const payload = JSON.stringify(bars);

const yearRaw = JSON.parse(fs.readFileSync(yearPath, "utf8"));
// [日期, 收盘] —— yearlyStats 只需要收盘价
const years = yearRaw.data.klines.map(s => s.split(",")).map(r => [r[0], +r[2]]);
const yearPayload = JSON.stringify(years);

let html = fs.readFileSync(htmlPath, "utf8");
const re = /(<script id="fallback-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
if (!re.test(html)) {
  console.error("找不到 fallback-data 占位，未修改文件");
  process.exit(1);
}
html = html.replace(re, (_, open, _old, close) => open + payload + close);

const reYear = /(<script id="fallback-year" type="application\/json">)([\s\S]*?)(<\/script>)/;
if (!reYear.test(html)) {
  console.error("找不到 fallback-year 占位，未修改文件");
  process.exit(1);
}
html = html.replace(reYear, (_, open, _old, close) => open + yearPayload + close);

fs.writeFileSync(htmlPath, html, "utf8");
console.log(`已注入 ${bars.length} 根日K（${bars[0][0]} → ${bars[bars.length - 1][0]}）+ ${years.length} 根年K，index.html ${(html.length / 1024).toFixed(0)} KB`);
