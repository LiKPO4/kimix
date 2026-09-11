/**
 * 滚动期间抓 devtools.timeline trace：统计 Layout/Paint/UpdateLayerTree/Composite
 * 等主线程渲染开销 + 帧间隔。Usage: node scripts/cdp-scroll-trace.mjs [--seconds 12]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const port = process.env.KIMIX_CDP_PORT || "9222";
const args = process.argv.slice(2);
const seconds = Number(args.includes("--seconds") ? args[args.indexOf("--seconds") + 1] : 12) || 12;
const outPath = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : `docs/perf-scroll-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === "page" && String(p.title || "").includes("Kimix"))
    || pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("no Kimix page");
  return page;
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.traceEvents = [];
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.method === "Tracing.dataCollected") {
        for (const e of msg.params.value) this.traceEvents.push(e);
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve: ok, reject: bad } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? bad(new Error(JSON.stringify(msg.error))) : ok(msg.result);
      }
    });
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((ok, bad) => {
      this.pending.set(id, { resolve: ok, reject: bad });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  }
}

const page = await findPage();
const cdp = new Cdp(page.webSocketDebuggerUrl);
await cdp.open();
await cdp.send("Runtime.enable");

const dom = await cdp.eval(`(() => {
  const scroller = [...document.querySelectorAll("*")].filter((el) => {
    const s = getComputedStyle(el);
    return (s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 100
      && String(el.className).includes("chat-scroll");
  })[0];
  return scroller ? { totalNodes: document.querySelectorAll("*").length, chatNodes: scroller.querySelectorAll("*").length, scrollHeight: scroller.scrollHeight } : null;
})()`);
console.log("== dom ==", JSON.stringify(dom));

await cdp.eval(`(() => {
  window.__kimixFramesStop = false;
  window.__kimixFrames = { count: 0, slow16: 0, slow32: 0, slow100: 0, worst: 0, total: 0, _last: 0 };
  const tick = (t) => {
    const f = window.__kimixFrames;
    if (f._last) { const d = t - f._last; f.count++; f.total += d; if (d > 16.7) f.slow16++; if (d > 32) f.slow32++; if (d > 100) f.slow100++; if (d > f.worst) f.worst = Math.round(d); }
    f._last = t;
    if (!window.__kimixFramesStop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`);

const tracingDone = new Promise((res) => {
  const orig = cdp.ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method === "Tracing.tracingComplete") res();
  });
});
await cdp.send("Tracing.start", {
  categories: "devtools.timeline",
  options: "sampling-frequency-10000",
});
console.log(`tracing ${seconds}s while wheel-scrolling...`);

const cx = 780, cy = 380;
const end = Date.now() + seconds * 1000;
let up = true;
while (Date.now() < end) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: cx, y: cy, deltaX: 0, deltaY: up ? -640 : 640 });
  await sleep(90);
  if (Math.random() < 0.08) up = !up;
}
await cdp.send("Tracing.end");
await tracingDone;
const frames = await cdp.eval(`window.__kimixFramesStop = true, (() => { const f = window.__kimixFrames; return { count: f.count, avgMs: f.count ? +(f.total / f.count).toFixed(1) : 0, slow16: f.slow16, slow32: f.slow32, slow100: f.slow100, worst: f.worst }; })()`);

// 聚合 complete 事件（ph:"X"）耗时
const byName = new Map();
for (const e of cdp.traceEvents) {
  if (e.ph !== "X" || typeof e.dur !== "number") continue;
  const cur = byName.get(e.name) || { totalMs: 0, count: 0, max: 0 };
  cur.totalMs += e.dur / 1000;
  cur.count++;
  if (e.dur / 1000 > cur.max) cur.max = e.dur / 1000;
  byName.set(e.name, cur);
}
const top = [...byName.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 25)
  .map(([name, s]) => ({ name, totalMs: +s.totalMs.toFixed(1), count: s.count, maxMs: +s.max.toFixed(1) }));

console.log("== frames ==", JSON.stringify(frames));
console.log("== main-thread rendering events (total ms over trace) ==");
for (const t of top) console.log(`${String(t.totalMs).padStart(8)}ms  x${String(t.count).padStart(5)}  max ${String(t.maxMs).padStart(7)}ms  ${t.name}`);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ dom, frames, top, traceEvents: cdp.traceEvents.length }, null, 2));
console.log("saved:", outPath, `(events: ${cdp.traceEvents.length})`);
process.exit(0);
