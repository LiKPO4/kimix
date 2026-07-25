/**
 * Model Context Size Inference Engine
 *
 * Grounded in official documentation from major AI model providers (verified 2026-07-25):
 * - OpenAI API Docs: GPT-5.6 / GPT-5.5 (1,050,000), GPT-5 / GPT-5.x-Codex up to 5.3 (400,000), GPT-4.1 (1,047,576), o1 / o3 / o4 (200,000), GPT-4.5 / GPT-4o / GPT-4o-mini / GPT-4 Turbo (128,000), GPT-4-32k (32,768), GPT-4 (8,192), GPT-3.5-Turbo (16,385)
 * - Anthropic API Docs: Claude Fable 5 / Sonnet 5 / Opus 4.6~4.8 / Sonnet 4.6 (1,000,000 = 1M, GA default), Claude Haiku 4.5 / 3.7 Sonnet / 3.5 Sonnet / 3 Opus / 3 Haiku (200,000)
 * - Google Gemini Docs: Gemini 3.x incl. Pro (1,048,576 = 1M), Gemini 1.5 Pro / 2.0 Pro / Exp (2,097,152 = 2M), Gemini 1.5 Flash / 2.0 Flash / Flash-Lite / 8B (1,048,576 = 1M)
 * - DeepSeek API Docs: DeepSeek V4 Flash/Pro (1,000,000 = 1M), DeepSeek V3 / R1 / V2.5 / Chat / Coder (128,000 = 128k)
 * - Aliyun Qwen Docs: Qwen3.7 / Qwen3.6 Plus / Flash (1,000,000 = 1M), Qwen3.6 Max / Qwen3-Max (256,000), Qwen-Long (10,000,000 = 10M), Qwen 2.5-1M / Turbo (1,000,000 = 1M), Qwen 2.5 / QwQ-32B (131,072 = 128k)
 * - xAI Grok Docs: Grok 4.3 / Grok 4.20 / Grok 3 (1,000,000 = 1M), Grok 4.5 (500,000), Grok 2 / Grok 2 Vision / Grok Beta (131,072 = 128k)
 * - Meta Llama Docs: Llama 3.3 / 3.2 / 3.1 (131,072 = 128k), Llama 3 (8,192), Llama 2 (4,096)
 * - Mistral AI Docs: Codestral 2501 / Mistral Large 2411 / Pixtral Large / Mistral NeMo / Ministral (128,000), Codestral 2405 / Mistral 7B (32,768), Mixtral 8x22B (65,536)
 * - Zhipu GLM Docs: GLM-5.2 (1,000,000 = 1M), GLM-5.1 / GLM-5 / GLM-4.6 (200,000), GLM-4-Long (1,000,000 = 1M), GLM-4.5 / GLM-4 / GLM-4-Plus / Air / Flash (128,000)
 * - Moonshot / Kimi Docs: Kimi K3 (1,048,576 = 1M; official wording "1M-token", binary per Kimi "256k"=262,144, exact value pending 07-27 tech report), Kimi K2.7-Code / K2.5 / K2.6 / K2-Thinking / K2-Instruct-0905 (262,144 = 256k), Kimi K2-Instruct (131,072), Kimi-Latest / 128k (128,000), 32k (32,768), 8k (8,192)
 * - Baidu ERNIE Docs: ERNIE 4.0 Turbo 128k / 3.5 128k (128,000), ERNIE 4.0 Pro / 8k (8,192)
 * - Cohere Docs: Command R+ / Command R / Command R7B (128,000), Command R+ 2 (5,000,000 = 5M)
 * - MiniMax / Yi / 01.AI Docs: MiniMax ABAB 6.5 (245,760), Yi-Lightning / Yi-Large (128,000 / 16,384)
 */

