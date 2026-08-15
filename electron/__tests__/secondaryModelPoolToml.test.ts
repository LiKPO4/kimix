import { describe, expect, it } from "vitest";
import {
  applySecondaryModelPoolToml,
  pruneSecondaryModelPoolForRemovedAliases,
  readSecondaryModelPoolFromToml,
  validateSecondaryModelPoolDraft,
  type SecondaryModelPoolDraft,
} from "../secondaryModelPoolToml";

function pool(draft: Partial<SecondaryModelPoolDraft> = {}): SecondaryModelPoolDraft {
  return { defaultModel: null, force: false, defaultEffort: null, entries: [], ...draft };
}

describe("TOML 往返", () => {
  it("普通配置保存后能读回等价结构", () => {
    const draft = pool({
      defaultModel: "m1",
      force: true,
      defaultEffort: "high",
      entries: [
        { alias: "m1", hint: "h1" },
        { alias: "m2", hint: "h2" },
      ],
    });
    const raw = applySecondaryModelPoolToml("", draft);
    expect(readSecondaryModelPoolFromToml(raw)).toEqual(draft);
    expect(raw).toContain("[secondary_model]");
    expect(raw).toContain("[secondary_model.models]");
    expect(raw).toContain('force = true');
  });

  it("别名与提示语含引号和反斜杠时往返一致", () => {
    const alias = 'we"ird\\alias';
    const hint = 'say "hi" \\\\ ok';
    const draft = pool({
      defaultModel: alias,
      entries: [{ alias, hint }],
    });
    const raw = applySecondaryModelPoolToml("", draft);
    expect(readSecondaryModelPoolFromToml(raw)).toEqual(draft);
  });

  it("CRLF 输入保存后仍为 CRLF 且往返一致", () => {
    const raw = "top = 1\r\n\r\n[models]\r\nactive = true\r\n";
    const draft = pool({
      defaultModel: "m1",
      entries: [{ alias: "m1", hint: "h1" }],
    });
    const next = applySecondaryModelPoolToml(raw, draft);
    expect(next).toContain("\r\n");
    // 不允许出现裸 \n（所有换行前都必须是 \r）
    expect(next).not.toMatch(/(^|[^\r])\n/);
    expect(readSecondaryModelPoolFromToml(next)).toEqual(draft);
    // 原有非池内容保持不变
    expect(next).toContain("top = 1");
    expect(next).toContain("[models]");
  });

  it("空输入保存空池后无残留池节", () => {
    const raw = "[secondary_model]\ndefault_model = \"old\"\n";
    const next = applySecondaryModelPoolToml(raw, pool());
    expect(readSecondaryModelPoolFromToml(next)).toBeNull();
    expect(next).not.toContain("secondary_model");
  });
});

describe("legacy model 键作为 fallback default", () => {
  it("仅有旧单模型键时作为默认模型读取", () => {
    const raw = '[secondary_model]\nmodel = "kimi-k2"\n';
    const parsed = readSecondaryModelPoolFromToml(raw);
    expect(parsed?.defaultModel).toBe("kimi-k2");
    expect(parsed?.entries).toEqual([]);
    expect(parsed?.force).toBe(false);
  });

  it("default_model 优先于旧 model 键", () => {
    const raw = '[secondary_model]\ndefault_model = "new"\nmodel = "old"\n';
    expect(readSecondaryModelPoolFromToml(raw)?.defaultModel).toBe("new");
  });

  it("池节缺失时返回 null", () => {
    expect(readSecondaryModelPoolFromToml("[models]\na = 1\n")).toBeNull();
    expect(readSecondaryModelPoolFromToml("")).toBeNull();
  });
});

