import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileUiStyleVariables,
  parseUiStyleDocument,
  UI_STYLE_ROLE_IDS,
  type UiStyleDocumentV1,
} from "../uiStyleContract";
import {
  BUILTIN_UI_STYLE_DOCUMENTS,
  buildUiStyleAiPrompt,
  canonicalizeCustomUiStyleDocument,
} from "../builtinUiStyleDocuments";

const flatTreatment = { surface: "transparent", border: "none", elevation: "none" } as const;

function documentFixture(): UiStyleDocumentV1 {
  return {
    schemaVersion: 1,
    id: "platinum-soft",
    name: "白金小圆角",
    description: "只描述界面质感，不包含颜色。",
    basedOn: "default",
    primitives: {
      radius: { small: 3, medium: 4, large: 6, card: 6, panel: 8, shell: 8, pill: 999 },
      border: { controlWidth: 1, surfaceWidth: 1, focusWidth: 2, style: "solid" },
      elevation: {
        control: { kind: "raised", depth: 1, highlightOpacity: 0.6, shadowOpacity: 0.1 },
        card: { kind: "raised", depth: 2, highlightOpacity: 0.5, shadowOpacity: 0.1 },
        popup: { kind: "floating", depth: 4, highlightOpacity: 0.5, shadowOpacity: 0.18 },
        field: { kind: "inset", depth: 1, highlightOpacity: 0.35, shadowOpacity: 0.14 },
      },
      motion: { hoverDuration: 120, panelDuration: 200, easing: "standard" },
    },
    roles: Object.fromEntries(UI_STYLE_ROLE_IDS.map((id) => [id, {
      radius: id === "popup" ? "panel" : "medium",
      resting: flatTreatment,
      hover: { surface: "hover", border: "subtle", elevation: "control" },
      active: { surface: "active", border: "default", elevation: "field" },
    }])) as UiStyleDocumentV1["roles"],
  };
}

describe("uiStyleDocumentV1Schema", () => {
  it("接受不包含颜色和任意 CSS 的完整语义风格", () => {
    const result = parseUiStyleDocument(documentFixture());
    expect(result.success).toBe(true);
  });

  it("拒绝颜色、选择器和其他未知字段", () => {
    const input = documentFixture() as UiStyleDocumentV1 & Record<string, unknown>;
    input.colors = { primary: "#ff00ff" };
    const result = parseUiStyleDocument(input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.join("\n")).toContain("Unrecognized key");
  });

  it("拒绝越界尺寸和不安全的自由字符串", () => {
    const input = documentFixture();
    input.primitives.radius.card = 120;
    const result = parseUiStyleDocument(input);
    expect(result.success).toBe(false);
  });

  it("允许基于内置风格仅覆盖部分角色，但拒绝未知角色", () => {
    const partial = documentFixture();
    partial.roles = { shell: partial.roles.shell };
    expect(parseUiStyleDocument(partial).success).toBe(true);
    expect(Object.keys(canonicalizeCustomUiStyleDocument(partial)?.roles ?? {})).toHaveLength(UI_STYLE_ROLE_IDS.length);

    const unknownRole = documentFixture() as unknown as { roles: Record<string, unknown> };
    unknownRole.roles.unknownPanel = unknownRole.roles.shell;
    expect(parseUiStyleDocument(unknownRole).success).toBe(false);
  });

  it("四套内置风格本身就是完整且合法的同版契约", () => {
    for (const document of Object.values(BUILTIN_UI_STYLE_DOCUMENTS)) {
      const result = parseUiStyleDocument(document);
      expect(result.success, document.id).toBe(true);
      expect(Object.keys(document.roles).sort()).toEqual([...UI_STYLE_ROLE_IDS].sort());
    }
  });

  it("AI 提示由当前角色目录生成、禁止自由 CSS 并优先要求创建 JSON 文件", () => {
    const prompt = buildUiStyleAiPrompt();
    for (const roleId of UI_STYLE_ROLE_IDS) expect(prompt).toContain(roleId);
    expect(prompt).toContain("忽略参考图中的颜色");
    expect(prompt).toContain("禁止出现颜色值、CSS、选择器、url() 或脚本");
    expect(prompt).toContain("description 必须简洁，不超过 48 个中文字符");
    expect(prompt).toContain("必须优先使用你可用的文件工具");
    expect(prompt).toContain("kimix-ui-style-<id>.json");
    expect(prompt).toContain("不要在对话中重复整份 JSON");
    expect(prompt).toContain("只有当当前环境确实没有文件写入能力时");
    expect(prompt).toContain('"schemaVersion": 1');
  });
});

describe("compileUiStyleVariables", () => {
  it("仅输出 --ui-* 变量并从当前主题语义色派生质感", () => {
    const variables = compileUiStyleVariables(documentFixture());
    expect(Object.keys(variables).every((key) => key.startsWith("--ui-"))).toBe(true);
    expect(variables["--ui-radius-card"]).toBe("6px");
    expect(variables["--ui-role-section-card-hover-background"]).toBe("var(--surface-hover)");
    expect(variables["--ui-role-section-card-hover-border"]).toBe("1px solid var(--border-subtle)");
    expect(variables["--ui-elevation-card"]).toContain("var(--text-primary)");
    expect(JSON.stringify(variables)).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(JSON.stringify(variables)).not.toContain("url(");
  });

  it("为角色缺省状态回退到 resting，保证状态契约完整", () => {
    const document = documentFixture();
    document.roles.shell = {
      radius: "shell",
      resting: { surface: "base", border: "default", elevation: "card" },
    };
    const variables = compileUiStyleVariables(document);
    expect(variables["--ui-role-shell-hover-background"]).toBe("var(--surface-base)");
    expect(variables["--ui-role-shell-selected-shadow"]).toBe(variables["--ui-role-shell-resting-shadow"]);
  });
});

describe("自定义风格 CSS 角色消费契约", () => {
  it("每一个公开角色都由固定选择器消费，避免 JSON 存在无效配置点", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toContain(':root[data-ui-style-contract="v1"] .kimix-app-shell-main');
    expect(css).not.toContain('@scope (:root[data-ui-style-contract="v1"])');
    expect(css).not.toContain(":is(:root:not([data-ui-style]), [data-ui-style])");
    for (const roleId of UI_STYLE_ROLE_IDS) {
      const kebab = roleId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(css, roleId).toContain(`--ui-role-${kebab}-`);
    }
    expect(css).toMatch(/\.kimix-settings-uistyle-desc\s*\{[^}]*-webkit-line-clamp:\s*2;[^}]*line-clamp:\s*2;/s);
  });
});
