import { describe, expect, it } from "vitest";
import {
  applyCustomModelCapabilitiesFix,
  buildModelCapabilities,
  CUSTOM_MODEL_CAPABILITIES_MIGRATION_MARKER,
  isKnownNonVisionModelName,
  toModelCapabilitiesLiteral,
} from "../customModelCapabilitiesToml";
import { readTomlSectionBody } from "../secondaryModelPoolToml";

describe("isKnownNonVisionModelName", () => {
  it("deepseek 官方纯文本模型视为非视觉", () => {
    expect(isKnownNonVisionModelName("deepseek-chat")).toBe(true);
    expect(isKnownNonVisionModelName("deepseek/deepseek-v4-flash")).toBe(true);
  });

  it("deepseek 视觉变体（vision/vl/multimodal）不算非视觉", () => {
    expect(isKnownNonVisionModelName("deepseek-v4-flash-vision-exp")).toBe(false);
    expect(isKnownNonVisionModelName("opencode-go/deepseek-v4-flash-vision-exp")).toBe(false);
    expect(isKnownNonVisionModelName("deepseek-vl2")).toBe(false);
    expect(isKnownNonVisionModelName("deepseek-multimodal")).toBe(false);
  });

  it("非 deepseek 模型一律不算非视觉", () => {
    expect(isKnownNonVisionModelName("kimi-k3")).toBe(false);
    expect(isKnownNonVisionModelName("grok-4.5")).toBe(false);
  });
});

describe("buildModelCapabilities", () => {
  it("deepseek 纯文本不声明 image_in/video_in", () => {
    expect(buildModelCapabilities("deepseek", "https://api.deepseek.com", "deepseek-v4-flash")).toEqual(["tool_use"]);
  });

  it("deepseek 视觉变体声明 image_in/video_in/tool_use", () => {
    expect(buildModelCapabilities("opencode-go", "https://opencode.ai/zen/go/v1", "deepseek-v4-flash-vision-exp"))
      .toEqual(["image_in", "video_in", "tool_use"]);
  });

  it("普通自定义模型声明 image_in/video_in/tool_use", () => {
    expect(buildModelCapabilities("company", "https://gw.example.com/v1", "kimi-k3")).toEqual(["image_in", "video_in", "tool_use"]);
  });
});

describe("toModelCapabilitiesLiteral", () => {
  it("序列化为 TOML 数组字面量", () => {
    expect(toModelCapabilitiesLiteral(["image_in", "video_in", "tool_use"])).toEqual('[ "image_in", "video_in", "tool_use" ]');
  });
});

const RAW = [
  "default_model = \"kimi-k3\"",
  "",
  "[providers.company]",
  "type = \"openai\"",
  "base_url = \"https://gw.example.com/v1\"",
  "api_key = \"sk-test\"",
  "",
  "[providers.opencode-go]",
  "type = \"openai\"",
  "base_url = \"https://opencode.ai/zen/go/v1\"",
  "api_key = \"sk-test\"",
  "",
  "[providers.deepseek]",
  "type = \"openai\"",
  "base_url = \"https://api.deepseek.com\"",
  "api_key = \"sk-test\"",
  "",
  "[providers.unknown]",
  "base_url = \"https://unknown.example.com\"",
  "",
  "[models.\"kimi-k3\"]",
  "provider = \"company\"",
  "model = \"kimi-k3\"",
  "max_context_size = 262144",
  "",
  "[models.\"opencode-go/deepseek-v4-flash-vision-exp\"]",
  "provider = \"opencode-go\"",
  "model = \"deepseek-v4-flash-vision-exp\"",
  "max_context_size = 1000000",
  "",
  "[models.\"deepseek/deepseek-v4-flash\"]",
  "provider = \"deepseek\"",
  "model = \"deepseek-v4-flash\"",
  "",
  "[models.\"deepseek/deepseek-v4-flash\".overrides]",
  "max_context_size = 65536",
  "",
  "[models.\"kimi-code/kimi-for-coding\"]",
  "provider = \"managed:kimi-code\"",
  "model = \"kimi-for-coding\"",
  "max_context_size = 262144",
  "",
  "[models.already-declared]",
  "provider = \"company\"",
  "model = \"text-only\"",
  "capabilities = [ \"tool_use\" ]",
  "",
  "[models.no-provider]",
  "model = \"ghost\"",
  "",
  "[models.unknown-provider]",
  "provider = \"unknown\"",
  "model = \"ghost\"",
].join("\n");