describe("级联清理 pruneSecondaryModelPoolForRemovedAliases", () => {
  it("默认模型悬空时整节清除", () => {
    const raw = '[secondary_model]\ndefault_model = "gone"\n\n[secondary_model.models]\ngone = "g"\nkept = "k"\n';
    const next = pruneSecondaryModelPoolForRemovedAliases(raw, new Set(["kept"]));
    expect(readSecondaryModelPoolFromToml(next)).toBeNull();
    expect(next).not.toContain("secondary_model");
  });

  it("默认模型有效时仅过滤悬空条目", () => {
    const raw = '[secondary_model]\ndefault_model = "kept"\n\n[secondary_model.models]\ngone = "g"\nkept = "k"\n';
    const next = pruneSecondaryModelPoolForRemovedAliases(raw, new Set(["kept"]));
    const parsed = readSecondaryModelPoolFromToml(next);
    expect(parsed?.defaultModel).toBe("kept");
    expect(parsed?.entries).toEqual([{ alias: "kept", hint: "k" }]);
  });

  it("重命名场景：默认指向新别名时旧条目被过滤、新条目保留", () => {
    // 模拟模型由 old 重命名为 new：池内新旧条目并存，默认指向新别名
    const raw = '[secondary_model]\ndefault_model = "new"\n\n[secondary_model.models]\nold = "o"\nnew = "n"\n';
    const next = pruneSecondaryModelPoolForRemovedAliases(raw, new Set(["new"]));
    const parsed = readSecondaryModelPoolFromToml(next);
    expect(parsed?.defaultModel).toBe("new");
    expect(parsed?.entries).toEqual([{ alias: "new", hint: "n" }]);
  });

  it("重命名场景：默认仍指向旧别名时整节清除", () => {
    const raw = '[secondary_model]\ndefault_model = "old"\n\n[secondary_model.models]\nold = "o"\nnew = "n"\n';
    const next = pruneSecondaryModelPoolForRemovedAliases(raw, new Set(["new"]));
    expect(readSecondaryModelPoolFromToml(next)).toBeNull();
  });

  it("无悬空别名时原样返回", () => {
    const raw = '[secondary_model]\ndefault_model = "a"\n\n[secondary_model.models]\na = "x"\n';
    const next = pruneSecondaryModelPoolForRemovedAliases(raw, new Set(["a"]));
    expect(next).toBe(raw);
  });
});

describe("primary 保留别名拒绝", () => {
  const ERROR = "primary 是官方保留别名，请改用其它模型别名";

  it("默认模型为 primary 时抛中文错误", () => {
    expect(() => validateSecondaryModelPoolDraft({ defaultModel: "primary", entries: [] })).toThrow(ERROR);
  });

  it("任一条目别名为 primary 时抛中文错误", () => {
    expect(() =>
      validateSecondaryModelPoolDraft({
        defaultModel: "a",
        entries: [{ alias: "primary", hint: "x" }],
      }),
    ).toThrow(ERROR);
    expect(() =>
      validateSecondaryModelPoolDraft({
        defaultModel: "a",
        entries: [
          { alias: "a", hint: "h" },
          { alias: "primary", hint: "x" },
        ],
      }),
    ).toThrow(ERROR);
  });

  it("非 primary 的默认模型与条目正常通过", () => {
    const out = validateSecondaryModelPoolDraft({
      defaultModel: "a",
      entries: [{ alias: "a", hint: "h" }],
    });
    expect(out).toEqual({ defaultModel: "a", entries: [{ alias: "a", hint: "h" }] });
  });
});

describe("按 alias 去重", () => {
  it("保留首个出现的条目", () => {
    const out = validateSecondaryModelPoolDraft({
      defaultModel: "a",
      entries: [
        { alias: "a", hint: "first" },
        { alias: "a", hint: "second" },
        { alias: "b", hint: "bee" },
      ],
    });
    expect(out.entries).toEqual([
      { alias: "a", hint: "first" },
      { alias: "b", hint: "bee" },
    ]);
  });

  it("默认模型不参与去重（仅影响 entries）", () => {
    const out = validateSecondaryModelPoolDraft({
      defaultModel: "dup",
      entries: [{ alias: "dup", hint: "only" }],
    });
    expect(out.defaultModel).toBe("dup");
    expect(out.entries).toEqual([{ alias: "dup", hint: "only" }]);
  });
});
