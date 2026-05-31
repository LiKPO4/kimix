import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Minus,
  PanelLeft,
  PanelLeftOpen,
  Square,
  X,
} from "lucide-react";

type MenuAction =
  | "close-chat"
  | "new-window"
  | "new-chat"
  | "quick-chat"
  | "open-project"
  | "settings"
  | "about"
  | "logout"
  | "exit"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "select-all"
  | "toggle-sidebar"
  | "toggle-terminal"
  | "toggle-file-tree"
  | "open-browser-tab"
  | "reload-browser-page"
  | "toggle-diff-panel"
  | "find"
  | "previous-chat"
  | "next-chat"
  | "back"
  | "forward"
  | "zoom-in"
  | "zoom-out"
  | "actual-size"
  | "toggle-fullscreen"
  | "minimize"
  | "zoom-window"
  | "close-window"
  | "documentation"
  | "whats-new"
  | "automations"
  | "local-environments"
  | "worktrees"
  | "skills"
  | "mcp"
  | "troubleshooting"
  | "send-feedback"
  | "performance-trace"
  | "keyboard-shortcuts";

type MenuEntry =
  | { type: "separator" }
  | { type?: "item"; label: string; hint?: string; action: MenuAction; disabled?: boolean; note?: string };

const MENU_ITEMS: Record<string, MenuEntry[]> = {
  文件: [
    { label: "关闭对话", hint: "Ctrl+W", action: "close-chat" },
    { label: "新建窗口", hint: "Ctrl+Shift+N", action: "new-window", disabled: true, note: "新建窗口暂未接入" },
    { label: "新对话", hint: "Ctrl+N", action: "new-chat" },
    { label: "快速对话", hint: "Alt+Ctrl+N", action: "quick-chat" },
    { label: "打开项目...", hint: "Ctrl+O", action: "open-project" },
    { type: "separator" },
    { label: "设置...", hint: "Ctrl+逗号", action: "settings" },
    { type: "separator" },
    { label: "退出", action: "exit" },
  ],
  编辑: [
    { label: "撤销", hint: "Ctrl+Z", action: "undo" },
    { label: "重做", hint: "Ctrl+Y", action: "redo" },
    { type: "separator" },
    { label: "剪切", hint: "Ctrl+X", action: "cut" },
    { label: "复制", hint: "Ctrl+C", action: "copy" },
    { label: "粘贴", hint: "Ctrl+V", action: "paste" },
    { label: "删除", action: "delete" },
    { type: "separator" },
    { label: "全选", hint: "Ctrl+A", action: "select-all" },
  ],
  查看: [
    { label: "切换侧边栏", hint: "Ctrl+B", action: "toggle-sidebar" },
    { label: "打开终端", hint: "Ctrl+J", action: "toggle-terminal" },
    { label: "切换文件树", hint: "Ctrl+Shift+E", action: "toggle-file-tree", disabled: true, note: "文件树面板暂未实现" },
    { label: "打开浏览器标签页", hint: "Ctrl+T", action: "open-browser-tab", disabled: true, note: "内置浏览器页暂未实现" },
    { label: "重新载入页面", hint: "Ctrl+R", action: "reload-browser-page" },
    { label: "切换差异面板", hint: "Alt+Ctrl+B", action: "toggle-diff-panel" },
    { label: "查找", hint: "Ctrl+F", action: "find" },
    { type: "separator" },
    { label: "上一个对话", hint: "Ctrl+Shift+[", action: "previous-chat" },
    { label: "下一个对话", hint: "Ctrl+Shift+]", action: "next-chat" },
    { label: "后退", hint: "Ctrl+[", action: "back" },
    { label: "前进", hint: "Ctrl+]", action: "forward" },
    { type: "separator" },
    { label: "放大", hint: "Ctrl++", action: "zoom-in" },
    { label: "缩小", hint: "Ctrl+-", action: "zoom-out" },
    { label: "实际大小", hint: "Ctrl+0", action: "actual-size" },
    { type: "separator" },
    { label: "切换全屏", hint: "F11", action: "toggle-fullscreen" },
  ],
  窗口: [
    { label: "最小化", hint: "Ctrl+M", action: "minimize" },
    { label: "缩放", action: "zoom-window" },
    { label: "关闭窗口", action: "close-window" },
  ],
  帮助: [
    { label: "文档", action: "documentation" },
    { label: "更新", action: "whats-new" },
    { label: "插件", action: "skills" },
    { type: "separator" },
    { label: "发送反馈", action: "send-feedback" },
    { label: "键盘快捷键", hint: "Ctrl+/", action: "keyboard-shortcuts" },
  ],
};

