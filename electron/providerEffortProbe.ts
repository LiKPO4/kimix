// OpenAI 兼容协议接受度诊断。注意：HTTP 2xx 只能证明网关接受了枚举值，
// 不能证明具体模型真正支持该 reasoning_effort，因此该诊断结果不得直接回填 support_efforts。
const EFFORT_PROBE_TIMEOUT_MS = 15_000;
const INVALID_EFFORT_CONTROL = "__kimix_invalid_effort__";

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
 * 再用一个必然无效的档位确认供应商确实校验该字段，避免把“静默忽略字段”误判为全部支持；
 * 最后逐个候选档位探测，2xx 记为支持，400/422 记为不支持，凭证/端点错误则整体失败。
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
      const control = await postCompletion(endpoint, input.apiKey, input.model, INVALID_EFFORT_CONTROL, fetchImpl);
      if (control.ok) {
        throw new Error(
          "供应商对无效 reasoning_effort 也返回成功，说明该字段可能被静默忽略，无法通过请求可靠探测；请使用官方目录预填或手动声明。",
        );
      }
      if (control.status !== 400 && control.status !== 422) {
        throw new Error(`无效档位对照请求失败（HTTP ${control.status}）`);
      }
      const supported: string[] = [];
      for (const effort of EFFORT_PROBE_CANDIDATES) {
        const result = await postCompletion(endpoint, input.apiKey, input.model, effort, fetchImpl);
        if (result.ok) {
          supported.push(effort);
        } else if ((result.status === 400 || result.status === 422) && isEffortRelatedError(result.detail)) {
          // 该档位被拒，跳过。
        } else if (result.status === 400 || result.status === 422) {
          // 非 effort 相关的请求校验失败：保守视为该档位不可用，继续。
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

type CatalogEffortModel = {
  id: string;
  supportEfforts?: string[];
};

type CatalogEffortProvider = {
  providerId: string;
  baseUrl: string | null;
  models: CatalogEffortModel[];
};

export type CatalogEffortResolution =
  | { status: "resolved"; providerId: string; supportEfforts: string[] }
  | { status: "not-found" | "undeclared" | "ambiguous" };

function normalizeCatalogBaseUrl(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  try {
    const url = new URL(value.trim());
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

function bareCatalogModelId(value: string): string {
  const normalized = value.trim().toLowerCase();
  const slash = normalized.indexOf("/");
  return slash > 0 ? normalized.slice(slash + 1) : normalized;
}

/**
 * 只从 models.dev 形状的官方目录声明解析模型档位。优先限定同 provider id，
 * 未命中时再用唯一 Base URL 匹配；无法确定 provider 身份时不按全局裸 model id 猜测。
 */
export function resolveCatalogThinkingEfforts(input: {
  providerName?: string;
  baseUrl?: string | null;
  modelId: string;
  providers: readonly CatalogEffortProvider[];
}): CatalogEffortResolution {
  const providerName = input.providerName?.trim().toLowerCase() ?? "";
  const baseUrl = normalizeCatalogBaseUrl(input.baseUrl);
  const byId = providerName
    ? input.providers.filter((provider) => provider.providerId.trim().toLowerCase() === providerName)
    : [];
  if (byId.length > 1) return { status: "ambiguous" };
  const byUrl = byId.length === 0 && baseUrl
    ? input.providers.filter((provider) => normalizeCatalogBaseUrl(provider.baseUrl) === baseUrl)
    : [];
  if (byUrl.length > 1) return { status: "ambiguous" };
  const scope = byId.length === 1 ? byId : byUrl;
  if (scope.length === 0) return { status: "not-found" };
  const modelId = input.modelId.trim().toLowerCase();
  if (!modelId) return { status: "not-found" };

  const allModels = scope.flatMap((provider) => provider.models.map((model) => ({ provider, model })));
  const exact = allModels.filter(({ model }) => model.id.trim().toLowerCase() === modelId);
  const bareModelId = bareCatalogModelId(modelId);
  const matches = exact.length > 0
    ? exact
    : allModels.filter(({ model }) => bareCatalogModelId(model.id) === bareModelId);
  if (matches.length === 0) return { status: "not-found" };

  const declared = matches.flatMap(({ provider, model }) => {
    const supportEfforts = Array.from(new Set((model.supportEfforts ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)));
    return supportEfforts.length > 0 ? [{ providerId: provider.providerId, supportEfforts }] : [];
  });
  if (declared.length === 0) return { status: "undeclared" };
  const signatures = new Set(declared.map((entry) => entry.supportEfforts.join("\u0000")));
  if (signatures.size !== 1) return { status: "ambiguous" };
  return { status: "resolved", ...declared[0] };
}