describe("applyCustomModelCapabilitiesFix", () => {
  it("为自定义模型补写 capabilities，deepseek 视觉变体带 image_in，其余条目不动", () => {
    const { next, changed } = applyCustomModelCapabilitiesFix(RAW);
    expect(changed).toBe(true);
    expect(next.startsWith(`${CUSTOM_MODEL_CAPABILITIES_MIGRATION_MARKER}\n`)).toBe(true);

    const kimiBody = readTomlSectionBody(next, 'models."kimi-k3"') ?? "";
    expect(kimiBody).toContain('capabilities = [ "image_in", "video_in", "tool_use" ]');

    const visionBody = readTomlSectionBody(next, 'models."opencode-go/deepseek-v4-flash-vision-exp"') ?? "";
    expect(visionBody).toContain('capabilities = [ "image_in", "video_in", "tool_use" ]');

    const deepseekBody = readTomlSectionBody(next, 'models."deepseek/deepseek-v4-flash"') ?? "";
    expect(deepseekBody).toContain('capabilities = [ "tool_use" ]');
    expect(deepseekBody).not.toContain("image_in");

    // managed:kimi-code 官方条目不动
    const managedBody = readTomlSectionBody(next, 'models."kimi-code/kimi-for-coding"') ?? "";
    expect(managedBody).not.toContain("capabilities");

    // 已声明 / 无 provider / 未知 provider 不动
    const declaredBody = readTomlSectionBody(next, "models.already-declared") ?? "";
    expect(declaredBody).toContain('capabilities = [ "tool_use" ]');
    const noProviderBody = readTomlSectionBody(next, "models.no-provider") ?? "";
    expect(noProviderBody).not.toContain("capabilities");
    const unknownBody = readTomlSectionBody(next, "models.unknown-provider") ?? "";
    expect(unknownBody).not.toContain("capabilities");

    // .overrides 子表不被误当成直接模型
    const overridesBody = readTomlSectionBody(next, 'models."deepseek/deepseek-v4-flash".overrides') ?? "";
    expect(overridesBody).toContain("max_context_size = 65536");
    expect(overridesBody).not.toContain("capabilities");

    // 二次执行：marker 已存在且无旧签名条目，不再改动
    const second = applyCustomModelCapabilitiesFix(next);
    expect(second.changed).toBe(false);
  });

  it("旧规则写入的 tool_use 精确签名（视觉变体）被升级，纯文本 deepseek 保持", () => {
    const legacy = [
      CUSTOM_MODEL_CAPABILITIES_MIGRATION_MARKER,
      "[providers.opencode-go]",
      "type = \"openai\"",
      "base_url = \"https://opencode.ai/zen/go/v1\"",
      "",
      "[models.\"opencode-go/deepseek-v4-flash-vision-exp\"]",
      "provider = \"opencode-go\"",
      "model = \"deepseek-v4-flash-vision-exp\"",
      "max_context_size = 1000000",
      "capabilities = [ \"tool_use\" ]",
      "",
      "[models.\"opencode-go/deepseek-v4-flash\"]",
      "provider = \"opencode-go\"",
      "model = \"deepseek-v4-flash\"",
      "capabilities = [ \"tool_use\" ]",
      "",
      "[models.\"opencode-go/text-only\"]",
      "provider = \"opencode-go\"",
      "model = \"text-only\"",
      "capabilities = [ \"image_in\", \"video_in\", \"tool_use\" ]",
    ].join("\n");
    const { next, changed } = applyCustomModelCapabilitiesFix(legacy);
    expect(changed).toBe(true);
    const visionBody = readTomlSectionBody(next, 'models."opencode-go/deepseek-v4-flash-vision-exp"') ?? "";
    expect(visionBody).toContain('capabilities = [ "image_in", "video_in", "tool_use" ]');
    const plainBody = readTomlSectionBody(next, 'models."opencode-go/deepseek-v4-flash"') ?? "";
    expect(plainBody).toContain('capabilities = [ "tool_use" ]');
    expect(plainBody).not.toContain("image_in");
    const manualBody = readTomlSectionBody(next, 'models."opencode-go/text-only"') ?? "";
    expect(manualBody).toContain('capabilities = [ "image_in", "video_in", "tool_use" ]');
    // 升级后自终止
    const second = applyCustomModelCapabilitiesFix(next);
    expect(second.changed).toBe(false);
  });

  it("marker 已存在时不再补写缺失 capabilities", () => {
    const done = `${CUSTOM_MODEL_CAPABILITIES_MIGRATION_MARKER}\n${RAW}`;
    const { next, changed } = applyCustomModelCapabilitiesFix(done);
    expect(changed).toBe(false);
    expect(next).toBe(done);
  });

  it("无自定义模型时返回未变更", () => {
    const onlyOfficial = [
      "default_model = \"kimi-code/kimi-for-coding\"",
      "[models.\"kimi-code/kimi-for-coding\"]",
      "provider = \"managed:kimi-code\"",
      "model = \"kimi-for-coding\"",
    ].join("\n");
    const { next, changed } = applyCustomModelCapabilitiesFix(onlyOfficial);
    expect(changed).toBe(false);
    expect(next).toBe(onlyOfficial);
  });

  it("CRLF 文件保持行尾并写入 marker", () => {
    const { next } = applyCustomModelCapabilitiesFix(RAW.replace(/\n/g, "\r\n"));
    expect(next.includes("\r\n")).toBe(true);
    expect(next).toContain('capabilities = [ "image_in", "video_in", "tool_use" ]');
  });
});
