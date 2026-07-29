import { describe, expect, it } from "vitest";
import {
  getSettingsPage,
  getSettingsPageForSection,
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
  });

  it("未知页面安全回退到常规", () => {
    expect(getSettingsPage("general").id).toBe("general");
    expect(getSettingsPage("missing" as "general").id).toBe("general");
  });

  it("可按标题、说明和中英文关键词搜索", () => {
    expect(searchSettings("API Key").map((item) => item.id)).toContain("models");
    expect(searchSettings("卡顿").map((item) => item.id)).toContain("freeze");
    expect(searchSettings("上下文").map((item) => item.id)).toEqual(expect.arrayContaining(["new-session", "tool-select"]));
    expect(searchSettings("   ")).toEqual([]);
  });
});
