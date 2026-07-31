// 侧边栏项目会话列表的折叠窗口：默认只展示最近 5 个会话，超出折叠为“展开剩余 N 个对话”。
// 对齐官方 Kimi Code 行为；当前打开会话若在折叠区外则自动展开，保证其始终可见。

export const SIDEBAR_SESSION_LIST_COLLAPSE_COUNT = 5;

export type SidebarSessionListWindow<T> = {
  /** 是否处于折叠态（只显示前 collapseCount 个） */
  collapsed: boolean;
  /** 实际要渲染的会话（折叠时为前 collapseCount 个） */
  shownSessions: T[];
  /** 被折叠隐藏的会话数量（未超阈值时为 0） */
  hiddenCount: number;
  /** 当前打开会话是否落在折叠区之外（触发自动展开保护） */
  currentOutsideFirst: boolean;
  /** 是否显示尾部折叠/收起入口 */
  showToggle: boolean;
};

export function resolveSidebarSessionListWindow<T extends { id: string }>(
  projectSessions: T[],
  currentSessionId: string | undefined,
  manuallyExpanded: boolean,
  collapseCount = SIDEBAR_SESSION_LIST_COLLAPSE_COUNT,
): SidebarSessionListWindow<T> {
  const overThreshold = projectSessions.length > collapseCount;
  const currentOutsideFirst = Boolean(
    currentSessionId
    && overThreshold
    && projectSessions.some((session) => session.id === currentSessionId)
    && !projectSessions.slice(0, collapseCount).some((session) => session.id === currentSessionId),
  );
  const collapsed = overThreshold && !manuallyExpanded && !currentOutsideFirst;
  return {
    collapsed,
    shownSessions: collapsed ? projectSessions.slice(0, collapseCount) : projectSessions,
    hiddenCount: Math.max(0, projectSessions.length - collapseCount),
    currentOutsideFirst,
    // 折叠时显示“展开剩余”；仅当用户手动展开（非当前会话保护）且超阈值时才显示“收起”
    showToggle: collapsed || (manuallyExpanded && !currentOutsideFirst && overThreshold),
  };
}
