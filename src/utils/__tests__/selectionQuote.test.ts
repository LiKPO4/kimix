import { describe, expect, it } from "vitest";

import {
  ANNOTATABLE_ATTR,
  ANNOTATABLE_EXCLUDE_ATTR,
  formatSelectionQuote,
  isSelectionAnnotatable,
  mergeQuoteIntoDraft,
  normalizeSelectedText,
} from "../selectionQuote";

describe("normalizeSelectedText", () => {
  it("统一换行并去掉行尾空白与首尾空行", () => {
    expect(normalizeSelectedText("\r\n  hello  \r\n\r\n\r\nworld \r\n")).toBe("hello\n\nworld");
  });

  it("压缩 3 个以上连续空行", () => {
    expect(normalizeSelectedText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("formatSelectionQuote", () => {
  it("逐行加 > 前缀，空行保留为裸 >", () => {
    expect(formatSelectionQuote("第一行\n\n第二行")).toBe("> 第一行\n>\n> 第二行");
  });

  it("带评论时引用块后空一行接评论", () => {
    expect(formatSelectionQuote("原文", "  我的评论  ")).toBe("> 原文\n\n我的评论");
  });

  it("空选区返回空串", () => {
    expect(formatSelectionQuote("   \n  ")).toBe("");
    expect(formatSelectionQuote("", "评论")).toBe("");
  });
});

describe("mergeQuoteIntoDraft", () => {
  it("空草稿直接填入", () => {
    expect(mergeQuoteIntoDraft("", "> a")).toBe("> a");
    expect(mergeQuoteIntoDraft("   ", "> a")).toBe("> a");
  });

  it("非空草稿空两行分隔，并清掉草稿尾部空白", () => {
    expect(mergeQuoteIntoDraft("已有内容  \n", "> a")).toBe("已有内容\n\n> a");
  });

  it("空引用不改动草稿", () => {
    expect(mergeQuoteIntoDraft("已有内容", "")).toBe("已有内容");
  });
});

describe("isSelectionAnnotatable", () => {
  function fakeSelection(init: {
    isCollapsed?: boolean;
    rangeCount?: number;
    anchorNode?: Node | null;
    focusNode?: Node | null;
  }): Selection {
    return {
      isCollapsed: init.isCollapsed ?? false,
      rangeCount: init.rangeCount ?? 1,
      anchorNode: init.anchorNode ?? null,
      focusNode: init.focusNode ?? null,
    } as unknown as Selection;
  }

  it("选区两端都在标注容器内 → true", () => {
    document.body.innerHTML = `<div ${ANNOTATABLE_ATTR}><p id="a">你好<span id="b">世界</span></p></div>`;
    const sel = fakeSelection({
      anchorNode: document.querySelector("#a")!.firstChild,
      focusNode: document.querySelector("#b")!.firstChild,
    });
    expect(isSelectionAnnotatable(sel)).toBe(true);
  });

  it("折叠选区 / 无 range → false", () => {
    document.body.innerHTML = `<div ${ANNOTATABLE_ATTR}><p id="a">文字</p></div>`;
    expect(isSelectionAnnotatable(fakeSelection({ isCollapsed: true, anchorNode: document.querySelector("#a"), focusNode: document.querySelector("#a") }))).toBe(false);
    expect(isSelectionAnnotatable(fakeSelection({ rangeCount: 0 }))).toBe(false);
  });

  it("一端在容器外 → false", () => {
    document.body.innerHTML = `<div ${ANNOTATABLE_ATTR}><p id="in">内</p></div><p id="out">外</p>`;
    const sel = fakeSelection({
      anchorNode: document.querySelector("#in")!.firstChild,
      focusNode: document.querySelector("#out")!.firstChild,
    });
    expect(isSelectionAnnotatable(sel)).toBe(false);
  });

  it("穿过排除区（按钮等 UI 铬件）→ false", () => {
    document.body.innerHTML = `<div ${ANNOTATABLE_ATTR}><p id="a">正文</p><button ${ANNOTATABLE_EXCLUDE_ATTR} id="b">按钮</button></div>`;
    const sel = fakeSelection({
      anchorNode: document.querySelector("#a")!.firstChild,
      focusNode: document.querySelector("#b")!.firstChild,
    });
    expect(isSelectionAnnotatable(sel)).toBe(false);
  });
});
