export type TowerMissionView = {
  id: string;
  title: string;
  status: string;
  branch?: string;
  owner?: string;
  completedTasks?: number;
  totalTasks?: number;
  blocker?: string;
};

export type TowerAgentView = {
  id: string;
  name?: string;
  kind: string;
  mission?: string;
  branch?: string;
  status?: string;
};

export type TowerActivityView = {
  id: string;
  at?: string | number;
  level?: string;
  message: string;
};

/** Renderer-facing projection of the official Tower snapshot. Unknown fields stay optional so a newer Kimi Code does not break the panel. */
export type TowerSnapshotView = {
  enabled: boolean;
  base?: string;
  owner?: string;
  mergedCount: number;
  totalCount: number;
  blockedCount: number;
  missions: TowerMissionView[];
  agents: TowerAgentView[];
  activity: TowerActivityView[];
  workDir?: string;
  message?: string;
};

export type TowerPreflightView = {
  allowed: boolean;
  reason?: string;
  base?: string;
  dirty: boolean;
  towerExists: boolean;
  openMissions: number;
  owner?: string;
  isGitRepository?: boolean;
  hasInitialCommit?: boolean;
  detachedHead?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function asText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function normalizeMission(value: unknown, index: number): TowerMissionView {
  const entry = asRecord(value);
  const tasks = asArray(entry.tasks).map(asRecord);
  const blockers = asArray(entry.blockers).map(asText).filter((item): item is string => Boolean(item));
  return {
    id: asText(entry.id) ?? asText(entry.missionId) ?? `mission-${index + 1}`,
    title: asText(entry.title) ?? "未命名任务",
    status: asText(entry.status) ?? "unknown",
    branch: asText(entry.branch),
    owner: asText(entry.owner),
    completedTasks: tasks.filter((task) => task.done === true).length,
    totalTasks: tasks.length,
    blocker: blockers[0],
  };
}

function normalizeAgent(value: unknown, index: number): TowerAgentView {
  const entry = asRecord(value);
  return {
    id: asText(entry.agentId) ?? `agent-${index + 1}`,
    name: asText(entry.name),
    kind: asText(entry.kind) ?? "worker",
    mission: asText(entry.missionId) ?? asText(entry.reviewTarget),
    branch: asText(entry.branch),
    status: asText(entry.status),
  };
}

function normalizeActivity(value: unknown, index: number): TowerActivityView {
  if (typeof value === "string") {
    return { id: `activity-${index + 1}`, message: value };
  }
  const entry = asRecord(value);
  return {
    id: asText(entry.id) ?? asText(entry.eventId) ?? `activity-${index + 1}`,
    at: asText(entry.at) ?? asText(entry.timestamp) ?? (typeof entry.timestamp === "number" ? entry.timestamp : undefined),
    level: asText(entry.level) ?? asText(entry.status),
    message: asText(entry.message) ?? asText(entry.summary) ?? asText(entry.content) ?? "Tower 状态已更新",
  };
}

export function normalizeTowerSnapshot(raw: unknown): TowerSnapshotView {
  const value = asRecord(raw);
  const roster = asRecord(value.roster);
  const ownership = asRecord(value.ownership);
  const missions = asArray(value.missions).map(normalizeMission);
  const agents = asArray(roster.agents).map(normalizeAgent);
  const activity = asArray(value.activity).map(normalizeActivity);
  const enabled = value.enabled === true;
  const mergedCount = missions.filter((mission) => mission.status === "merged").length;
  const blockedCount = missions.filter((mission) => /blocked|failed/i.test(mission.status) || Boolean(mission.blocker)).length;
  return {
    enabled,
    base: asText(value.base),
    owner: asText(ownership.ownerSessionId),
    mergedCount,
    totalCount: missions.length,
    blockedCount,
    missions,
    agents,
    activity,
    workDir: asText(value.repoRoot),
    message: asText(value.message),
  };
}

export function normalizeTowerPreflight(raw: unknown): TowerPreflightView {
  const value = asRecord(raw);
  const state = asRecord(value.state);
  const isGitRepository = value.isGitRepo;
  const hasInitialCommit = value.hasCommit;
  const detachedHead = value.detached;
  const explicitAllowed = value.canEnable;
  const hardBlocked = isGitRepository === false || hasInitialCommit === false || detachedHead === true;
  return {
    allowed: explicitAllowed === undefined ? !hardBlocked : explicitAllowed === true,
    reason: asText(value.reason) ?? asText(value.error) ?? asText(state.error) ?? asText(asArray(value.warnings)[0]),
    base: asText(value.branch),
    dirty: value.dirty === true,
    towerExists: state.exists === true,
    openMissions: asArray(state.openMissionIds).length,
    owner: asText(state.ownerSessionId),
    isGitRepository: typeof isGitRepository === "boolean" ? isGitRepository : undefined,
    hasInitialCommit: typeof hasInitialCommit === "boolean" ? hasInitialCommit : undefined,
    detachedHead: typeof detachedHead === "boolean" ? detachedHead : undefined,
  };
}

export function towerStatusLabel(status: string) {
  if (status === "planned") return "待执行";
  if (status === "active") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "blocked") return "受阻";
  if (status === "paused") return "已暂停";
  if (status === "merged") return "已合并";
  if (status === "abandoned") return "已放弃";
  return status || "未知";
}