interface TopMenuBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onMenuAction: (entry: MenuEntry) => void;
  hasUpdate: boolean;
  updateMessage?: string;
  updateLabel?: string;
  onOpenUpdates: () => void;
}

export function TopMenuBar({
  sidebarOpen,
  onToggleSidebar,
  onNavigateBack,
  onNavigateForward,
  onMenuAction,
  hasUpdate,
  updateMessage,
  updateLabel = "升级",
  onOpenUpdates,
}: TopMenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const close = () => setOpenMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    void window.api.isWindowMaximized().then((res) => {
      if (res.success) setIsMaximized(res.data);
    });
    return window.api.onWindowMaximizedChange((payload) => setIsMaximized(payload.maximized));
  }, []);

  const handleMenuClick = (entry: MenuEntry) => {
    setOpenMenu(null);
    onMenuAction(entry);
  };

  return (
    <header
      className="z-50 flex h-12 w-full shrink-0 items-center justify-between"
      style={{ WebkitAppRegion: "drag" as const, paddingLeft: 12, paddingRight: 0 }}
    >
      <div className="flex h-full items-center gap-7" style={{ WebkitAppRegion: "no-drag" as const }}>
        <div className="flex items-center gap-2 text-text-muted">
          <button
            onClick={onToggleSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
            style={{ marginLeft: 14 }}
            aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
          >
            {sidebarOpen ? <PanelLeft size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <button
            onClick={onNavigateBack}
            className="ml-2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
            aria-label="后退"
          >
            <ArrowLeft size={17} />
          </button>
          <button
            onClick={onNavigateForward}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
            aria-label="前进"
          >
            <ArrowRight size={17} />
          </button>
        </div>

        <nav className="flex items-center gap-1.5 text-[14px] text-text-primary">
          {Object.keys(MENU_ITEMS).map((menu) => (
            <div key={menu} className="relative" onMouseDown={(e) => e.stopPropagation()}>
              <button
                onClick={() => setOpenMenu((current) => (current === menu ? null : menu))}
                className={`kimix-top-menu-trigger ${openMenu === menu ? "is-active" : ""}`}
              >
                {menu}
              </button>
              {openMenu === menu && (
                <div className="kimix-top-menu absolute left-0 top-full z-[60] mt-2 min-w-[236px] overflow-hidden rounded-[15px] border border-border-subtle bg-surface-elevated py-3 text-[14px]">
                  {MENU_ITEMS[menu].map((item, index) =>
                    item.type === "separator" ? (
                      <div key={`separator-${index}`} className="my-2 border-t border-border-subtle" />
                    ) : (
                      <button
                        key={item.label}
                        onClick={() => handleMenuClick(item)}
                        style={{ paddingLeft: 24, paddingRight: 22, paddingTop: 10, paddingBottom: 10 }}
                        className={`flex min-h-10 w-full items-center justify-between gap-5 text-left leading-none transition-colors hover:bg-surface-hover ${
                          item.disabled ? "text-text-muted" : "text-text-primary"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint && <span className="shrink-0 text-[13px] text-text-muted">{item.hint}</span>}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
          {hasUpdate && (
            <button
              type="button"
              onClick={onOpenUpdates}
              className="kimix-top-menu-trigger flex items-center text-accent-primary"
              style={{ gap: 7, marginLeft: 4 }}
              title={updateMessage || "有新版本可用"}
              aria-label="打开更新窗口"
            >
              <ArrowUp size={14} />
              {updateLabel}
            </button>
          )}
        </nav>
      </div>

      <div className="flex items-center" style={{ WebkitAppRegion: "no-drag" as const, gap: 8 }}>
        <button
          onClick={() => window.api.minimizeWindow()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover"
          aria-label="最小化"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.api.maximizeWindow()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover"
          aria-label={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={() => window.api.closeWindow()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-accent-red/10 hover:text-accent-red"
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}

export type { MenuAction, MenuEntry };
