import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compileUiStyleVariables,
  DEFAULT_UI_STYLE_PALETTE,
  parseUiStyleDocument,
  UI_STYLE_DESCRIPTION_MAX_LENGTH,
  UI_STYLE_ROLE_RADIUS_MAX_PX,
  UI_STYLE_ROLE_GUIDE,
  UI_STYLE_ROLE_IDS,
  type UiStyleDocumentV1,
} from "../uiStyleContract";
import {
  BUILTIN_UI_STYLE_DOCUMENTS,
  buildUiStyleAiPrompt,
  canonicalizeCustomUiStyleDocument,
  normalizeCustomUiStyleDocuments,
} from "../builtinUiStyleDocuments";

const flatTreatment = { surface: "transparent", border: "none", elevation: "none" } as const;

function documentFixture(): UiStyleDocumentV1 {
  return {
    schemaVersion: 1,
    id: "platinum-soft",
    name: "白金小圆角",
    description: "只描述界面质感，不包含颜色。",
    basedOn: "default",
    palette: { primary: "#4B6FA8", surface: "#D8DEE8", accent: "#A05A6C" },
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
  it("接受携带受控三色色组且不包含任意 CSS 的完整语义风格", () => {
    const result = parseUiStyleDocument(documentFixture());
    expect(result.success).toBe(true);
  });

  it("旧风格缺少 palette 时自动迁移为项目默认暖纸色组", () => {
    const legacy = { ...documentFixture() } as Partial<UiStyleDocumentV1>;
    delete legacy.palette;

    const parsed = parseUiStyleDocument(legacy);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.palette).toEqual(DEFAULT_UI_STYLE_PALETTE);
    expect(normalizeCustomUiStyleDocuments([legacy])[0].palette).toEqual(DEFAULT_UI_STYLE_PALETTE);
  });

  it("拒绝不完整、非十六进制或带额外字段的风格色组", () => {
    const invalidHex = { ...documentFixture(), palette: { primary: "blue", surface: "#D8DEE8", accent: "#A05A6C" } };
    expect(parseUiStyleDocument(invalidHex).success).toBe(false);
    const extraColor = { ...documentFixture(), palette: { ...documentFixture().palette, text: "#111111" } };
    expect(parseUiStyleDocument(extraColor).success).toBe(false);
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

  it("新导入描述硬限制为 48 字，历史存量安全截断后继续保留", () => {
    const overlong = documentFixture();
    overlong.description = "长".repeat(UI_STYLE_DESCRIPTION_MAX_LENGTH + 1);

    const rejected = parseUiStyleDocument(overlong);
    expect(rejected.success).toBe(false);
    if (!rejected.success) expect(rejected.errors.join("\n")).toContain("description 不能超过 48 个字符");
    expect(canonicalizeCustomUiStyleDocument(overlong)).toBeNull();
    const migrated = normalizeCustomUiStyleDocuments([overlong]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].description).toHaveLength(UI_STYLE_DESCRIPTION_MAX_LENGTH);
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

  it("复合按钮静止态保持基线克制，悬停遗漏 elevation 时继承普通控件材质", () => {
    const input = documentFixture();
    input.roles.control = {
      radius: "medium",
      resting: { surface: "base", border: "default", elevation: "control" },
      hover: { surface: "hover", border: "default", elevation: "control" },
    };
    input.roles.compoundControl = {
      radius: "medium",
      resting: { surface: "base", border: "default", elevation: "none" },
      hover: { surface: "hover", border: "default", elevation: "none" },
    };
    const harmonized = canonicalizeCustomUiStyleDocument(input);
    expect(harmonized?.roles.compoundControl?.resting).toEqual(flatTreatment);
    expect(harmonized?.roles.compoundControl?.hover?.elevation).toBe("control");

    input.roles.compoundControl.resting = { surface: "transparent", border: "none", elevation: "none" };
    const deliberatelyFlat = canonicalizeCustomUiStyleDocument(input);
    expect(deliberatelyFlat?.roles.compoundControl?.resting.elevation).toBe("none");
  });

  it("基于怀旧风格导入时，复合按钮静止态继承普通控件而非内置浮雕复合板", () => {
    const input = documentFixture();
    input.basedOn = "nostalgia";
    input.roles.compoundControl = {
      radius: "pill",
      resting: { surface: "elevated", border: "strong", elevation: "control" },
      hover: { surface: "hover", border: "strong", elevation: "control" },
    };

    const normalized = canonicalizeCustomUiStyleDocument(input);
    expect(normalized?.roles.compoundControl?.resting).toEqual(flatTreatment);
    expect(normalized?.roles.compoundControl?.radius).toBe("pill");
    expect(normalized?.roles.compoundControl?.hover).toEqual(input.roles.compoundControl.hover);
  });

  it("导入风格的普通按钮静止态继承内置基线，仅悬停与选中保留自定义强调", () => {
    const input = documentFixture();
    const loudResting = { surface: "elevated", border: "strong", elevation: "control" } as const;
    const loudHover = { surface: "hover", border: "strong", elevation: "control" } as const;
    const loudSelected = { surface: "active", border: "strong", elevation: "field" } as const;
    for (const roleId of ["navigationItem", "navigationAction", "control", "compoundControl", "toggle", "menuTrigger", "menuItem", "roomChoice"] as const) {
      input.roles[roleId] = {
        radius: "pill",
        resting: loudResting,
        hover: loudHover,
        selected: loudSelected,
      };
    }
    input.roles.primaryAction = { radius: "pill", resting: loudResting, hover: loudHover };

    const normalized = canonicalizeCustomUiStyleDocument(input);
    for (const roleId of ["navigationItem", "navigationAction", "control", "compoundControl", "toggle", "menuTrigger", "menuItem", "roomChoice"] as const) {
      expect(normalized?.roles[roleId]?.resting, roleId).toEqual(flatTreatment);
      expect(normalized?.roles[roleId]?.hover, roleId).toEqual(loudHover);
      expect(normalized?.roles[roleId]?.selected, roleId).toEqual(loudSelected);
    }
    expect(normalized?.roles.primaryAction?.resting).toEqual(loudResting);
  });

  it("开启与菜单选中态继承复古基线深度，且保留导入的表面与边框", () => {
    const input = documentFixture();
    input.basedOn = "nostalgia";
    const flatSelected = { surface: "active", border: "subtle", elevation: "none" } as const;
    for (const roleId of ["toggle", "menuTrigger", "menuItem", "roomChoice"] as const) {
      input.roles[roleId] = {
        radius: "pill",
        resting: { surface: "transparent", border: "none", elevation: "none" },
        selected: flatSelected,
      };
    }

    const normalized = canonicalizeCustomUiStyleDocument(input);
    for (const roleId of ["toggle", "menuTrigger", "menuItem", "roomChoice"] as const) {
      expect(normalized?.roles[roleId]?.resting, roleId).toEqual(flatTreatment);
      expect(normalized?.roles[roleId]?.selected, roleId).toEqual({ ...flatSelected, elevation: "field" });
      expect(normalized?.roles[roleId]?.radius, roleId).toBe("pill");
    }
  });

  it("导入角色未写 selected 时继承复古基线选中态，而不是退回安静 resting", () => {
    const input = documentFixture();
    input.basedOn = "nostalgia";
    input.roles.toggle = {
      radius: "pill",
      resting: { surface: "base", border: "subtle", elevation: "none" },
      hover: { surface: "hover", border: "subtle", elevation: "control" },
    };

    const normalized = canonicalizeCustomUiStyleDocument(input);
    expect(normalized?.roles.toggle?.resting).toEqual(flatTreatment);
    expect(normalized?.roles.toggle?.selected).toEqual(BUILTIN_UI_STYLE_DOCUMENTS.nostalgia.roles.toggle?.selected);
    expect(normalized?.roles.toggle?.selected?.elevation).toBe("field");
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
    for (const roleId of UI_STYLE_ROLE_IDS) expect(prompt).toContain(`- ${roleId}: ${UI_STYLE_ROLE_GUIDE[roleId]}`);
    expect(prompt).toContain("palette 必须提供 primary、surface、accent");
    expect(prompt).toContain("除 palette 三个字段外");
    expect(prompt).toContain("禁止出现其他颜色值、CSS、选择器、url() 或脚本");
    expect(prompt).toContain("description 必须简洁，硬性上限为 48 个字符");
    expect(prompt).toContain("超出后 Kimix 会拒绝导入");
    expect(prompt).not.toContain("240 个");
    expect(prompt).toContain("必须优先使用你可用的文件工具");
    expect(prompt).toContain("kimix-ui-style-<id>.json");
    expect(prompt).toContain("不要在对话中重复整份 JSON");
    expect(prompt).toContain("只有当当前环境确实没有文件写入能力时");
    expect(prompt).toContain("未写角色由 basedOn 自动继承");
    expect(prompt).toContain("Composer 内层 textarea 永远无边框");
    expect(prompt).toContain("顶部 compoundControl 的 resting");
    expect(prompt).toContain("普通交互角色");
    expect(prompt).toContain("非透明 selected 必须保持立体 elevation");
    expect(prompt).toContain("复古与怀旧通常为按下内凹");
    expect(prompt).toContain("只在悬停、展开或选中时醒目");
    expect(prompt).toContain("对比度是硬指标");
    expect(prompt).toContain("禁止所有容器共用同一 surface 且 border 全 none");
    expect(prompt).toContain("状态反馈必须可感知");
    expect(prompt).toContain("selected 必须一眼能认出当前选中项");
    expect(prompt).toContain("Agent 过程消息头与游离的可展开思考摘要仅在悬停、聚焦或按下时显示此材质");
    expect(prompt).toContain("pill 只用于 navigationItem、navigationAction、control、primaryAction、compoundControl、toggle、menuTrigger、statusSurface");
    expect(prompt).toContain("内容承载角色按语义硬限制在 20–32px");
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

  it("内容承载角色硬限制超大圆角，紧凑控件仍允许 pill", () => {
    const document = documentFixture();
    document.roles.shell!.radius = "pill";
    document.roles.card!.radius = "pill";
    document.roles.modal!.radius = "pill";
    document.roles.composer!.radius = "pill";
    document.roles.userBubble!.radius = "pill";
    document.roles.primaryAction!.radius = "pill";
    const variables = compileUiStyleVariables(document);

    expect(UI_STYLE_ROLE_RADIUS_MAX_PX.userBubble).toBe(28);
    expect(variables["--ui-role-shell-radius"]).toBe("min(var(--ui-radius-pill), 32px)");
    expect(variables["--ui-role-card-radius"]).toBe("min(var(--ui-radius-pill), 24px)");
    expect(variables["--ui-role-modal-radius"]).toBe("min(var(--ui-radius-pill), 28px)");
    expect(variables["--ui-role-composer-radius"]).toBe("min(var(--ui-radius-pill), 28px)");
    expect(variables["--ui-role-user-bubble-radius"]).toBe("min(var(--ui-radius-pill), 28px)");
    expect(variables["--ui-role-primary-action-radius"]).toBe("var(--ui-radius-pill)");
  });
});

describe("自定义风格 CSS 角色消费契约", () => {
  it("公共弹层外壳的强制基础声明直接消费自定义角色并保留默认回退", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");

    expect(css).toMatch(/\.kimix-top-menu,[\s\S]*?\.kimix-menu-panel\s*\{[^}]*border-radius:\s*var\(--ui-role-popup-radius,\s*var\(--radius-lg\)\)\s*!important;/s);
    expect(css).toMatch(/\.kimix-floating-panel\s*\{[^}]*border-radius:\s*var\(--ui-role-popup-radius,\s*var\(--radius-lg\)\)\s*!important;/s);
    expect(css).toMatch(/\.kimix-modal-card,\s*\.kimix-onboarding-card\s*\{[^}]*border-radius:\s*var\(--ui-role-modal-radius,\s*var\(--radius-lg\)\)\s*!important;/s);
    expect(css).toMatch(/\.kimix-diff-panel\s*\{[^}]*border:\s*var\(--ui-role-inspector-resting-border,\s*1px solid var\(--border-subtle\)\)\s*!important;[^}]*background:\s*var\(--ui-role-inspector-resting-background,\s*var\(--surface-base\)\)\s*!important;[^}]*border-radius:\s*var\(--ui-role-inspector-radius,\s*var\(--radius-lg\)\)\s*!important;/s);
    expect(css).toMatch(/\.kimix-longtask-inspector\s*\{[^}]*border:\s*var\(--ui-role-inspector-resting-border,\s*1px solid var\(--border-subtle\)\)\s*!important;[^}]*background:\s*var\(--ui-role-inspector-resting-background,\s*var\(--surface-base\)\)\s*!important;[^}]*border-radius:\s*var\(--ui-role-inspector-radius,\s*var\(--radius-lg\)\)\s*!important;/s);
    expect(css).not.toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\([^)]*\.kimix-runtime-error-card[^)]*\)[^{]*\{[^}]*--ui-role-interactive-card-/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\([\s\S]*?\.kimix-runtime-error-card[\s\S]*?\)\s*\{[^}]*--ui-role-modal-resting-border[^}]*--ui-role-modal-radius[^}]*--ui-role-modal-resting-background[^}]*--ui-role-modal-resting-shadow/s);
    expect(main).toContain('<div class="kimix-runtime-error-card kimix-modal-card">');
  });

  it("每一个公开角色都由固定选择器消费，避免 JSON 存在无效配置点", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toContain(':root[data-ui-style-contract="v1"] .kimix-app-shell-main');
    expect(css).not.toContain('@scope (:root[data-ui-style-contract="v1"])');
    expect(css).not.toContain(":is(:root:not([data-ui-style]), [data-ui-style])");
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\(\s*\.kimix-settings-input,\s*\.kimix-settings-color-value,\s*\.kimix-settings-search,\s*\.kimix-inspector-field\s*\)\s*\{/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\(\s*\.kimix-settings-input,\s*\.kimix-settings-color-value,\s*\.kimix-inspector-field\s*\):is\(:focus, :focus-within\),\s*:root\[data-ui-style-contract="v1"\]\s+\.kimix-settings-search:focus-within\s*\{/s);
    expect(css.slice(css.indexOf("/* ── 可导入界面风格契约 ──"))).not.toMatch(/:where\([^)]*\.kimix-composer-input[^)]*\)\s*(?::focus)?\s*\{/s);
    expect(css).toMatch(/\.kimix-composer-input,[\s\S]*?\.kimix-composer-input:focus-visible\s*\{[^}]*border:\s*0\s*!important;[^}]*background:\s*transparent\s*!important;[^}]*box-shadow:\s*none\s*!important;/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\][\s\S]*?\.kimix-split-control[\s\S]*?:hover[\s\S]*?--ui-role-compound-control-hover-shadow/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\][\s\S]*?\.kimix-state-button[\s\S]*?:hover:not\(:disabled\):not\(\[aria-pressed="true"\]\)[\s\S]*?--ui-role-toggle-hover-shadow/s);
    expect(css.match(/:not\(\.kimix-state-button\)/g)).toHaveLength(3);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+\.kimix-control-button\[aria-expanded="true"\]\s*\{[^}]*--ui-role-menu-trigger-selected-border[^}]*--ui-role-menu-trigger-selected-background[^}]*--ui-role-menu-trigger-selected-shadow[^}]*\}/s);
    const interactiveStateCoverage = {
      "navigation-item": ["resting", "hover", "active", "selected"],
      "navigation-action": ["resting", "hover", "active"],
      control: ["resting", "hover", "active"],
      "primary-action": ["resting", "hover", "active"],
      "compound-control": ["resting", "hover", "active"],
      toggle: ["resting", "hover", "active", "selected"],
      field: ["resting", "focus"],
      "interactive-card": ["resting", "hover", "active", "selected"],
      "menu-trigger": ["resting", "hover", "active", "selected"],
      "menu-item": ["resting", "hover", "active", "selected"],
      "media-thumb": ["resting", "hover", "active"],
      dock: ["resting", "hover", "active", "selected"],
      "room-choice": ["resting", "hover", "active", "selected"],
    } as const;
    for (const [role, states] of Object.entries(interactiveStateCoverage)) {
      for (const state of states) expect(css, `${role}.${state}`).toContain(`--ui-role-${role}-${state}-`);
    }
    for (const roleId of UI_STYLE_ROLE_IDS) {
      const kebab = roleId.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      expect(css, roleId).toContain(`--ui-role-${kebab}-`);
    }
    expect(css).toMatch(/\.kimix-settings-uistyle-wrap\s*\{[^}]*height:\s*76px;/s);
    expect(css).toMatch(/\.kimix-settings-uistyle-desc\s*\{[^}]*display:\s*block;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(css).not.toMatch(/\.kimix-settings-uistyle-desc\s*\{[^}]*line-clamp:/s);
  });
});
