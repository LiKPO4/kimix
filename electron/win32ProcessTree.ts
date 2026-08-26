// Windows 进程表解析与“自有进程”识别，供能力安装前的二进制占用清理使用。
// 独立成纯逻辑模块（不引 electron）是为了让判定规则可以在 vitest 中直接测试。

export type Win32ProcessEntry = {
  name: string;
  pid: number;
  ppid: number;
};

/**
 * 解析 `Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ParentProcessId
 * | ConvertTo-Json -Compress` 的输出。单对象与数组都合法；无效条目跳过，
 * 输出非法（含被截断）时返回空表，让调用方安全地放弃预清理。
 */
export function parseWin32ProcessTable(output: string): Win32ProcessEntry[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const entries: Win32ProcessEntry[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const candidate = record as Record<string, unknown>;
    const name = typeof candidate.Name === "string" ? candidate.Name : "";
    const pid = typeof candidate.ProcessId === "number" && Number.isSafeInteger(candidate.ProcessId)
      ? candidate.ProcessId
      : Number.NaN;
    const ppid = typeof candidate.ParentProcessId === "number" && Number.isSafeInteger(candidate.ParentProcessId)
      ? candidate.ParentProcessId
      : Number.NaN;
    if (!name || !Number.isSafeInteger(pid) || !Number.isSafeInteger(ppid)) continue;
    entries.push({ name, pid, ppid });
  }
  return entries;
}

/**
 * 找出镜像名匹配且属于“本应用”的进程 PID：
 * 1. 当前进程的后代（本次实例经 SDK/Server 拉起的占用者）；
 * 2. 父进程已不存在的同名孤儿（上一实例退出后遗留的占用者）。
 * 父进程仍存活的非后代进程属于其他运行中的应用，一律不动，
 * 避免旧方案 taskkill /IM 按镜像名全局结束误杀其他 Kimi 系工具。
 */
export function collectOwnProcessIds(
  table: Win32ProcessEntry[],
  rootPid: number,
  processName: string,
): number[] {
  const byPid = new Map<number, Win32ProcessEntry>();
  for (const entry of table) byPid.set(entry.pid, entry);
  const target = processName.toLowerCase();
  const result: number[] = [];
  for (const entry of table) {
    if (entry.name.toLowerCase() !== target) continue;
    // 兜底：自身与系统关键进程永不入选，即使镜像名意外匹配。
    if (entry.pid === rootPid || entry.pid <= 4) continue;
    if (isDescendantOf(byPid, entry, rootPid) || !byPid.has(entry.ppid)) {
      result.push(entry.pid);
    }
  }
  return result;
}

function isDescendantOf(byPid: Map<number, Win32ProcessEntry>, entry: Win32ProcessEntry, rootPid: number): boolean {
  const seen = new Set<number>();
  let current: Win32ProcessEntry | undefined = entry;
  while (current && !seen.has(current.pid)) {
    if (current.pid === rootPid) return true;
    seen.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return false;
}
