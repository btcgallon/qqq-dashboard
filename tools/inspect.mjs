// 用 CDP 以指定视口打开看板：报告横向溢出元素、JS 异常，并截图
// 用法: node tools/inspect.mjs [宽] [高] [输出png]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const W = +(process.argv[2] || 430);
const H = +(process.argv[3] || 900);
// 第 4 个参数可能是开关（direct / proxy / fresh…），别把它当成截图路径
const FLAGS = new Set(["direct", "proxy", "fresh", "manualtest", "tickertest", "serveurl"]);
const OUT = process.argv[4] && !FLAGS.has(process.argv[4]) ? process.argv[4] : "";
const ROOT = path.resolve(import.meta.dirname, "..");
const CHROME = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome"
].find(p => fs.existsSync(p)) || "chrome";
let FILE = process.argv.includes("serveurl")
  ? "http://127.0.0.1:" + (process.env.PORT || 8791) + "/"
  : pathToFileURL(path.join(ROOT, "index.html")).href;
// TICKER=NVDA 时带 ?t= 打开，验证某只标的的直连
if (process.env.TICKER) FILE += "?t=" + encodeURIComponent(process.env.TICKER.toUpperCase());
const PORT = 9223;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 传 proxy 参数时让无头 Chrome 走本机 Clash，用来验证外部数据源
const chromeArgs = [
  "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`, "about:blank"
];
if (process.argv.includes("proxy")) chromeArgs.unshift("--proxy-server=http://127.0.0.1:7890");
// 系统代理开着但 Clash 没启动时，Chrome 会全部连不上；用 direct 绕过系统代理
if (process.argv.includes("direct")) chromeArgs.unshift("--no-proxy-server");

const chrome = spawn(CHROME, chromeArgs, { stdio: "ignore" });

