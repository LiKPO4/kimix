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

function separatorCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function restoreBrokenMarkdownTables(content: string) {
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
      if (!isMarkdownTableSeparatorFragment(candidate)) break;
      fragments.push(candidate);
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

  return restored.join("\n");
}

export function restoreAssistantProgressParagraphs(content: string): string {
  const withTables = restoreBrokenMarkdownTables(content);
  if (withTables.length < 120 || withTables.includes("\n") || !hasProgressBoundary(withTables)) return withTables;
  const pattern = /([。！？；.!?])(?=(先|现在|然后|同时|接着|下一步|利用|构建|分析|批次\d*|云端|版本号|上传|修复))/g;
  const restored = withTables.replace(pattern, "$1\n\n");
  const paragraphCount = restored.split(/\n\n+/).filter((part) => part.trim()).length;
  return paragraphCount >= 3 ? restored : withTables;
}
