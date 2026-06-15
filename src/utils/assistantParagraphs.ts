const PROGRESS_BOUNDARY_WORDS = [
  "先",
  "现在",
  "然后",
  "同时",
  "接着",
  "下一步",
  "利用",
  "构建",
  "分析",
  "批次",
  "云端",
  "版本号",
  "上传",
  "修复",
];

function hasProgressBoundary(text: string) {
  return PROGRESS_BOUNDARY_WORDS.some((word) => text.includes(word));
}

function countMarkdownTableCells(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return 0;
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|").length;
}

function isLikelyMarkdownTableHeader(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || /^[:\-\|\s]+$/.test(trimmed)) return false;
  return countMarkdownTableCells(trimmed) >= 2;
}

function isMarkdownTableSeparatorFragment(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.includes("-") && /^[:\-\|\s]+$/.test(trimmed);
}

function isMarkdownTableSeparatorLikeFragment(line: string) {
  const trimmed = line.trim();
  return trimmed.includes("|") && /^[:\-\|\s]+$/.test(trimmed);
}

function separatorCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function joinMarkdownLineFragments(parts: string[]) {
  return parts.reduce((merged, part) => {
    const text = part.trim();
    if (!merged) return text;
    const prev = merged[merged.length - 1] ?? "";
    const next = text[0] ?? "";
    if (!prev || !next) return merged + text;
    if (prev === "|" && next !== "|") return `${merged} ${text}`;
    if (prev === "|" || next === "|" || prev === "/" || next === "/" || prev === "_" || next === "_") return merged + text;
    if (/[\w.-]/.test(prev) && /[\w.-]/.test(next)) return merged + text;
    return `${merged} ${text}`;
  }, "");
}

function restoreBrokenMarkdownTableRows(lines: string[]) {
  const restored: string[] = [];
  let activeTableCells = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    restored.push(line);

    if (isLikelyMarkdownTableHeader(line) && i + 1 < lines.length && isMarkdownTableSeparatorFragment(lines[i + 1])) {
      activeTableCells = countMarkdownTableCells(line);
      continue;
    }
    if (!activeTableCells) continue;
    if (isMarkdownTableSeparatorFragment(line)) continue;

    if (!line.trim()) {
      activeTableCells = 0;
      continue;
    }
    if (!line.includes("|")) {
      activeTableCells = 0;
      continue;
    }

    const fragments = [line];
    let cursor = i + 1;
    let consumedBlank = false;

    while (cursor < lines.length && fragments.length < 12) {
      const candidate = lines[cursor];
      if (!candidate.trim()) {
        if (fragments.length === 0) break;
        consumedBlank = true;
        cursor += 1;
        continue;
      }
      const merged = joinMarkdownLineFragments([...fragments, candidate]);
      if (countMarkdownTableCells(merged) > activeTableCells) break;
      if (!candidate.includes("|") && countMarkdownTableCells(merged) >= activeTableCells) break;
      if (!candidate.includes("|") && !consumedBlank && !/[\/_.-]$/.test(fragments[fragments.length - 1].trim())) break;
      fragments.push(candidate);
      consumedBlank = false;
      cursor += 1;
      if (countMarkdownTableCells(joinMarkdownLineFragments(fragments)) >= activeTableCells) break;
    }

    if (fragments.length > 1) {
      restored[restored.length - 1] = joinMarkdownLineFragments(fragments);
      i = cursor - 1;
    }
  }

  return restored;
}

export function restoreMarkdownTables(content: string) {
  if (!content.includes("|") || !content.includes("-")) return content;
  const lines = content.split(/\r?\n/);
  const restored: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    restored.push(line);
    if (!isLikelyMarkdownTableHeader(line)) continue;

    const headerCells = countMarkdownTableCells(line);
    const fragments: string[] = [];
    let cursor = i + 1;
    let consumedBlank = false;

    while (cursor < lines.length && fragments.length < 4) {
      const candidate = lines[cursor];
      if (!candidate.trim()) {
        if (fragments.length === 0 || consumedBlank) break;
        consumedBlank = true;
        cursor += 1;
        continue;
      }
      if (!isMarkdownTableSeparatorLikeFragment(candidate)) break;
      fragments.push(candidate);
      consumedBlank = false;
      const mergedCellCount = fragments.flatMap(separatorCells).length;
      cursor += 1;
      if (mergedCellCount >= headerCells) break;
    }

    const cells = fragments.flatMap(separatorCells);
    if (cells.length === headerCells) {
      restored.push(`|${cells.join("|")}|`);
      i = cursor - 1;
    }
  }

  return restoreBrokenMarkdownTableRows(restored).join("\n");
}

export function restoreInlineMarkdownHeadings(content: string) {
  if (!content.includes("#")) return content;
  return content.replace(
    /([^`\n])([。！？；：.!?:;])\s+(#{1,6}\s+\S)/g,
    "$1$2\n\n$3",
  );
}

export function restoreAssistantProgressParagraphs(content: string): string {
  const withTables = restoreInlineMarkdownHeadings(restoreMarkdownTables(content));
  if (withTables.length < 120 || withTables.includes("\n") || !hasProgressBoundary(withTables)) return withTables;
  const pattern = /([。！？；.!?])(?=(先|现在|然后|同时|接着|下一步|利用|构建|分析|批次\d*|云端|版本号|上传|修复))/g;
  const restored = withTables.replace(pattern, "$1\n\n");
  const paragraphCount = restored.split(/\n\n+/).filter((part) => part.trim()).length;
  return paragraphCount >= 3 ? restored : withTables;
}
