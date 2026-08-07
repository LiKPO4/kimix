import type { KimiCodeListSessionsRequest, KimiCodeListSessionsResponse } from "../../electron/types/ipc";

// 启动恢复期间的会话目录扫描去重。
// 恢复主链与项目切换扫描会在同一启动窗口内对同一 workDir 各触发一次
// `listKimiCodeSessions`（主进程全量扫磁盘，单次耗时可达数百毫秒）。
// 这里按 workDir 做 in-flight promise 去重 + 短 TTL 缓存，让启动窗口内
// 每个 workDir 只扫一次，恢复链与目录 reconcile 共享同一次扫描结果。
// 约束：
// - 请求目前只有 workDir 一个参数，按它键控即代表参数一致；未来若新增
//   参数，键控必须把参数纳入，否则不得共享。
// - 只缓存成功结果；失败不缓存，允许后续调用重新扫描重试。
// - TTL 只覆盖启动窗口（两处调用间隔毫秒级）；过期后自动失效，后续
//   任何手动操作（切换项目、刷新列表）仍走完整 IPC 扫描。

const inFlightScans = new Map<string, Promise<KimiCodeListSessionsResponse>>();
const recentScans = new Map<string, { expiresAt: number; result: KimiCodeListSessionsResponse }>();
const RECENT_SCAN_TTL_MS = 5_000;

export function dedupeListKimiCodeSessions(
  request: KimiCodeListSessionsRequest,
  fetcher: (req: KimiCodeListSessionsRequest) => Promise<KimiCodeListSessionsResponse> = window.api.listKimiCodeSessions,
): Promise<KimiCodeListSessionsResponse> {
  const key = request.workDir ?? "";
  const cached = recentScans.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.result);
  }
  recentScans.delete(key);
  const pending = inFlightScans.get(key);
  if (pending) return pending;
  const scan = fetcher(request)
    .then((result) => {
      if (result.success) {
        recentScans.set(key, { expiresAt: Date.now() + RECENT_SCAN_TTL_MS, result });
      }
      return result;
    })
    .finally(() => {
      inFlightScans.delete(key);
    });
  inFlightScans.set(key, scan);
  return scan;
}
