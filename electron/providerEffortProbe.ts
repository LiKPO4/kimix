// 思考档位自动探测：向 OpenAI 兼容供应商发极小请求，逐个验证 reasoning_effort
// 取值是否被接受，回填模型 support_efforts。复用 providerModelDiscovery 的
// URL 构建与错误解析模式。
const EFFORT_PROBE_TIMEOUT_MS = 15_000;

/** 候选探测档位（OpenAI 兼容词表，不含 none/off——关闭恒可用，由调用方补）。 */
export const EFFORT_PROBE_CANDIDATES = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

function appendPath(url: URL, suffix: string) {
  const next = new URL(url.href);
  next.search = "";
  next.hash = "";
  next.pathname = `${next.pathname.replace(/\/+$/, "")}${suffix}`;
  return next.href;
}

export function buildChatCompletionsUrls(baseUrl: string): string[] {
  const parsed = new URL(baseUrl.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Base URL 只支持 http:// 或 https:// 地址。");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Base URL 不能包含用户名或密码。");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  if (/\/chat\/completions$/i.test(parsed.pathname)) return [parsed.href];
  // 已带 /completions / /responses 结尾的先剥掉，再补 /chat/completions。
  parsed.pathname = parsed.pathname.replace(/\/(?:completions|responses)$/i, "") || "/";
  const candidates = [appendPath(parsed, "/chat/completions")];
  const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!/^v\d+(?:[._-]\d+)*$/i.test(lastSegment)) {
    candidates.push(appendPath(parsed, "/v1/chat/completions"));
  }
  return [...new Set(candidates)];
}

function errorDetail(text: string): string {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const error = payload.error;
    if (typeof error === "string") return error.slice(0, 240);
    if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
      return String((error as Record<string, unknown>).message).slice(0, 240);
    }
    if (typeof payload.message === "string") return payload.message.slice(0, 240);
  } catch {
    // 非 JSON 错误页只报告 HTTP 状态。
  }
  return "";
}

function isEffortRelatedError(detail: string): boolean {
  return /reasoning[_ ]?effort|thinking[_ ]?effort|effort/i.test(detail);
}

type ProbeFetch = typeof fetch;

async function postCompletion(
  endpoint: string,
  apiKey: string,
  model: string,
  effort: string | undefined,
  fetchImpl: ProbeFetch,
): Promise<{ ok: boolean; status: number; detail: string }> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  };
  if (effort !== undefined) body.reasoning_effort = effort;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "Kimix",
    },
    body: JSON.stringify(body),
    redirect: "follow",
    signal: AbortSignal.timeout(EFFORT_PROBE_TIMEOUT_MS),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, detail: response.ok ? "" : errorDetail(text) };
}

export type EffortProbeResult = {
  endpoint: string;
  /** 被供应商接受的 OpenAI 兼容档位（不含 off）。 */
  supported: string[];
};

/**
 * 先发一个不带 reasoning_effort 的基线请求确认连通/凭证/端点；
 * 再逐个候选档位探测，200 记为支持，400 记为不支持，凭证/端点错误则整体失败。
 */
export async function probeThinkingEfforts(
  input: { baseUrl: string; apiKey: string; model: string },
  fetchImpl: ProbeFetch = fetch,
): Promise<EffortProbeResult> {
  const urls = buildChatCompletionsUrls(input.baseUrl);
  const failures: string[] = [];
  for (const endpoint of urls) {
    try {
      const baseline = await postCompletion(endpoint, input.apiKey, input.model, undefined, fetchImpl);
      if (baseline.status === 401 || baseline.status === 403) {
        throw new Error(`凭证被拒绝（HTTP ${baseline.status}）`);
      }
      if (!baseline.ok) {
        failures.push(`${new URL(endpoint).pathname}: HTTP ${baseline.status}${baseline.detail ? ` · ${baseline.detail}` : ""}`);
        continue;
      }
      const supported: string[] = [];
      for (const effort of EFFORT_PROBE_CANDIDATES) {
        const result = await postCompletion(endpoint, input.apiKey, input.model, effort, fetchImpl);
        if (result.ok) {
          supported.push(effort);
        } else if (result.status === 400 && isEffortRelatedError(result.detail)) {
          // 该档位被拒，跳过。
        } else if (result.status === 400) {
          // 非 effort 相关 400：保守视为该档位不可用，继续。
        } else {
          // 其它状态（5xx/401 等）无法判定，记失败但继续其余档位。
          failures.push(`${new URL(endpoint).pathname} [${effort}]: HTTP ${result.status}`);
        }
      }
      return { endpoint, supported };
    } catch (error) {
      failures.push(`${new URL(endpoint).pathname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`无法探测思考档位：${failures.join("；") || "未知错误"}`);
}
