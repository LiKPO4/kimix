import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
  Zap,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { APP_VERSION } from "@/utils/appVersion";
import {
  getNextSettingsPageId,
  getSettingsPage,
  getSettingsPageForSection,
  searchSettings,
  SETTINGS_FOCUS_SECTION_EVENT,
  SETTINGS_PAGES,
  type SettingsPageId,
  type SettingsSectionId,
} from "./settingsNavigation";

const SETTINGS_GROUPS = ["基础设置", "Kimi Code", "高级"] as const;

export function SettingsPageIcon({ pageId, size = 16 }: { pageId: SettingsPageId; size?: number }) {
  if (pageId === "appearance") return <Sun size={size} />;
  if (pageId === "conversation") return <MessageSquare size={size} />;
  if (pageId === "account") return <ShieldCheck size={size} />;
  if (pageId === "models") return <Terminal size={size} />;
  if (pageId === "experiments") return <Zap size={size} />;
  if (pageId === "data") return <Archive size={size} />;
  if (pageId === "diagnostics") return <AlertCircle size={size} />;
  return <Settings size={size} />;
}

export function SettingsWorkspaceSidebar({ width, collapsed }: { width: number; collapsed: boolean }) {
  const activeSettingsPageId = useAppStore((state) => state.activeSettingsPageId);
  const setActiveSettingsPageId = useAppStore((state) => state.setActiveSettingsPageId);
  const setWorkspaceView = useAppStore((state) => state.setWorkspaceView);
  const [searchQuery, setSearchQuery] = useState("");
  const searchResults = useMemo(() => searchSettings(searchQuery), [searchQuery]);
  const navigationGroups = useMemo(() => (
    SETTINGS_GROUPS.map((group) => ({
      group,
      pages: SETTINGS_PAGES.filter((page) => page.group === group),
    }))
  ), []);

  const navigateToPage = (pageId: SettingsPageId) => {
    setActiveSettingsPageId(pageId);
  };

  const focusSettingsSection = (sectionId: SettingsSectionId) => {
    setActiveSettingsPageId(getSettingsPageForSection(sectionId));
    window.dispatchEvent(new CustomEvent(SETTINGS_FOCUS_SECTION_EVENT, {
      detail: { sectionId },
    }));
  };

  const handleNavigationKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    pageId: SettingsPageId,
  ) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextPageId = getNextSettingsPageId(
      pageId,
      event.key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End",
    );
    navigateToPage(nextPageId);
    document.querySelector<HTMLButtonElement>(`[data-settings-page-button="${nextPageId}"]`)?.focus();
  };

  if (collapsed) {
    return (
      <aside
        className="kimix-sidebar kimix-settings-workspace-sidebar is-collapsed shrink-0 bg-surface-ground"
        style={{
          display: "flex",
          width,
          height: "100%",
          minHeight: 0,
          flexDirection: "column",
          alignItems: "center",
          padding: "0 2px 16px 10px",
        }}
        aria-label="设置导航"
      >
        <button
          type="button"
          onClick={() => setWorkspaceView("chat")}
          className="kimix-settings-sidebar-icon-button kimix-settings-navigation-item"
          title="返回对话"
          aria-label="返回对话"
        >
          <ArrowLeft size={17} />
        </button>
        <nav className="kimix-settings-sidebar-collapsed-pages" aria-label="设置分类">
          {SETTINGS_PAGES.map((page) => (
            <button
              key={page.id}
              type="button"
              aria-current={activeSettingsPageId === page.id ? "page" : undefined}
              data-settings-page-button={page.id}
              className={`kimix-settings-sidebar-icon-button kimix-settings-navigation-item ${activeSettingsPageId === page.id ? "is-active" : ""}`}
              title={page.label}
              aria-label={page.label}
              onClick={() => navigateToPage(page.id)}
              onKeyDown={(event) => handleNavigationKeyDown(event, page.id)}
            >
              <SettingsPageIcon pageId={page.id} size={17} />
            </button>
          ))}
        </nav>
      </aside>
    );
  }

  return (
    <aside
      className="kimix-sidebar kimix-settings-workspace-sidebar flex h-full shrink-0 select-none flex-col"
      style={{ width, minHeight: 0, padding: "0 10px 12px 12px" }}
      aria-label="设置导航"
    >
      <div className="kimix-settings-sidebar-header">
        <button
          type="button"
          onClick={() => setWorkspaceView("chat")}
          className="kimix-settings-sidebar-back kimix-settings-navigation-item"
        >
          <ArrowLeft size={16} />
          <span>返回对话</span>
        </button>
        <div className="kimix-settings-sidebar-title">
          <Settings size={18} />
          <span>设置</span>
        </div>
      </div>

      <div className="kimix-settings-search is-sidebar">
        <Search size={15} aria-hidden="true" />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearchQuery("");
              return;
            }
            const firstResult = searchResults[0];
            if (event.key !== "Enter" || !firstResult) return;
            event.preventDefault();
            focusSettingsSection(firstResult.sectionId);
            setSearchQuery("");
          }}
          placeholder="搜索设置..."
          aria-label="搜索设置"
        />
      </div>

      <div className="kimix-settings-sidebar-scroll kimix-stable-scrollbar">
        {searchQuery.trim() ? (
          <div className="kimix-settings-search-results" aria-live="polite">
            <div className="kimix-settings-navigation-group-label">
              搜索结果 · {searchResults.length}
            </div>
            {searchResults.length > 0 ? searchResults.map((result) => (
              <button
                key={result.id}
                type="button"
                className="kimix-settings-search-result"
                onClick={() => {
                  focusSettingsSection(result.sectionId);
                  setSearchQuery("");
                }}
              >
                <span>{result.label}</span>
                <small>{getSettingsPage(result.pageId).label}</small>
              </button>
            )) : (
              <div className="kimix-settings-search-empty">没有匹配的设置</div>
            )}
          </div>
        ) : (
          <nav className="kimix-settings-navigation-groups" aria-label="设置分类">
            {navigationGroups.map(({ group, pages }) => (
              <div key={group} className="kimix-settings-navigation-group">
                <div className="kimix-settings-navigation-group-label">{group}</div>
                <div className="kimix-settings-navigation-items">
                  {pages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      aria-current={activeSettingsPageId === page.id ? "page" : undefined}
                      data-settings-page-button={page.id}
                      className={`kimix-settings-navigation-item ${activeSettingsPageId === page.id ? "is-active" : ""}`}
                      onClick={() => navigateToPage(page.id)}
                      onKeyDown={(event) => handleNavigationKeyDown(event, page.id)}
                    >
                      <SettingsPageIcon pageId={page.id} />
                      <span>{page.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="kimix-settings-sidebar-version">
        <span>Kimix</span>
        <span>v{APP_VERSION}</span>
      </div>
    </aside>
  );
}
