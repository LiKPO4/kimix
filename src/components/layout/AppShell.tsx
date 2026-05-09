import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatThread } from "@/components/chat/ChatThread";
import { Composer } from "@/components/chat/Composer";
import { ContextBar } from "@/components/chat/ContextBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { ArrowLeft, ArrowRight, ChevronDown, Code2, Ellipsis, FolderOpen, GitBranch, Minus, PanelLeft, PanelRight, Play, Square, SquareTerminal, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

const MENU_ITEMS: Record<string, { label: string; hint?: string; disabled?: boolean }[]> = {
  文件: [
    { label: "新对话", hint: "Ctrl+N" },
    { label: "打开项目" },
    { label: "导出聊天", disabled: true },
  ],
  编辑: [
    { label: "复制", hint: "Ctrl+C" },
    { label: "粘贴", hint: "Ctrl+V" },
    { label: "清空输入", disabled: true },
  ],
  查看: [
    { label: "切换侧边栏", hint: "Ctrl+B" },
    { label: "聚焦输入框", hint: "Ctrl+K" },
    { label: "重置缩放", disabled: true },
  ],
  窗口: [
    { label: "最小化", disabled: true },
    { label: "重新载入", disabled: true },
  ],
  帮助: [
    { label: "关于 Kimix" },
    { label: "查看文档", disabled: true },
  ],
};

