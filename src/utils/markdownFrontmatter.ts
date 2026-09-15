// 解析 Markdown 开头的 YAML frontmatter 为扁平键值（对标官方 Web 0.43.0 的
// frontmatter 元数据卡片）。只支持标量与字符串数组（内联 [...] 或 - item 列表），
// 嵌套 YAML 不解析（保持原文进正文）。

export type FrontmatterEntry = {
  key: string;
  value: string | string[];
};

export type MarkdownFrontmatter = {
  meta: FrontmatterEntry[];
  body: string;
};

export function parseMarkdownFrontmatter(text: string): MarkdownFrontmatter | null {
  if (!text || !text.startsWith("---")) return null;
  const match = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(text);
  if (!match) return null;
  const meta: FrontmatterEntry[] = [];
  let lastKey: string | null = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const listItem = /^-\s+(.*)$/.exec(trimmed);
    if (listItem) {
      if (lastKey) {
        const entry = meta.find((item) => item.key === lastKey);
        if (entry && Array.isArray(entry.value)) {
          const itemValue = unquoteFrontmatterScalar(listItem[1].trim());
          if (itemValue) entry.value.push(itemValue);
        }
      }
      continue;
    }
    const kv = /^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1];
    const valueRaw = (kv[2] ?? "").trim();
    let value: string | string[];
    if (valueRaw === "" || valueRaw === "[]") {
      value = [];
    } else if (valueRaw.startsWith("[") && valueRaw.endsWith("]")) {
      value = valueRaw
        .slice(1, -1)
        .split(",")
        .map((part) => unquoteFrontmatterScalar(part.trim()))
        .filter(Boolean);
    } else {
      value = unquoteFrontmatterScalar(valueRaw);
    }
    meta.push({ key, value });
    lastKey = key;
  }
  if (meta.length === 0) return null;
  return { meta, body: text.slice(match[0].length) };
}

function unquoteFrontmatterScalar(raw: string): string {
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1);
  }
  return raw;
}
