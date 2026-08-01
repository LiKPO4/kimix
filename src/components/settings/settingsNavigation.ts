import type { SettingsPageId } from "@/types/ui";

export type { SettingsPageId } from "@/types/ui";

export type SettingsSectionId =
  | "connection"
  | "auth"
  | "experiment"
  | "identity"
  | "model"
  | "theme"
  | "palette"
  | "permission"
  | "context"
  | "message"
  | "processDisplay"
  | "filePreview"
  | "newSession"
  | "notification"
  | "voice"
  | "archived"
  | "migration"
  | "freeze";

export type SettingsPageDefinition = {
  id: SettingsPageId;
  group: "基础设置" | "Kimi Code" | "高级";
  label: string;
  description: string;
  sections: SettingsSectionId[];
};

export type SettingsSearchResult = {
  id: string;
  label: string;
  description: string;
  pageId: SettingsPageId;
  sectionId: SettingsSectionId;
  keywords: string[];
};

export const SETTINGS_FOCUS_SECTION_EVENT = "kimix:focus-settings-section";

export const SETTINGS_PAGES: SettingsPageDefinition[] = [
  {
    id: "general",
    group: "基础设置",
    label: "常规",
    description: "管理通知、新对话建议、文件预览和系统输入。",
    sections: ["newSession", "notification", "filePreview", "voice"],
  },
  {
    id: "appearance",
    group: "基础设置",
    label: "外观",
    description: "调整界面主题、字号和色彩方案。",
    sections: ["theme", "palette"],
  },
  {
    id: "conversation",
    group: "基础设置",
    label: "对话与权限",
    description: "控制 Agent 权限、上下文信息和执行过程的展示方式。",
    sections: ["permission", "context", "message", "processDisplay"],
  },
  {
    id: "account",
    group: "Kimi Code",
    label: "账户与连接",
    description: "检查 Kimi Code 连接并管理当前登录状态。",
    sections: ["connection", "auth"],
  },
  {
    id: "models",
    group: "Kimi Code",
    label: "模型与供应商",
    description: "管理默认模型、Provider、连接凭据和思考能力。",
    sections: ["model"],
  },
  {
    id: "experiments",
    group: "高级",
    label: "实验功能",
    description: "管理仍在验证中的工具加载和多 Agent 能力。",
    sections: ["experiment"],
  },
  {
    id: "data",
    group: "高级",
    label: "数据管理",
    description: "恢复归档会话，或导入、导出本地会话数据。",
    sections: ["archived", "migration"],
  },
  {
    id: "diagnostics",
    group: "高级",
    label: "诊断",
    description: "查看房间投递身份和界面卡死诊断信息。",
    sections: ["identity", "freeze"],
  },
];