let ws, id = 0;
const pending = new Map();
const errors = [];

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) break;
    } catch { /* retry */ }
    await sleep(250);
  }
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  const target = await t.json();

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    } else if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
    }
  };

  await send("Runtime.enable");
  await send("Page.enable");
  if (process.argv.includes("offline")) {
    await send("Network.enable");
    await send("Network.emulateNetworkConditions", {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0
    });
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: W < 600
  });
  await send("Page.navigate", { url: FILE });
  await sleep(+(process.env.WAIT || 7000));

  if (process.argv.includes("fresh")) {
    await send("Runtime.evaluate", {
      expression: "try{localStorage.removeItem('qqq-dash-news')}catch(e){}; refreshNews(true)",
      awaitPromise: true
    });
    await sleep(1500);
  }

  const expr = `(() => {
    const cw = document.documentElement.clientWidth;
    const out = { cw, sw: document.documentElement.scrollWidth, wide: [] };
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.right > cw + 2 && r.width > 40) {
        out.wide.push({
          tag: el.tagName.toLowerCase(),
          cls: String((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || ""),
          id: el.id || "", right: Math.round(r.right), width: Math.round(r.width)
        });
      }
    }
    out.wide = out.wide.slice(0, 12);
    out.state = {
      price: document.querySelector("#price")?.textContent,
      amt: document.querySelector("#todayAmt")?.textContent,
      planAction: document.querySelector("#planAction")?.textContent,
      planSub: document.querySelector("#planActionSub")?.textContent,
      planGate: document.querySelector("#planGate")?.textContent,
      cNow: state.metrics?.cNow,
      planRow0: (() => { const ps = planState(state.metrics); return ps.rows[0].price + " / " + (ps.rows[0].price / state.metrics.cNow - 1); })(),
      planSrc: (() => { const s = renderPlan.toString(); const i = s.indexOf("distTxt"); return i < 0 ? "NO distTxt" : s.slice(i - 60, i + 240); })(),
      planDebug: (() => {
        const tr = document.querySelector("#planBody tr");
        const ps = planState(state.metrics);
        return [tr.children[2].textContent, state.metrics.cNow <= ps.rows[0].price * 1.0005, ps.rows[0].price, state.metrics.cNow].join(" | ");
      })(),
      planRows: [...document.querySelectorAll("#planBody tr")].map(tr =>
        [...tr.children].map(td => td.textContent.trim()).join(" | ")),
      planTest: (() => {
        const plan = planFor();
        const orig = plan.t1Date;
        const cases = [];
        const matrix = [
          ["", 700], ["", 480], ["2026-08-01", 450], ["2026-11-01", 450],
          ["2026-08-01", 390], ["2026-11-01", 370], ["2026-08-01", 290],
          ["2026-08-01", 520], ["2026-08-01", 600]
        ];
        for (const [t1, px] of matrix) {
          plan.t1Date = t1;
          const ps = planState({ cNow: px });
          cases.push((t1 || "未记录") + " @" + px + ": " + ps.title +
            " | " + ps.hint + " | t2=" + ps.rows[1].state);
        }
        plan.t1Date = orig;
        return cases;
      })(),
      signal: (() => {
        const b = document.querySelector("#sigBadge");
        return {
          label: b && b.textContent,
          cls: b && b.className,
          score: document.querySelector("#sigScore") && document.querySelector("#sigScore").textContent,
          why: (document.querySelector("#sigWhy") || {}).textContent,
          meta: (document.querySelector("#sigMeta") || {}).textContent,
          rows: document.querySelectorAll("#indBody tr").length,
          items: [...document.querySelectorAll("#indBody tr:not(.grp)")].map(tr =>
            [...tr.children].map(td => td.textContent.trim()).join(" | ")),
          manualInputs: document.querySelectorAll("#manualGrid input").length,
          helpN: document.querySelectorAll("#indBody .ih[data-help]").length,
          help0: document.querySelector("#indBody .ih")?.dataset.help,
          extStamp: document.querySelector("#extStamp")?.textContent,
          srcs: [...document.querySelectorAll("#indBody .src")].map(s => s.className + ":" + s.textContent),
          extVals: state.ext,
          risks: [...document.querySelectorAll("#signalRiskList li")].map(li => li.textContent.replace(/\\s+/g, " "))
        };
      })(),
      dlgTest: (() => {
        const d = document.querySelector("#settingsDlg");
        document.querySelector("#settingsBtn").click();
        const opened = d.open === true || d.hasAttribute("open");
        const r = d.getBoundingClientRect();
        const cs = getComputedStyle(d);
        const out = [opened, Math.round(r.width), Math.round(r.height), cs.position, cs.display].join("|");
        document.querySelector("#cancelBtn").click();
        return out + "|closed=" + !(d.open === true || d.hasAttribute("open"));
      })(),
      safariProbe: (() => {
        const o = {};
        o.dateSpace = parseNewsDate("2026-11-11 09:30:00");
        o.dateRFC = parseNewsDate("Wed, 11 Nov 2026 09:30:00 GMT");
        o.store = typeof store.get + "/" + typeof store.set;
        o.dlgFallback = typeof document.querySelector("#settingsDlg").showModal;
        return o;
      })(),
      badge: document.querySelector("#verdictBadge")?.textContent,
      newsCnt: document.querySelector("#newsCnt")?.textContent,
      newsN: document.querySelectorAll("#newsList .news-item").length,
      newsFirst: [...document.querySelectorAll("#newsList .news-item")].slice(0, 3).map(a =>
        (a.querySelector(".bar")?.textContent || "") + " | " +
        (a.querySelector(".srctag")?.textContent || "") + " | " +
        (a.querySelector("h3")?.textContent || "").slice(0, 46) + " | " +
        (a.querySelector("h3 a")?.getAttribute("href") || "").slice(0, 30)),
      newsRail: (() => {
        const r = document.querySelector("#newsRail")?.getBoundingClientRect();
        return r ? [Math.round(r.left), Math.round(r.width), Math.round(r.height)].join("x") : "none";
      })(),
      yearPressed: [...document.querySelectorAll("#yearCurSeg button")].map(b => b.dataset.cur + ":" + b.getAttribute("aria-pressed")),
      yearLegend: document.querySelector("#legend4")?.textContent,
      yearPaths: document.querySelectorAll("#chart4 path").length,
      curTest: (() => {
        const orig = Object.assign({}, state.yearSel);
        const out = [];
        const probe = tag => out.push(tag + ": paths=" + document.querySelectorAll("#chart4 path").length +
          " legend=" + document.querySelector("#legend4").textContent);
        state.yearSel = { c: true, ma5: false, ma3: false, ma10: false, meet: false };
        drawYearChart(); probe("仅收盘");
        state.yearSel = { c: false, ma5: true, ma3: true, ma10: true, meet: true };
        drawYearChart(); probe("三条均线+碰线");
        state.yearSel = { c: false, ma5: false, ma3: false, ma10: false, meet: false };
        drawYearChart(); probe("全关(自动回落到收盘)");
        state.yearSel = Object.assign({}, orig);
        drawYearChart();
        return out;
      })(),
      live: document.querySelector("#liveTxt")?.textContent,
      xLabels: [...document.querySelectorAll("#chart2 text")].map(t => t.textContent),
      vb: document.querySelector("#chart2")?.getAttribute("viewBox")
    };
    return JSON.stringify(out);
  })()`;
  const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  console.log(res.result.value);

  if (process.argv.includes("jsonp")) {
    const jp = await send("Runtime.evaluate", {
      expression: "jsonpNews('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://feeds.a.dj.com/rss/RSSMarketsMain.xml') + '&count=3').then(j => 'status=' + j.status + ' items=' + (j.items || []).length).catch(e => 'ERR ' + e.message)",
      awaitPromise: true, returnByValue: true
    });
    console.log("JSONP test:", jp.result.value);
  }
  console.log("JS errors:", errors.length ? errors : "none");

  if (process.env.EVAL) {
    const r = await send("Runtime.evaluate", {
      expression: process.env.EVAL, awaitPromise: true, returnByValue: true
    });
    console.log("eval:", r.result.value ?? JSON.stringify(r.result));
  }

  if (process.argv.includes("ext")) {
    const r = await send("Runtime.evaluate", {
      expression: `(async () => {
        try { localStorage.removeItem('qqq-dash-ext'); } catch (e) { }
        const t0 = Date.now();
        while (state.extBusy && Date.now() - t0 < 150000) await new Promise(r => setTimeout(r, 700));
        state.ext = {}; state.extTs = 0; state.extFailed = [];
        await refreshExternal(true);
        return JSON.stringify({
          stamp: document.querySelector('#extStamp').textContent,
          vals: state.ext, failed: state.extFailed,
          srcs: [...document.querySelectorAll('#indBody .src')].map(s => s.className + ':' + s.textContent),
          meta: document.querySelector('#sigMeta').textContent,
          score: document.querySelector('#sigBadge').textContent + ' ' + document.querySelector('#sigScore').textContent
        });
      })()`,
      awaitPromise: true, returnByValue: true
    });
    console.log("ext test:", r.result.value);
  }

  if (process.argv.includes("tip")) {
    const r = await send("Runtime.evaluate", {
      expression: `(() => {
        const ih = document.querySelector('#indBody .ih');
        if (!ih) return 'no ih';
        ih.scrollIntoView({ block: 'center' });
        const rc = ih.getBoundingClientRect();
        ih.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: rc.left + 10, clientY: rc.top + 8 }));
        const tip = document.querySelector('#indTip');
        const tr = tip.getBoundingClientRect();
        const inside = tr.left >= 0 && tr.top >= 0 && tr.right <= innerWidth && tr.bottom <= innerHeight;
        const out1 = 'hover:on=' + tip.classList.contains('on') + ' inside=' + inside +
          ' box=' + [tr.left, tr.top, tr.width, tr.height].map(Math.round).join(',') +
          ' vp=' + innerWidth + 'x' + innerHeight + ' text=' + tip.textContent.slice(0, 24);
        ih.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
        const out2 = 'out:' + tip.classList.contains('on');
        ih.click();
        const out3 = 'click:' + tip.classList.contains('on');
        document.body.click();
        const out4 = 'bodyclick:' + tip.classList.contains('on');
        return [out1, out2, out3, out4].join(' | ');
      })()`,
      returnByValue: true
    });
    console.log("tip test:", r.result.value);
  }

  if (process.argv.includes("newstest")) {
    const r = await send("Runtime.evaluate", {
      expression: `(async () => {
        await refreshNews(true);
        const box = document.querySelector('#newsPinned');
        const list = document.querySelector('#newsList');
        const txt = el => (el ? el.textContent.replace(/\\s+/g, ' ').trim() : '');
        const read = () => ({
          pinnedHidden: box.hidden,
          pinned: txt(box),
          pinCount: box.querySelectorAll('.news-item').length,
          first3: [...list.querySelectorAll('.news-item')].slice(0, 3).map(a =>
            (a.querySelector('.srctag') || {}).textContent + ' · ' + (a.querySelector('.news-meta') || {}).textContent)
        });
        const before = read();
        const btn = box.querySelector('.unpin');
        let after = null, inList = null;
        if (btn) {
          const k = btn.dataset.k;
          btn.click();
          after = read();
          inList = [...list.querySelectorAll('h3')].some(h => (h.textContent || '').slice(0, 40) === k.slice(0, 40));
        }
        return JSON.stringify({ before, after, inList });
      })()`,
      awaitPromise: true, returnByValue: true
    });
    console.log("news test:", r.result.value);
  }

  if (process.argv.includes("manualtest")) {
    const r = await send("Runtime.evaluate", {
      expression: `(() => {
        const inp = document.querySelector('#manualGrid input[data-mkey="cape"]');
        const read = () => document.querySelector('#sigBadge').textContent + ' ' +
          document.querySelector('#sigScore').textContent;
        const before = read();
        inp.value = '15';
        document.querySelector('#manualSave').click();
        const after = read();
        document.querySelector('#manualReset').click();
        return before + ' -> ' + after + ' -> 恢复 ' + read();
      })()`,
      returnByValue: true
    });
    console.log("manual test:", r.result.value);
  }

  if (process.argv.includes("tickertest")) {
    const r = await send("Runtime.evaluate", {
      expression: `(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms));
        const snap = tag => ({
          tag, ticker: state.ticker, title: document.title,
          price: document.querySelector('#price').textContent,
          chg: document.querySelector('#chg').textContent.replace(/\\s+/g, ' ').trim(),
          kYear: document.querySelector('#kYear').textContent,
          yearSub: document.querySelector('#yearSub').textContent,
          planRow0: (() => { const tr = document.querySelector('#planBody tr');
            return tr ? [...tr.children].map(td => td.textContent.trim()).join(' | ') : '—'; })(),
          holdTitle: document.querySelector('#holdTitle').textContent,
          holdSub: document.querySelector('#holdSub').textContent,
          peerRows: document.querySelectorAll('#holdBody tr').length,
          peerCur: document.querySelectorAll('#holdBody tr.peer-cur').length,
          score: document.querySelector('#sigScore').textContent,
          badge: document.querySelector('#sigBadge').textContent,
          ma5Now: state.yearly && Math.round(state.yearly.ma5Now),
          notes: document.querySelectorAll('#noteList li:not(.empty)').length,
          noteSub: document.querySelector('#noteSub').textContent,
          selVal: document.querySelector('#tickerSel').value
        });
        const out = [snap('起始')];
        for (const c of ['NVDA', 'TSLA', 'QQQ']) {
          switchTicker(c);
          await wait(9000);
          out.push(snap('→' + c));
        }
        return JSON.stringify(out);
      })()`,
      awaitPromise: true, returnByValue: true
    });
    console.log("ticker test:", r.result.value);
  }

  if (process.argv.includes("showdlg")) {
    await send("Runtime.evaluate", { expression: "document.querySelector('#settingsBtn').click()" });
    await sleep(400);
  }

  if (OUT) {
    const nArg = i => {
      const v = +(process.argv[i] || NaN);
      return Number.isFinite(v) ? v : null;
    };
    let clipY = nArg(5);
    let clipH = nArg(6);
    let clipX = nArg(7) ?? 0;
    let clipW = nArg(8) ?? W;
    // 命名截屏：node tools/inspect.mjs 390 900 ind.png clipid indCard
    const ci = process.argv.indexOf("clipid");
    if (ci > 0) {
      const cid = process.argv[ci + 1];
      const rr = await send("Runtime.evaluate", {
        expression: `(() => { const e = document.getElementById(${JSON.stringify(cid)}); if (!e) return null;
          const r = e.getBoundingClientRect();
          return { y: r.top + window.scrollY, h: r.height }; })()`,
        returnByValue: true
      });
      const v = rr.result.value;
      if (v) { clipY = Math.max(0, Math.round(v.y) - 8); clipH = Math.ceil(v.h) + 16; clipX = 0; clipW = W; }
      else console.log("clipid: element not found ->", cid);
    }
    const params = { format: "png" };
    if (clipY != null && clipH != null) {
      params.captureBeyondViewport = true;
      params.clip = { x: clipX, y: clipY, width: clipW, height: clipH, scale: 1 };
    } else {
      params.captureBeyondViewport = true;
    }
    const shot = await send("Page.captureScreenshot", params);
    fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
    console.log("screenshot:", OUT);
  }
} catch (e) {
  console.error("inspect failed:", e.message);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  chrome.kill();
}
