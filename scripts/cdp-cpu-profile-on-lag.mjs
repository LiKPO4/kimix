/**
 * Watch Kimix renderer event-loop lag via CDP; auto-capture a CPU profile
 * when a stall is detected.
 *
 * Usage:
 *   node scripts/cdp-cpu-profile-on-lag.mjs
 *   node scripts/cdp-cpu-profile-on-lag.mjs --threshold-ms 800 --profile-seconds 10
 *
 * Env: KIMIX_CDP_PORT=9222
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = process.env.KIMIX_CDP_PORT || "9222";
const args = process.argv.slice(2);
const thresholdMs = Number(args.includes("--threshold-ms") ? args[args.indexOf("--threshold-ms") + 1] : 800) || 800;
const profileSeconds = Number(args.includes("--profile-seconds") ? args[args.indexOf("--profile-seconds") + 1] : 10) || 10;
const pollMs = Number(args.includes("--poll-ms") ? args[args.indexOf("--poll-ms") + 1] : 250) || 250;
const maxWaitMin = Number(args.includes("--max-wait-min") ? args[args.indexOf("--max-wait-min") + 1] : 45) || 45;

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      }, 60_000);
    });
  }
  close() {
    try { this.ws.close(); } catch { /* */ }
  }
}

async function measureLag(cdp) {
  // Two wall-clock samples around a 0-delay timer on the renderer main thread.
  // If the event loop is busy, the timer fires late → lagMs > 0.
  const expr = `(() => new Promise((resolve) => {
    const t0 = performance.now();
    setTimeout(() => {
      const lag = performance.now() - t0;
      resolve({ lagMs: Math.round(lag * 10) / 10, now: Date.now() });
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

function runProfileCapture(outPath) {
  return new Promise((resolve, reject) => {
    const script = resolve(__dirname, "cdp-cpu-profile.mjs");
    const child = spawn(process.execPath, [script, "--seconds", String(profileSeconds), "--out", outPath], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`profile exit ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  console.log(`[lag-watch] port=${port} threshold=${thresholdMs}ms profile=${profileSeconds}s poll=${pollMs}ms maxWait=${maxWaitMin}min`);
  const page = await findPage();
  console.log(`[lag-watch] attached title=${page.title}`);
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Runtime.enable");

  const deadline = Date.now() + maxWaitMin * 60_000;
  let lastLog = 0;
  let peak = 0;
  let hits = 0;

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
      console.log(`[lag-watch] alive lag=${lagMs}ms peak=${peak}ms`);
      lastLog = now;
    }
    if (lagMs >= thresholdMs) {
      hits += 1;
      console.log(`[lag-watch] STALL hit#${hits} lag=${lagMs}ms ≥ ${thresholdMs}ms → capturing CPU profile…`);
      cdp.close();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outPath = resolve(`docs/perf-cpu-profile-lag-${stamp}.json`);
      await mkdir(dirname(outPath), { recursive: true });
      await runProfileCapture(outPath);
      console.log(`[lag-watch] done → ${outPath}`);
      console.log("[lag-watch] open the .summary.json next to it for top stacks");
      return;
    }
    await sleep(pollMs);
  }

  cdp.close();
  console.error(`[lag-watch] timed out after ${maxWaitMin}min (peak lag ${peak}ms). No profile captured.`);
  process.exit(2);
}

main().catch((err) => {
  console.error("[lag-watch] FAILED:", err.message || err);
  process.exit(1);
});
