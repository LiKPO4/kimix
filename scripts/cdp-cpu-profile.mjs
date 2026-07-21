/**
 * Capture a Chromium CPU profile from a running Kimix renderer via CDP.
 *
 * Prerequisites:
 *   Kimix started with remote-debugging-port 9222 (v2.16.85+ default).
 *
 * Usage:
 *   node scripts/cdp-cpu-profile.mjs                  # sample 12s immediately
 *   node scripts/cdp-cpu-profile.mjs --seconds 20
 *   node scripts/cdp-cpu-profile.mjs --wait            # wait until page is up, then sample
 *   node scripts/cdp-cpu-profile.mjs --out path.json
 *
 * Env:
 *   KIMIX_CDP_PORT=9222
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const port = process.env.KIMIX_CDP_PORT || "9222";
const args = process.argv.slice(2);
const seconds = Number(args.includes("--seconds") ? args[args.indexOf("--seconds") + 1] : 12) || 12;
const waitForPage = args.includes("--wait");
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const outPath = resolve(outArg || `docs/perf-cpu-profile-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listPages() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`);
  return res.json();
}

async function findKimixPage(retries = waitForPage ? 60 : 5) {
  for (let i = 0; i < retries; i++) {
    try {
      const pages = await listPages();
      const page = pages.find((p) =>
        p.type === "page" &&
        (String(p.title || "").includes("Kimix") ||
          String(p.url || "").includes("index.html") ||
          String(p.url || "").includes("localhost"))
      ) || pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  throw new Error(`No Kimix renderer page on 127.0.0.1:${port} after ${retries}s`);
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

  async open() {
    await new Promise((resolve, reject) => {
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
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 120_000);
    });
  }

  close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}

function summarizeProfile(profile) {
  const nodes = profile.nodes || [];
  const samples = profile.samples || [];
  const timeDeltas = profile.timeDeltas || [];
  const idToNode = new Map(nodes.map((n) => [n.id, n]));

  /** self time ms by node id */
  const selfMs = new Map();
  let totalMs = 0;
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    const dt = (timeDeltas[i] || 0) / 1000; // microseconds → ms
    totalMs += dt;
    selfMs.set(nodeId, (selfMs.get(nodeId) || 0) + dt);
  }

  function callLabel(node) {
    const f = node.callFrame || {};
    const fn = f.functionName || "(anonymous)";
    const url = (f.url || "").replace(/^.*\//, "").slice(0, 80);
    const line = f.lineNumber >= 0 ? `:${f.lineNumber + 1}` : "";
    return `${fn} @ ${url}${line}`;
  }

  /** accumulate self up the parent chain for "total" */
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
        samples: 0,
        label: node ? callLabel(node) : String(id),
        url: node?.callFrame?.url || "",
        functionName: node?.callFrame?.functionName || "",
      };
    })
    .sort((a, b) => b.selfMs - a.selfMs);

  const topSelf = rows.slice(0, 40);
  const topTotal = [...rows].sort((a, b) => b.totalMs - a.totalMs).slice(0, 40);

  // Bucket by script / category
  const byScript = new Map();
  for (const row of rows) {
    const key = row.url
      ? row.url.replace(/^.*\//, "").slice(0, 100)
      : row.functionName.startsWith("(") ? row.functionName : "(other)";
    byScript.set(key, (byScript.get(key) || 0) + row.selfMs);
  }
  const scripts = [...byScript.entries()]
    .map(([name, ms]) => ({ name, selfMs: ms, pct: totalMs > 0 ? (ms / totalMs) * 100 : 0 }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 25);

  return {
    sampleCount: samples.length,
    nodeCount: nodes.length,
    durationMs: Math.round(totalMs),
    topSelf,
    topTotal,
    scripts,
  };
}

async function main() {
  console.log(`[cdp-cpu-profile] port=${port} seconds=${seconds} wait=${waitForPage}`);
  const page = await findKimixPage();
  console.log(`[cdp-cpu-profile] page title=${page.title} url=${page.url}`);

  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();

  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 }); // 100µs → denser
  await cdp.send("Profiler.start");
  console.log(`[cdp-cpu-profile] sampling for ${seconds}s …`);
  await sleep(seconds * 1000);
  const { profile } = await cdp.send("Profiler.stop");
  await cdp.send("Profiler.disable").catch(() => {});
  cdp.close();

  const summary = summarizeProfile(profile);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(profile));
  const summaryPath = outPath.replace(/\.json$/i, ".summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`[cdp-cpu-profile] wrote ${outPath}`);
  console.log(`[cdp-cpu-profile] summary ${summaryPath}`);
  console.log(`[cdp-cpu-profile] duration≈${summary.durationMs}ms samples=${summary.sampleCount}`);
  console.log("\n=== Top self time ===");
  for (const row of summary.topSelf.slice(0, 15)) {
    console.log(`  ${row.selfMs.toFixed(1).padStart(8)}ms  ${row.label}`);
  }
  console.log("\n=== Top scripts (self) ===");
  for (const row of summary.scripts.slice(0, 12)) {
    console.log(`  ${row.selfMs.toFixed(1).padStart(8)}ms  ${row.pct.toFixed(1).padStart(5)}%  ${row.name}`);
  }
}

main().catch((err) => {
  console.error("[cdp-cpu-profile] FAILED:", err.message || err);
  process.exit(1);
});
