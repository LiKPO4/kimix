/**
 * Model Context Size Inference Engine
 *
 * Grounded in official documentation from major AI model providers:
 * - OpenAI API Docs: o1 / o1-pro / o3-mini (200,000), gpt-4.5 / gpt-4o / gpt-4o-mini (128,000), gpt-4-32k (32,768), gpt-4 (8,192), gpt-3.5-turbo (16,385)
 * - Anthropic API Docs: Claude 3.7 Sonnet / 3.5 Sonnet / 3.5 Haiku / 3 Opus / 3 Haiku (200,000)
 * - Google Gemini Docs: Gemini 1.5 Pro / 2.0 Pro / Exp (2,097,152 = 2M), Gemini 1.5 Flash / 2.0 Flash / Flash-Lite / 8B (1,048,576 = 1M)
 * - DeepSeek API Docs: DeepSeek V4 Flash/Pro (1,000,000 = 1M), DeepSeek V3 / R1 / V2.5 / Chat / Coder (128,000 = 128k)
 * - Aliyun Qwen Docs: Qwen 2.5 (131,072 = 128k), QwQ-32B (131,072 = 128k), Qwen 2.5-1M / Turbo (1,000,000 = 1M), Qwen-Long (10,000,000 = 10M)
 * - xAI Grok Docs: Grok 3 (1,000,000 = 1M), Grok 2 / Grok 2 Vision / Grok Beta (131,072 = 128k)
 * - Meta Llama Docs: Llama 3.3 / 3.2 / 3.1 (131,072 = 128k), Llama 3 (8,192), Llama 2 (4,096)
 * - Mistral AI Docs: Codestral 2501 / Mistral Large 2411 / Pixtral Large / Mistral NeMo / Ministral (128,000), Codestral 2405 / Mistral 7B (32,768), Mixtral 8x22B (65,536)
 * - Zhipu GLM Docs: GLM-4 / GLM-4-Plus / Air / Flash (128,000), GLM-4-Long (1,000,000 = 1M)
 * - Moonshot / Kimi Docs: Kimi-Latest / 128k (128,000), 32k (32,768), 8k (8,192)
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

  // Google Gemini: 1.5 Pro / 2.0 Pro = 2,097,152 (2M); Flash / Flash-Lite = 1,048,576 (1M)
  if (name.includes("gemini")) {
    if (name.includes("pro") || (name.includes("exp") && !name.includes("flash"))) {
      return 2_097_152;
    }
    return 1_048_576;
  }

  // Anthropic Claude: 200,000 for Claude 3.7 Sonnet, 3.5 Sonnet, 3.5 Haiku, 3 Opus, 3 Haiku
  if (name.includes("claude")) {
    return 200_000;
  }

  // OpenAI Reasoning models: o1 / o1-pro / o3 / o3-mini = 200,000
  if (name.startsWith("o1") || name.startsWith("o3") || name.includes("/o1") || name.includes("/o3")) {
    return 200_000;
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

  // xAI Grok family: Grok 3 = 1,000,000; Grok 2 / Grok Beta = 131,072
  if (name.includes("grok")) {
    if (name.includes("grok-3") || name.includes("grok3")) {
      return 1_000_000;
    }
    return 131_072;
  }

  // Qwen family: Qwen-Long = 10,000,000; Qwen 2.5 1M / Turbo = 1,000,000; Qwen 2.5 / QwQ-32B = 131,072
  if (name.includes("qwen") || name.includes("qwq")) {
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

  // GLM 智谱 family: GLM-4-Long = 1,000,000; GLM-4 / GLM-4-Plus / Air / Flash = 128,000
  if (name.includes("glm")) {
    if (name.includes("long")) {
      return 1_000_000;
    }
    return 128_000;
  }

  // Moonshot / Kimi family: 128k / 32k / 8k
  if (name.includes("moonshot") || name.includes("kimi")) {
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
