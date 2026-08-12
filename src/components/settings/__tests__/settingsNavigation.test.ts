import { describe, expect, it } from "vitest";
import {
  getSettingsPage,
  getSettingsPageForSection,
  getNextSettingsPageId,
  searchSettings,
  SETTINGS_PAGES,
} from "../settingsNavigation";

describe("settingsNavigation", () => {
  it("为每个设置分区提供唯一页面归属", () => {
    const sections = SETTINGS_PAGES.flatMap((page) => page.sections);
    expect(new Set(sections).size).toBe(sections.length);
    expect(getSettingsPageForSection("model")).toBe("models");
    expect(getSettingsPageForSection("auth")).toBe("account");
    expect(getSettingsPageForSection("freeze")).toBe("diagnostics");
    expect(getSettingsPageForSection("palette")).toBe("appearance");
    expect(getSettingsPageForSection("uiStyle")).toBe("appearance");
    expect(getSettingsPageForSection("display")).toBe("appearance");
  });

  it("未知页面安全回退到常规", () => {
    expect(getSettingsPage("general").id).toBe("general");
    expect(getSettingsPage("missing" as "general").id).toBe("general");
  });

  it("可按标题、说明和中英文关键词搜索", () => {
    expect(searchSettings("API Key").map((item) => item.id)).toContain("models");
    expect(searchSettings("卡顿").map((item) => item.id)).toContain("freeze");
    expect(searchSettings("调色板").map((item) => item.id)).toEqual(["palette"]);
    expect(searchSettings("界面字号").map((item) => item.id)).toEqual(["display"]);
    expect(searchSettings("复古").map((item) => item.id)).toEqual(["ui-style"]);
    expect(searchSettings("上下文").map((item) => item.id)).toEqual(expect.arrayContaining(["new-session", "tool-select"]));
    expect(searchSettings("   ")).toEqual([]);
  });

  it("支持循环方向键和 Home/End 设置导航", () => {
    expect(getNextSettingsPageId("general", "ArrowUp")).toBe("diagnostics");
    expect(getNextSettingsPageId("general", "ArrowRight")).toBe("appearance");
    expect(getNextSettingsPageId("models", "Home")).toBe("general");
    expect(getNextSettingsPageId("models", "End")).toBe("diagnostics");
  });
});