const SETTINGS_SEARCH_INDEX: SettingsSearchResult[] = [
  {
    id: "new-session",
    label: "新对话建议",
    description: "达到推荐轮数后提示开启新对话",
    pageId: "general",
    sectionId: "newSession",
    keywords: ["轮数", "上下文", "长会话"],
  },
  {
    id: "notifications",
    label: "桌面通知",
    description: "通知时机与通知正文",
    pageId: "general",
    sectionId: "notification",
    keywords: ["系统通知", "消息内容", "提醒"],
  },
  {
    id: "file-preview",
    label: "文件预览",
    description: "允许在项目中预览的文件类型",
    pageId: "general",
    sectionId: "filePreview",
    keywords: ["扩展名", "md", "txt", "文件类型"],
  },
  {
    id: "voice",
    label: "语音输入",
    description: "设置语音按钮触发的系统快捷键",
    pageId: "general",
    sectionId: "voice",
    keywords: ["麦克风", "快捷键", "Win+H"],
  },
  {
    id: "theme",
    label: "主题与字号",
    description: "浅色、深色和界面字号",
    pageId: "appearance",
    sectionId: "theme",
    keywords: ["外观", "字号", "深色", "浅色"],
  },
  {
    id: "palette",
    label: "色彩方案",
    description: "选择调色板，或扫描、管理 Kimi 官方主题",
    pageId: "appearance",
    sectionId: "palette",
    keywords: ["颜色", "调色板", "官方主题"],
  },
  {
    id: "permission",
    label: "权限模式",
    description: "控制 Agent 运行命令和修改文件的权限",
    pageId: "conversation",
    sectionId: "permission",
    keywords: ["审批", "完全访问", "自动批准"],
  },
  {
    id: "context",
    label: "上下文显示",
    description: "切换 Context 百分比或详细用量",
    pageId: "conversation",
    sectionId: "context",
    keywords: ["token", "tokens", "用量"],
  },
  {
    id: "message-info",
    label: "消息信息",
    description: "控制 Tokens 和 Context 状态胶囊",
    pageId: "conversation",
    sectionId: "message",
    keywords: ["状态", "每轮", "实时"],
  },
  {
    id: "process-display",
    label: "过程展示方式",
    description: "控制思考、工具过程和运行中折叠",
    pageId: "conversation",
    sectionId: "processDisplay",
    keywords: ["折叠", "展开", "工具", "思考"],
  },
  {
    id: "connection",
    label: "Kimi Code 连接",
    description: "查找并检查本机 Kimi Code",
    pageId: "account",
    sectionId: "connection",
    keywords: ["CLI", "路径", "安装", "检查"],
  },
  {
    id: "auth",
    label: "Kimi 登录",
    description: "登录或退出 Kimi Code 账户",
    pageId: "account",
    sectionId: "auth",
    keywords: ["账号", "认证", "OAuth", "退出"],
  },
  {
    id: "models",
    label: "模型与供应商",
    description: "配置默认模型、Provider、Base URL 和 API Key",
    pageId: "models",
    sectionId: "model",
    keywords: ["模型", "供应商", "provider", "base url", "api key", "context", "思考档位"],
  },
  {
    id: "tool-select",
    label: "MCP 工具按需加载",
    description: "使用 select_tools 减少上下文占用",
    pageId: "experiments",
    sectionId: "experiment",
    keywords: ["MCP", "select_tools", "提示词缓存"],
  },
  {
    id: "multi-agent",
    label: "多 Agent 房间",
    description: "控制 Composer 中的添加 Agent 入口",
    pageId: "experiments",
    sectionId: "experiment",
    keywords: ["房间", "协作", "Agent"],
  },
  {
    id: "archived",
    label: "归档对话",
    description: "恢复官方归档或清理本地归档记录",
    pageId: "data",
    sectionId: "archived",
    keywords: ["恢复", "会话", "历史"],
  },
  {
    id: "migration",
    label: "会话迁移",
    description: "导出或合并导入会话快照",
    pageId: "data",
    sectionId: "migration",
    keywords: ["备份", "导入", "导出", "zip", "json"],
  },
  {
    id: "identity",
    label: "房间投递身份诊断",
    description: "检查多 Agent 房间的消息投递身份",
    pageId: "diagnostics",
    sectionId: "identity",
    keywords: ["房间", "投递", "身份", "Agent"],
  },
  {
    id: "freeze",
    label: "卡死诊断",
    description: "查看和导出渲染进程卡死记录",
    pageId: "diagnostics",
    sectionId: "freeze",
    keywords: ["性能", "卡顿", "日志", "lag"],
  },
];

export function getSettingsPage(pageId: SettingsPageId) {
  return SETTINGS_PAGES.find((page) => page.id === pageId) ?? SETTINGS_PAGES[0];
}

export function getSettingsPageForSection(sectionId: SettingsSectionId): SettingsPageId {
  return SETTINGS_PAGES.find((page) => page.sections.includes(sectionId))?.id ?? "general";
}

export function searchSettings(query: string): SettingsSearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return SETTINGS_SEARCH_INDEX.filter((item) => (
    [item.label, item.description, ...item.keywords]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalized)
  ));
}

export function getNextSettingsPageId(
  currentPageId: SettingsPageId,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End",
): SettingsPageId {
  if (key === "Home") return SETTINGS_PAGES[0].id;
  if (key === "End") return SETTINGS_PAGES[SETTINGS_PAGES.length - 1].id;
  const currentIndex = Math.max(0, SETTINGS_PAGES.findIndex((page) => page.id === currentPageId));
  const direction = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
  return SETTINGS_PAGES[(currentIndex + direction + SETTINGS_PAGES.length) % SETTINGS_PAGES.length].id;
}
