const MAX_MODEL_LIST_BYTES = 2 * 1024 * 1024;
const MODEL_DISCOVERY_TIMEOUT_MS = 12_000;

export type DiscoveredOpenAiModel = {
  id: string;
  ownedBy: string | null;
};

export type OpenAiModelDiscoveryResult = {
  endpoint: string;
  models: DiscoveredOpenAiModel[];
};

function appendPath(url: URL, suffix: string) {
  const next = new URL(url.href);
  next.search = "";
  next.hash = "";
  next.pathname = `${next.pathname.replace(/\/+$/, "")}${suffix}`;
  return next.href;
}

export function buildOpenAiModelListUrls(baseUrl: string) {
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
  if (/\/models$/i.test(parsed.pathname)) return [parsed.href];

  parsed.pathname = parsed.pathname.replace(/\/(?:chat\/completions|completions|responses)$/i, "") || "/";
  const candidates = [appendPath(parsed, "/models")];
  const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!/^v\d+(?:[._-]\d+)*$/i.test(lastSegment)) {
    candidates.push(appendPath(parsed, "/v1/models"));
  }
  return [...new Set(candidates)];
}

function readModelEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  if (Array.isArray(record.items)) return record.items;
  return [];
}

export function parseOpenAiModelList(payload: unknown) {
  const byId = new Map<string, DiscoveredOpenAiModel>();
  for (const entry of readModelEntries(payload)) {
    const id = typeof entry === "string"
      ? entry.trim()
      : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).id === "string"
        ? String((entry as Record<string, unknown>).id).trim()
        : "";
    if (!id || id.length > 240 || byId.has(id)) continue;
    const ownedBy = entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).owned_by === "string"
      ? String((entry as Record<string, unknown>).owned_by).trim() || null
      : null;
    byId.set(id, { id, ownedBy });
    if (byId.size >= 1_000) break;
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
}

function responseErrorDetail(text: string) {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const error = payload.error;
    if (typeof error === "string") return error.slice(0, 240);
    if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") {
      return String((error as Record<string, unknown>).message).slice(0, 240);
    }
    if (typeof payload.message === "string") return payload.message.slice(0, 240);
  } catch {
    // 非 JSON 错误页只报告 HTTP 状态，避免把网关 HTML 带回 UI。
  }
  return "";
}

export async function discoverOpenAiModels(
  input: { baseUrl: string; apiKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<OpenAiModelDiscoveryResult> {
  const urls = buildOpenAiModelListUrls(input.baseUrl);
  const failures: string[] = [];
  for (const endpoint of urls) {
    try {
      const response = await fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.apiKey}`,
          "User-Agent": "Kimix",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
      });
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_MODEL_LIST_BYTES) throw new Error("响应超过 2 MB 限制");
      const text = await response.text();
      if (text.length > MAX_MODEL_LIST_BYTES) throw new Error("响应超过 2 MB 限制");
      if (!response.ok) {
        const detail = responseErrorDetail(text);
        failures.push(`${new URL(endpoint).pathname}: HTTP ${response.status}${detail ? ` · ${detail}` : ""}`);
        continue;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        failures.push(`${new URL(endpoint).pathname}: 返回内容不是 JSON`);
        continue;
      }
      const models = parseOpenAiModelList(payload);
      if (models.length === 0) {
        failures.push(`${new URL(endpoint).pathname}: 未返回可用模型 ID`);
        continue;
      }
      return { endpoint, models };
    } catch (error) {
      failures.push(`${new URL(endpoint).pathname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`无法从 Base URL 探测模型：${failures.join("；")}`);
}
