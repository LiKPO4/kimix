import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatThread } from "@/components/chat/ChatThread";
import { Composer } from "@/components/chat/Composer";
import { ContextBar } from "@/components/chat/ContextBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { ArrowLeft, ArrowRight, Minus, Square, X } from "lucide-react";
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
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const triggerFocusInput = useAppStore((s) => s.triggerFocusInput);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setOpenMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const handleMenuAction = (menu: string, label: string) => {
    if (menu === "查看" && label === "切换侧边栏") {
      toggleSidebar();
    }
    if (menu === "查看" && label === "聚焦输入框") {
      triggerFocusInput();
    }
    setOpenMenu(null);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#f6f4ef] text-[15px] text-text-primary">
      <header className="z-50 flex h-12 w-full shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: "drag" as const }}>
        <div className="flex h-full items-center gap-4" style={{ WebkitAppRegion: "no-drag" as const }}>
          <div className="flex items-center gap-1.5 text-[#7d7972]">
            <button className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="后退">
              <ArrowLeft size={17} />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="前进">
              <ArrowRight size={17} />
            </button>
          </div>

          <nav className="flex items-center gap-1 text-[14px] text-[#69645d]">
            {Object.keys(MENU_ITEMS).map((menu) => (
              <div key={menu} className="relative" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setOpenMenu((current) => current === menu ? null : menu)}
                  className={`rounded-lg px-2.5 py-1.5 transition-colors hover:bg-black/5 ${openMenu === menu ? "bg-black/5 text-[#1f1d1a]" : ""}`}
                >
                  {menu}
                </button>
                {openMenu === menu && (
                  <div className="absolute left-0 top-full z-[60] mt-1 w-52 overflow-hidden rounded-xl border border-[#e5e1d8] bg-white py-1 shadow-[0_14px_36px_rgba(25,23,20,0.14)]">
                    {MENU_ITEMS[menu].map((item) => (
                      <button
                        key={item.label}
                        disabled={item.disabled}
                        onClick={() => handleMenuAction(menu, item.label)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[14px] text-[#26231f] transition-colors hover:bg-[#f3f1ec] disabled:cursor-not-allowed disabled:text-[#aaa49a] disabled:hover:bg-transparent"
                      >
                        <span>{item.label}</span>
                        {item.hint && <span className="text-[12px] text-[#9a948b]">{item.hint}</span>}
                        {item.disabled && <span className="text-[12px] text-[#9a948b]">即将上线</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="pointer-events-none absolute left-1/2 max-w-[380px] -translate-x-1/2 truncate text-[14px] font-medium text-[#1f1d1a]">
          {currentSession?.title || "新对话"}
        </div>
        <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" as const }}>
          <button
            onClick={() => window.api.minimizeWindow()}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5 text-[#7d7972]"
            aria-label="最小化"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => window.api.maximizeWindow()}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5 text-[#7d7972]"
            aria-label="最大化"
          >
            <Square size={12} />
          </button>
          <button
            onClick={() => window.api.closeWindow()}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent-red/10 hover:text-accent-red text-[#7d7972]"
            aria-label="关闭"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-2 pb-2.5 pr-2.5">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-[#e5e1d8] bg-white shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
          <ContextBar />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ChatThread />
          </div>
          <div className="shrink-0 bg-white px-10 pb-4">
            <Composer />
          </div>
        </main>
      </div>

      <SettingsPanel />
    </div>
  );
}
