/**
 * Watch Kimix renderer event-loop lag via CDP; auto-capture a CPU profile
 * INLINE (same connection) when a stall is detected.
 *
 * Usage:
 *   node scripts/cdp-cpu-profile-on-lag.mjs
 *   node scripts/cdp-cpu-profile-on-lag.mjs --threshold-ms 500 --profile-seconds 12
 *
 * Env: KIMIX_CDP_PORT=9222
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const port = process.env.KIMIX_CDP_PORT || "9222";
const args = process.argv.slice(2);
const thresholdMs = Number(args.includes("--threshold-ms") ? args[args.indexOf("--threshold-ms") + 1] : 500) || 500;
const profileSeconds = Number(args.includes("--profile-seconds") ? args[args.indexOf("--profile-seconds") + 1] : 12) || 12;
const pollMs = Number(args.includes("--poll-ms") ? args[args.indexOf("--poll-ms") + 1] : 200) || 200;
const maxWaitMin = Number(args.includes("--max-wait-min") ? args[args.indexOf("--max-wait-min") + 1] : 60) || 60;
// After detecting lag, keep sampling this long (stall may continue or immediately follow).
const postLagSeconds = Number(args.includes("--post-lag-seconds") ? args[args.indexOf("--post-lag-seconds") + 1] : profileSeconds) || profileSeconds;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findPage(retries = 90) {
  for (let i = 0; i < retries; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = pages.find((p) =>
        p.type === "page" &&
        (String(p.title || "").includes("Kimix") || String(p.url || "").includes("index.html"))
      ) || pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page;
    } catch { /* retry */ }
    await sleep(1000);
  }
  throw new Error(`No Kimix page on :${port}`);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, 180_000);
    });
  }
  close() {
    try { this.ws.close(); } catch { /* */ }
  }
}

async function measureLag(cdp) {
  const expr = `(() => new Promise((resolve) => {
    const t0 = performance.now();
    setTimeout(() => {
      resolve({ lagMs: Math.round((performance.now() - t0) * 10) / 10, now: Date.now() });
    }, 0);
  }))()`;
  const result = await cdp.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error("lag eval failed");
  return result.result?.value || { lagMs: 0 };
}

function summarizeProfile(profile) {
  const nodes = profile.nodes || [];
  const samples = profile.samples || [];
  const timeDeltas = profile.timeDeltas || [];
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const selfMs = new Map();
  let totalMs = 0;
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const dt = (timeDeltas[i] || 0) / 1000;
    totalMs += dt;
    selfMs.set(nodeId, (selfMs.get(nodeId) || 0) + dt);
  }
  function callLabel(node) {
    const f = node.callFrame || {};
    const fn = f.functionName || "(anonymous)";
    const url = (f.url || "").replace(/^.*\//, "").slice(0, 100);
    const line = f.lineNumber >= 0 ? `:${f.lineNumber + 1}` : "";
    return `${fn} @ ${url}${line}`;
  }
  const totalByNode = new Map();
  for (const [nodeId, ms] of selfMs) {
    let cur = idToNode.get(nodeId);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      totalByNode.set(cur.id, (totalByNode.get(cur.id) || 0) + ms);
      cur = cur.parent ? idToNode.get(cur.parent) : null;
    }
  }
  const rows = [...selfMs.entries()]
    .map(([id, self]) => {
      const node = idToNode.get(id);
      return {
        selfMs: self,
        totalMs: totalByNode.get(id) || self,
        label: node ? callLabel(node) : String(id),
        url: node?.callFrame?.url || "",
        functionName: node?.callFrame?.functionName || "",
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs);
  const byScript = new Map();
  for (const row of rows) {
    const key = row.url
      ? row.url.replace(/^.*\//, "").slice(0, 120)
      : row.functionName.startsWith("(") ? row.functionName : "(other)";
    byScript.set(key, (byScript.get(key) || 0) + row.selfMs);
  }
  const scripts = [...byScript.entries()]
    .map(([name, ms]) => ({ name, selfMs: ms, pct: totalMs > 0 ? (ms / totalMs) * 100 : 0 }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 30);
  return {
    sampleCount: samples.length,
    nodeCount: nodes.length,
    durationMs: Math.round(totalMs),
    topSelf: rows.slice(0, 50),
    topTotal: [...rows].sort((a, b) => b.totalMs - a.totalMs).slice(0, 50),
    scripts,
  };
}

async function main() {
  console.log(`[lag-watch] port=${port} threshold=${thresholdMs}ms profile=${postLagSeconds}s poll=${pollMs}ms`);
  const page = await findPage();
  console.log(`[lag-watch] attached title=${page.title} url=${page.url}`);
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");
  // Always-on sampling so the stall window is already in the buffer when we notice lag.
  // Chromium keeps a rolling buffer while Profiler is started; we stop after post-lag window.
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  console.log("[lag-watch] profiler STARTED (continuous); waiting for stall…");

  const deadline = Date.now() + maxWaitMin * 60_000;
  let lastLog = 0;
  let peak = 0;
  const startedAt = Date.now();

  while (Date.now() < deadline) {
    let lagMs = 0;
    try {
      const sample = await measureLag(cdp);
      lagMs = Number(sample.lagMs) || 0;
    } catch (err) {
      console.warn("[lag-watch] measure failed:", err.message || err);
      await sleep(1000);
      continue;
    }
    peak = Math.max(peak, lagMs);
    const now = Date.now();
    if (now - lastLog > 5000) {
      console.log(`[lag-watch] alive lag=${lagMs}ms peak=${peak}ms uptime=${Math.round((now - startedAt) / 1000)}s`);
      lastLog = now;
    }
    if (lagMs >= thresholdMs) {
      console.log(`[lag-watch] STALL lag=${lagMs}ms ≥ ${thresholdMs}ms → keep sampling ${postLagSeconds}s then dump`);
      await sleep(postLagSeconds * 1000);
      const { profile } = await cdp.send("Profiler.stop");
      await cdp.send("Profiler.disable").catch(() => {});
      cdp.close();

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath = resolve(`docs/perf-cpu-profile-lag-${stamp}.json`);
      const summaryPath = outPath.replace(/\.json$/i, ".summary.json");
      await mkdir(dirname(outPath), { recursive: true });
      const summary = summarizeProfile(profile);
      await writeFile(outPath, JSON.stringify(profile));
      await writeFile(summaryPath, JSON.stringify({ triggerLagMs: lagMs, peakLagMs: peak, ...summary }, null, 2));

      console.log(`[lag-watch] wrote ${outPath}`);
      console.log(`[lag-watch] summary ${summaryPath} duration≈${summary.durationMs}ms samples=${summary.sampleCount}`);
      console.log("\n=== Top self time ===");
      for (const row of summary.topSelf.slice(0, 20)) {
        console.log(`  ${row.selfMs.toFixed(1).padStart(8)}ms  ${row.label}`);
      }
      console.log("\n=== Top scripts ===");
      for (const row of summary.scripts.slice(0, 15)) {
        console.log(`  ${row.selfMs.toFixed(1).padStart(8)}ms  ${row.pct.toFixed(1).padStart(5)}%  ${row.name}`);
      }
      return;
    }
    await sleep(pollMs);
  }

  await cdp.send("Profiler.stop").catch(() => {});
  cdp.close();
  console.error(`[lag-watch] timed out after ${maxWaitMin}min (peak lag ${peak}ms)`);
  process.exit(2);
}

main().catch((err) => {
  console.error("[lag-watch] FAILED:", err.message || err);
  process.exit(1);
});
