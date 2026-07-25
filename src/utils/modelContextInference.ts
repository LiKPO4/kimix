/**
 * Model Context Size Inference Helper
 *
 * Automatically infer the context window size of an LLM model based on:
 * 1. Explicit API response field (`context_length` / `context_window` etc.)
 * 2. Explicit capacity tokens in model ID name (e.g. `1000k`, `1m`, `128k`, `64k`, `200k`, `32k`, `8k`)
 * 3. Known model family heuristics (Gemini, DeepSeek, Claude, GPT-4o, Qwen, Llama 3.x, etc.)
 * 4. Safe fallback default (128,000)
 */

export function inferModelContextSize(
  modelId: string | null | undefined,
  apiContextLength?: number | null,
): number {
  if (typeof apiContextLength === "number" && apiContextLength >= 1_000 && apiContextLength <= 10_000_000) {
    return Math.round(apiContextLength);
  }

  const name = (modelId ?? "").trim().toLowerCase();
  if (!name) return 128_000;

  // 1. Explicit capacity patterns in model ID name
  // Match "1000k", "128k", "200k", "64k", "32k", "16k", "8k", etc.
  const kMatch = name.match(/(?:^|[._\-\/])(?:context[._-]?)?(\d+)\s*k(?:[._\-\/.]|$)/i);
  if (kMatch?.[1]) {
    const kVal = parseInt(kMatch[1], 10);
    if (!isNaN(kVal) && kVal > 0 && kVal <= 10_000) {
      return kVal * 1_000;
    }
  }

  // Match "1m", "2m", "10m" etc.
  const mMatch = name.match(/(?:^|[._\-\/])(?:context[._-]?)?(\d+)\s*m(?:[._\-\/.]|$)/i);
  if (mMatch?.[1]) {
    const mVal = parseInt(mMatch[1], 10);
    if (!isNaN(mVal) && mVal > 0 && mVal <= 50) {
      return mVal * 1_000_000;
    }
  }

  // 2. Known model family heuristics

  // Gemini family: 1,048,576 (1M) default
  if (name.includes("gemini")) {
    if (name.includes("1.5") || name.includes("2.0") || name.includes("flash") || name.includes("pro") || name.includes("exp")) {
      return 1_048_576;
    }
  }

  // Claude family: 200,000 default for Claude 3 / 3.5 / 3.7
  if (name.includes("claude")) {
    if (name.includes("claude-3") || name.includes("claude-2.1") || name.includes("sonnet") || name.includes("opus") || name.includes("haiku")) {
      return 200_000;
    }
  }

  // Qwen Long: 1M or 10M
  if (name.includes("qwen") && name.includes("long")) {
    return 1_000_000;
  }

  // DeepSeek family: 128,000 default (v3, v4, r1, chat, coder)
  if (name.includes("deepseek")) {
    return 128_000;
  }

  // Qwen family: 128,000 default (qwen-2.5, max, plus, turbo, coder)
  if (name.includes("qwen")) {
    return 128_000;
  }

  // OpenAI GPT / O-series family
  if (name.includes("gpt-4o") || name.includes("gpt-4-turbo") || name.startsWith("o1") || name.startsWith("o3") || name.includes("o1-") || name.includes("o3-")) {
    return 128_000;
  }
  if (name.includes("gpt-3.5-turbo")) {
    return 16_385;
  }
  if (name.includes("gpt-4")) {
    return 8_192;
  }

  // Llama family: Llama 3.1 / 3.2 / 3.3 = 128k; Llama 3 = 8k
  if (name.includes("llama-3.1") || name.includes("llama-3.2") || name.includes("llama-3.3") || name.includes("llama3.1") || name.includes("llama3.2") || name.includes("llama3.3")) {
    return 128_000;
  }
  if (name.includes("llama")) {
    return 8_192;
  }

  // Mistral / Codestral / Pixtral
  if (name.includes("codestral") || name.includes("mistral-large") || name.includes("pixtral")) {
    return 128_000;
  }
  if (name.includes("mistral")) {
    return 32_768;
  }

  // GLM-4 / Zhipu
  if (name.includes("glm-4") || name.includes("glm4")) {
    return 128_000;
  }

  // MiniMax
  if (name.includes("minimax") || name.includes("abab")) {
    return 245_760;
  }

  // Moonshot / Kimi
  if (name.includes("moonshot") || name.includes("kimi")) {
    return 128_000;
  }

  // Default fallback
  return 128_000;
}
