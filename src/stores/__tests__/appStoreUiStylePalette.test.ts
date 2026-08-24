import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../appStore";
import { BUILTIN_UI_STYLE_DOCUMENTS } from "../../utils/builtinUiStyleDocuments";
import { DEFAULT_THEME_PALETTE_ID } from "../../utils/themePalettes";

const customStyle = {
  ...BUILTIN_UI_STYLE_DOCUMENTS.default,
  id: "ocean-console",
  name: "海岸控制台",
  palette: { primary: "#176B87", surface: "#D7E7E8", accent: "#B45F3A" },
};

describe("appStore custom UI style palette linkage", () => {
  beforeEach(() => {
    useAppStore.setState({
      uiStyle: "default",
      customUiStyles: [],
      themePalette: DEFAULT_THEME_PALETTE_ID,
    });
  });

  it("selects the owned palette when importing or choosing a custom style", () => {
    useAppStore.getState().upsertCustomUiStyle(customStyle);
    expect(useAppStore.getState().uiStyle).toBe("custom:ocean-console");
    expect(useAppStore.getState().themePalette).toBe("ui-style:ocean-console");

    useAppStore.getState().setThemePalette("soft-green");
    useAppStore.getState().setUiStyle("custom:ocean-console");
    expect(useAppStore.getState().themePalette).toBe("ui-style:ocean-console");
  });

  it("drops an owned palette when leaving or deleting its custom style", () => {
    useAppStore.getState().upsertCustomUiStyle(customStyle);
    useAppStore.getState().setUiStyle("modern");
    expect(useAppStore.getState().themePalette).toBe(DEFAULT_THEME_PALETTE_ID);

    useAppStore.getState().setUiStyle("custom:ocean-console");
    useAppStore.getState().removeCustomUiStyle("ocean-console");
    expect(useAppStore.getState().uiStyle).toBe("default");
    expect(useAppStore.getState().themePalette).toBe(DEFAULT_THEME_PALETTE_ID);
  });

  it("preserves a manually selected normal palette when leaving the style", () => {
    useAppStore.getState().upsertCustomUiStyle(customStyle);
    useAppStore.getState().setThemePalette("soft-green");
    useAppStore.getState().setUiStyle("retro");
    expect(useAppStore.getState().themePalette).toBe("soft-green");
  });
});
