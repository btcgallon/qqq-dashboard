// 零依赖本地静态服务器：给 Safari / 看板外部数据兜底用
// 用法: node tools/serve.mjs [端口]   （默认 8791，只监听 127.0.0.1）
//
// 除了静态文件，还提供一个 /__ext?u=<url> 中继：
//   - 只放行白名单域名（下面 ALLOW）
//   - 优先经本机 Clash（127.0.0.1:7890）出网，Clash 没开就直连
//   - 返回 text/plain + CORS *，页面里用同源 fetch 即可
// 这样即使浏览器没设代理，看板的 6 个 r.jina.ai 数据源也能抓全。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +(process.argv[2] || process.env.PORT || 8791);
const PROXY = process.env.HTTPS_PROXY || "http://127.0.0.1:7890";
const ALLOW = [
  "r.jina.ai",
  "www.multpl.com",
  "www.currentmarketvaluation.com",
  "www.aaii.com",
  "www.cboe.com",
  "fred.stlouisfed.org",
  "production.dataviz.cnn.io",
  "quote.cnbc.com"
];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

let proxyAlive = null;
function checkProxy() {
  if (proxyAlive != null) return Promise.resolve(proxyAlive);
  return new Promise(resolve => {
    const u = new URL(PROXY);
    const sock = net.connect(+u.port || 7890, u.hostname || "127.0.0.1");
    const done = ok => { try { sock.destroy(); } catch (e) { /* ignore */ } proxyAlive = ok; resolve(ok); };
    sock.setTimeout(1500, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

function curlGet(url, useProxy) {
  // Windows 自带 curl.exe；-x 走 Clash，-L 跟随跳转，--max-time 75 秒
  const args = ["-sS", "-L", "--max-time", "75", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qqq-dashboard"];
  if (useProxy) args.push("-x", PROXY);
  args.push(url);
  return new Promise(resolve => {
    execFile("curl", args, { maxBuffer: 24 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout);
    });
  });
}

async function relay(req, res) {
  const q = String(req.url || "");
  const i = q.indexOf("?");
  const params = new URLSearchParams(i >= 0 ? q.slice(i + 1) : "");
  const target = params.get("u") || "";
  let host = "";
  try { host = new URL(target).hostname.toLowerCase(); } catch (e) { host = ""; }

  const send = (code, body, type = "text/plain; charset=utf-8") => {
    res.writeHead(code, {
      "content-type": type,
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    });
    res.end(body);
  };

  if (!host || !ALLOW.includes(host)) return send(400, "blocked host: " + host);

  const useProxy = await checkProxy();
  const text = await curlGet(target, useProxy);
  if (text == null) return send(502, "upstream failed" + (useProxy ? " (via proxy)" : ""));
  console.log("[relay]", useProxy ? "proxy" : "direct", target.slice(0, 90), "->", text.length, "bytes");
  return send(200, text);
}

http.createServer((req, res) => {
  const u = String(req.url || "/");
  if (u.startsWith("/__ext")) return relay(req, res);

  let rel;
  try {
    rel = decodeURIComponent(u.split("?")[0]);
  } catch (e) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    return res.end("bad request");
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.resolve(ROOT, "." + rel);
  if (file !== ROOT && !file.toLowerCase().startsWith(ROOT.toLowerCase() + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return res.end("forbidden");
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("not found");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(buf);
  });
}).listen(PORT, "127.0.0.1", () => {
  console.log("QQQ 看板: http://localhost:" + PORT + "/   （Ctrl+C 结束）");
  console.log("外部数据中继: /__ext?u=…  （经 Clash " + PROXY + "，没开就直连）");
});