export function AppShell() {
  const currentSession = useAppStore((s) => s.currentSession);
  const currentProject = useAppStore((s) => s.currentProject);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const triggerFocusInput = useAppStore((s) => s.triggerFocusInput);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);

  useEffect(() => {
    const close = () => {
      setOpenMenu(null);
      setProjectMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const handleMenuAction = (menu: string, label: string) => {
    if (menu === "查看" && label === "切换侧边栏") toggleSidebar();
    if (menu === "查看" && label === "聚焦输入框") triggerFocusInput();
    setOpenMenu(null);
  };

  const sessionTitle = currentSession?.title || "新对话";
  const projectPath = currentProject?.path;
  const openProjectPath = () => {
    if (projectPath) void window.api.openProjectPath({ path: projectPath });
    setProjectMenuOpen(false);
  };
  const openProjectEditor = (editor: "vscode" | "trae" | "coder") => {
    if (projectPath) void window.api.openProjectEditor({ path: projectPath, editor });
    setProjectMenuOpen(false);
  };
  const openProjectTerminal = () => {
    if (projectPath) void window.api.openProjectTerminal({ path: projectPath });
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#f6f4ef] text-[15px] text-text-primary">
      <header className="z-50 flex h-12 w-full shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: "drag" as const }}>
        <div className="flex h-full items-center gap-7" style={{ WebkitAppRegion: "no-drag" as const }}>
          <div className="flex items-center gap-2 text-[#7d7972]">
            <button onClick={toggleSidebar} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="切换侧边栏" title="切换侧边栏">
              <PanelLeft size={17} />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="后退">
              <ArrowLeft size={17} />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="前进">
              <ArrowRight size={17} />
            </button>
          </div>

          <nav className="flex items-center gap-3 text-[14px] text-[#69645d]">
            {Object.keys(MENU_ITEMS).map((menu) => (
              <div key={menu} className="relative" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setOpenMenu((current) => current === menu ? null : menu)}
                  className={`rounded-lg px-4 py-2 transition-colors hover:bg-black/5 ${openMenu === menu ? "bg-black/5 text-[#1f1d1a]" : ""}`}
                >
                  {menu}
                </button>
                {openMenu === menu && (
                  <div className="absolute left-0 top-full z-[60] mt-1 w-[220px] overflow-hidden rounded-xl border border-[#e5e1d8] bg-white py-2.5 shadow-[0_14px_36px_rgba(25,23,20,0.14)]">
                    {MENU_ITEMS[menu].map((item) => (
                      <button
                        key={item.label}
                        disabled={item.disabled}
                        onClick={() => handleMenuAction(menu, item.label)}
                        style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 11, paddingBottom: 11 }}
                        className="flex w-full items-center justify-between gap-4 text-left text-[14px] leading-none text-[#26231f] transition-colors hover:bg-[#f3f1ec] disabled:cursor-not-allowed disabled:text-[#aaa49a] disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint && <span className="shrink-0 text-[12px] text-[#9a948b]">{item.hint}</span>}
                        {item.disabled && <span className="shrink-0 text-[12px] text-[#9a948b]">即将上线</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" as const }}>
          <button onClick={() => window.api.minimizeWindow()} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7d7972] transition-colors hover:bg-black/5" aria-label="最小化">
            <Minus size={14} />
          </button>
          <button onClick={() => window.api.maximizeWindow()} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7d7972] transition-colors hover:bg-black/5" aria-label="最大化">
            <Square size={12} />
          </button>
          <button onClick={() => window.api.closeWindow()} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7d7972] transition-colors hover:bg-accent-red/10 hover:text-accent-red" aria-label="关闭">
            <X size={14} />
          </button>
        </div>
      </header>

      <div style={{ paddingBottom: 0, paddingRight: 0 }} className="flex min-h-0 flex-1 gap-2">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-[#e5e1d8] bg-white shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#efebe3] bg-white" style={{ paddingLeft: 30, paddingRight: 30 }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="max-w-[300px] truncate text-[14px] font-medium text-[#24211d]">
                {sessionTitle}
              </div>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f]"
                title="更多"
                aria-label="更多"
              >
                <Ellipsis size={17} />
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-3.5 text-[#8a847a]">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f]"
                title="运行"
                aria-label="运行"
              >
                <Play size={15} />
              </button>
              <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                <div className={`flex h-9 min-w-[86px] items-center rounded-xl border border-[#e5e1d8] bg-white transition-colors hover:bg-[#f8f6f1] hover:text-[#3a362f] ${!projectPath ? "opacity-45" : ""}`}>
                  <button
                    onClick={openProjectPath}
                    disabled={!projectPath}
                    className="flex h-full flex-1 items-center justify-center gap-2 pl-5 pr-2 disabled:cursor-not-allowed"
                    title={currentProject?.path ?? "工作区"}
                    aria-label="在文件资源管理器中打开项目"
                  >
                    <FolderOpen size={18} className="shrink-0 text-[#d19a32]" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setProjectMenuOpen((value) => !value);
                    }}
                    disabled={!projectPath}
                    className="mr-2 flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/5 disabled:cursor-not-allowed"
                    title="打开方式"
                    aria-label="打开方式"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                {projectMenuOpen && (
                  <div className="absolute right-0 top-full z-40 mt-3 w-[288px] overflow-hidden rounded-xl border border-[#e5e1d8] bg-white py-3.5 text-[14px] text-[#2f2b26] shadow-[0_16px_36px_rgba(25,23,20,0.16)]">
                    <button onClick={() => openProjectEditor("vscode")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <Code2 size={17} className="w-6 shrink-0 text-[#3483eb]" />
                      <span>使用 VS Code 打开</span>
                    </button>
                    <button onClick={openProjectPath} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <FolderOpen size={17} className="w-6 shrink-0 text-[#d19a32]" />
                      <span>在文件资源管理器中打开</span>
                    </button>
                    <button onClick={openProjectTerminal} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <SquareTerminal size={17} className="w-6 shrink-0 text-[#777168]" />
                      <span>Terminal</span>
                    </button>
                    <button onClick={() => openProjectEditor("trae")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <GitBranch size={17} className="w-6 shrink-0 text-[#9a948b]" />
                      <span>使用 Trae 打开</span>
                    </button>
                    <button onClick={() => openProjectEditor("coder")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <Code2 size={17} className="w-6 shrink-0 text-[#9a948b]" />
                      <span>使用 Coder 打开</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={openProjectTerminal}
                disabled={!projectPath}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e5e1d8] transition-colors hover:bg-[#f8f6f1] hover:text-[#3a362f] disabled:cursor-not-allowed disabled:opacity-45"
                title="终端"
                aria-label="终端"
              >
                <SquareTerminal size={15} />
              </button>
              <button
                disabled
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5e1d8] text-[#8a847a] opacity-55"
                title="审查和 Diff（即将上线）"
                aria-label="审查和 Diff"
              >
                <PanelRight size={15} />
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ChatThread />
          </div>
          <div className="kimix-content-x shrink-0 bg-white pt-2" style={{ paddingBottom: 14 }}>
            <Composer />
            <ContextBar />
          </div>
        </main>
      </div>

      <SettingsPanel />
    </div>
  );
}
