/**
 * Model Context Size Inference Engine
 *
 * Grounded in official documentation from model providers:
 * - OpenAI API Docs: o1 / o3-mini (200k), gpt-4o / gpt-4o-mini (128k), gpt-4 (8k / 32k), gpt-3.5-turbo (16.3k)
 * - Anthropic API Docs: Claude 3.7 / 3.5 / 3 (Sonnet / Opus / Haiku) (200k)
 * - DeepSeek API Docs: DeepSeek V4 (1M / 1,000,000), DeepSeek V3 / R1 / V2.5 (128k / 128,000)
 * - Google Gemini Docs: Gemini 1.5 Pro / 2.0 Pro (2,097,152 = 2M), Gemini 1.5/2.0 Flash (1,048,576 = 1M)
 * - Qwen Docs: Qwen 2.5 (131,072 = 128k), Qwen 2.5-1M / Turbo (1M), Qwen-Long (10M)
 * - Llama Docs: Llama 3.1 / 3.2 / 3.3 (131,072 = 128k), Llama 3 (8k), Llama 2 (4k)
 * - Mistral Docs: Mistral Large / Codestral 2501 / Pixtral (128k), Codestral 2405 / Mistral 7B (32.7k)
 * - Moonshot / Kimi Docs: 128k / 32k / 8k
 * - GLM Docs: GLM-4 (128k), GLM-4-Long (1M)
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

  // 2. Explicit token capacity tokens in model name (e.g. "1000k", "1m", "2m", "128k", "200k", "32k", "8k", "16k")
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

  // 3. Grounded Official Family Rules

  // Google Gemini: 1.5 Pro / 2.0 Pro = 2,097,152 (2M); Flash / Flash-Lite = 1,048,576 (1M)
  if (name.includes("gemini")) {
    if (name.includes("pro") || (name.includes("exp") && !name.includes("flash"))) {
      return 2_097_152;
    }
    return 1_048_576;
  }

  // Anthropic Claude: 200,000 for Claude 3 / 3.5 / 3.7 (Sonnet / Opus / Haiku)
  if (name.includes("claude")) {
    return 200_000;
  }

  // OpenAI Reasoning models: o1 / o3-mini = 200,000
  if (name.startsWith("o1") || name.startsWith("o3") || name.includes("/o1") || name.includes("/o3")) {
    return 200_000;
  }

  // OpenAI GPT models
  if (name.includes("gpt-4o") || name.includes("gpt-4-turbo")) {
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

  // DeepSeek family: V4 = 1,000,000; V3 / R1 / V2.5 / Chat / Coder = 128,000
  if (name.includes("deepseek")) {
    if (name.includes("v4")) {
      return 1_000_000;
    }
    return 128_000;
  }

  // Qwen family: Qwen-Long = 10,000,000; Qwen 2.5 / Turbo-1M = 1,000,000 or 131,072
  if (name.includes("qwen")) {
    if (name.includes("long")) {
      return 10_000_000;
    }
    if (name.includes("turbo") || name.includes("1m")) {
      return 1_000_000;
    }
    return 131_072;
  }

  // Meta Llama family: 3.1 / 3.2 / 3.3 = 131,072; Llama 3 = 8,192; Llama 2 = 4,096
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
  if (name.includes("codestral") || name.includes("pixtral") || name.includes("mistral-large") || name.includes("mistral-nemo")) {
    return 128_000;
  }
  if (name.includes("mistral")) {
    return 32_768;
  }

  // GLM 智谱 family: GLM-4-Long = 1,000,000; GLM-4 = 128,000
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

  // Default fallback
  return 128_000;
}