export function inferModelContextSize(
  modelId: string | null | undefined,
  apiContextLength?: number | null,
): number {
  // 1. Direct API reported value (if valid positive integer from provider endpoint)
  if (typeof apiContextLength === "number" && apiContextLength >= 1_000 && apiContextLength <= 10_000_000) {
    return Math.round(apiContextLength);
  }

  const name = (modelId ?? "").trim().toLowerCase();
  if (!name) return 128_000;

  // 2. Explicit token capacity tokens in model name (e.g. "1000k", "1m", "2m", "5m", "10m", "128k", "200k", "32k", "8k", "16k")
  const kMatch = name.match(/(?:^|[._\-\/])(?:context[._-]?)?(\d+)\s*k(?:[._\-\/.]|$)/i);
  if (kMatch?.[1]) {
    const kVal = parseInt(kMatch[1], 10);
    if (!isNaN(kVal) && kVal > 0 && kVal <= 10_000) {
      return kVal * 1_000;
    }
  }

  const mMatch = name.match(/(?:^|[._\-\/])(?:context[._-]?)?(\d+)\s*m(?:[._\-\/.]|$)/i);
  if (mMatch?.[1]) {
    const mVal = parseInt(mMatch[1], 10);
    if (!isNaN(mVal) && mVal > 0 && mVal <= 50) {
      return mVal * 1_000_000;
    }
  }

  // 3. Grounded Official Model Family Rules

  // Google Gemini: 3.x 全系（含 Pro）= 1,048,576 (1M); 1.5 Pro / 2.0 Pro / Exp = 2,097,152 (2M); Flash / Flash-Lite = 1,048,576 (1M)
  if (name.includes("gemini")) {
    if (name.includes("gemini-3") || name.includes("gemini3")) {
      return 1_048_576;
    }
    if (name.includes("pro") || (name.includes("exp") && !name.includes("flash"))) {
      return 2_097_152;
    }
    return 1_048_576;
  }

  // Anthropic Claude: Fable 5 / Sonnet 5 / Opus 4.6~4.8 / Sonnet 4.6 = 1,000,000 (1M 已 GA 默认); Haiku 4.5 及更早 = 200,000
  if (name.includes("claude")) {
    if (
      name.includes("fable-5") ||
      name.includes("sonnet-5") ||
      name.includes("sonnet-4-6") ||
      name.includes("opus-4-6") ||
      name.includes("opus-4-7") ||
      name.includes("opus-4-8")
    ) {
      return 1_000_000;
    }
    return 200_000;
  }

  // OpenAI Reasoning models: o1 / o3 / o4 = 200,000
  if (name.startsWith("o1") || name.startsWith("o3") || name.startsWith("o4") || name.includes("/o1") || name.includes("/o3") || name.includes("/o4")) {
    return 200_000;
  }

  // OpenAI GPT-5.6 / GPT-5.5 = 1,050,000; GPT-5 / GPT-5.x-Codex（5.3 止）= 400,000
  if (name.includes("gpt-5.6") || name.includes("gpt-5.5")) {
    return 1_050_000;
  }
  if (name.includes("gpt-5")) {
    return 400_000;
  }

  // OpenAI GPT-4.1 = 1,047,576（官方页精确值，非 1M）
  if (name.includes("gpt-4.1")) {
    return 1_047_576;
  }

  // OpenAI GPT models: GPT-4.5 / GPT-4o / GPT-4o-mini / GPT-4 Turbo = 128,000
  if (name.includes("gpt-4.5") || name.includes("gpt-4o") || name.includes("gpt-4-turbo") || name.includes("chatgpt-4o")) {
    return 128_000;
  }
  if (name.includes("gpt-4-32k")) {
    return 32_768;
  }
  if (name.includes("gpt-4")) {
    return 8_192;
  }
  if (name.includes("gpt-3.5-turbo")) {
    return 16_385;
  }

  // DeepSeek family: V4 Flash/Pro = 1,000,000; V3 / R1 / V2.5 / Chat / Coder = 128,000
  if (name.includes("deepseek")) {
    if (name.includes("v4")) {
      return 1_000_000;
    }
    return 128_000;
  }

  // xAI Grok family: Grok 4.5 = 500,000（较上代更小）; Grok 4.3 / Grok 4.20 / Grok 3 = 1,000,000; Grok 2 / Grok Beta = 131,072
  if (name.includes("grok")) {
    if (name.includes("grok-4.5")) {
      return 500_000;
    }
    if (name.includes("grok-4.3") || name.includes("grok-4.20") || name.includes("grok-3") || name.includes("grok3")) {
      return 1_000_000;
    }
    return 131_072;
  }

  // Qwen family: Qwen3.7 全系 / Qwen3.6 Plus / Flash = 1,000,000; Qwen3.6 Max / Qwen3-Max = 256,000; Qwen-Long = 10,000,000; Turbo / 1M = 1,000,000; 其他 = 131,072
  if (name.includes("qwen") || name.includes("qwq")) {
    if (name.includes("qwen3.7")) {
      return 1_000_000;
    }
    if (name.includes("qwen3.6-max")) {
      return 256_000;
    }
    if (name.includes("qwen3.6")) {
      return 1_000_000;
    }
    if (name.includes("qwen3-max")) {
      return 256_000;
    }
    if (name.includes("long")) {
      return 10_000_000;
    }
    if (name.includes("turbo") || name.includes("1m")) {
      return 1_000_000;
    }
    return 131_072;
  }

  // Meta Llama family: 3.3 / 3.2 / 3.1 = 131,072; Llama 3 = 8,192; Llama 2 = 4,096
  if (name.includes("llama")) {
    if (name.includes("3.1") || name.includes("3.2") || name.includes("3.3") || name.includes("llama3.1") || name.includes("llama3.2") || name.includes("llama3.3")) {
      return 131_072;
    }
    if (name.includes("llama-3") || name.includes("llama3")) {
      return 8_192;
    }
    if (name.includes("llama-2") || name.includes("llama2")) {
      return 4_096;
    }
    return 131_072;
  }

  // Mistral AI family
  if (name.includes("codestral") || name.includes("pixtral") || name.includes("mistral-large") || name.includes("mistral-nemo") || name.includes("ministral")) {
    if (name.includes("2405")) return 32_768;
    return 128_000;
  }
  if (name.includes("mixtral-8x22b")) {
    return 65_536;
  }
  if (name.includes("mistral")) {
    return 32_768;
  }

  // GLM 智谱 family: GLM-5.2 = 1,000,000; GLM-5.1 / GLM-5 / GLM-4.6 = 200,000; GLM-4-Long = 1,000,000; GLM-4.5 及其他 = 128,000
  if (name.includes("glm")) {
    if (name.includes("glm-5.2")) {
      return 1_000_000;
    }
    if (name.includes("glm-5.1") || name.includes("glm-5") || name.includes("glm-4.6")) {
      return 200_000;
    }
    if (name.includes("long")) {
      return 1_000_000;
    }
    return 128_000;
  }

  // Moonshot / Kimi family: K3 = 1,048,576（官方仅表述 "1M-token"，按 Kimi 行文 "256k"=262,144 以二进制折算，精确值待 07-27 技术报告）;
  // K2.7-Code（含 Highspeed）/ K2.5 / K2.6 / K2-Thinking / K2-Instruct-0905 = 262,144（官方 config.json max_position_embeddings）; K2-Instruct 初版 = 131,072; 32k / 8k 保留; 其他 = 128,000
  if (name.includes("moonshot") || name.includes("kimi")) {
    if (name.includes("k3")) return 1_048_576;
    if (
      name.includes("k2.7-code") ||
      name.includes("k2.5") ||
      name.includes("k2.6") ||
      name.includes("k2-thinking") ||
      name.includes("k2-instruct-0905")
    ) {
      return 262_144;
    }
    if (name.includes("k2-instruct")) return 131_072;
    if (name.includes("32k")) return 32_768;
    if (name.includes("8k")) return 8_192;
    return 128_000;
  }

  // Baidu ERNIE family: 128k variants = 128,000; 4.0 Pro / 8k = 8,192
  if (name.includes("ernie")) {
    if (name.includes("128k")) return 128_000;
    return 8_192;
  }

  // Cohere family: Command R+ 2 = 5,000,000; Command R+ / Command R = 128,000
  if (name.includes("command")) {
    if (name.includes("command-r-plus-2") || name.includes("command-r+-2")) {
      return 5_000_000;
    }
    return 128_000;
  }

  // MiniMax family: abab6.5 = 245,760
  if (name.includes("minimax") || name.includes("abab")) {
    return 245_760;
  }

  // Yi (零一万物) family
  if (name.includes("yi-") || name.includes("yi_")) {
    return 128_000;
  }

  // Default fallback
  return 128_000;
}
