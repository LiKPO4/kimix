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

type FencedCodeBoundary = {
  indent: string;
  marker: string;
  markerChar: "`" | "~";
  markerLength: number;
  info: string;
  rawInfo: string;
};

function parseFencedCodeBoundary(line: string): FencedCodeBoundary | null {
  const match = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  const marker = match[2];
  const markerChar = marker[0] as "`" | "~";
  return {
    indent: match[1],
    marker,
    markerChar,
    markerLength: marker.length,
    rawInfo: match[3] ?? "",
    info: (match[3] ?? "").trim(),
  };
}

function isClosingFence(boundary: FencedCodeBoundary, opener: FencedCodeBoundary) {
  return boundary.markerChar === opener.markerChar && boundary.markerLength >= opener.markerLength;
}

function isMarkdownFenceInfo(info: string) {
  const firstToken = info.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return firstToken === "markdown" || firstToken === "md";
}

export function normalizeNestedMarkdownFencedCodeBlocks(content: string) {
  const lines = content.split(/\r?\n/);
  const normalized = [...lines];

  for (let index = 0; index < lines.length; index += 1) {
    const opener = parseFencedCodeBoundary(lines[index]);
    if (!opener || !isMarkdownFenceInfo(opener.info)) continue;

    let nestedDepth = 0;
    let sawNestedFence = false;
    let maxFenceLength = opener.markerLength;
    let closeIndex = -1;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const boundary = parseFencedCodeBoundary(lines[cursor]);
      if (!boundary || boundary.markerChar !== opener.markerChar) continue;
      maxFenceLength = Math.max(maxFenceLength, boundary.markerLength);

      if (boundary.info) {
        nestedDepth += 1;
        sawNestedFence = true;
        continue;
      }

      if (nestedDepth > 0) {
        nestedDepth -= 1;
        continue;
      }

      closeIndex = cursor;
      break;
    }

    if (!sawNestedFence) continue;

    const marker = opener.markerChar.repeat(Math.max(maxFenceLength + 1, opener.markerLength + 1));
    normalized[index] = `${opener.indent}${marker}${opener.rawInfo}`;
    if (closeIndex !== -1) {
      const closer = parseFencedCodeBoundary(lines[closeIndex]);
      normalized[closeIndex] = `${closer?.indent ?? ""}${marker}`;
      index = closeIndex;
    }
  }

  return normalized.join("\n");
}

function mapMarkdownOutsideFences(content: string, transform: (segment: string) => string) {
  const lines = content.split(/\r?\n/);
  const segments: string[] = [];
  let buffer: string[] = [];
  let activeFence: FencedCodeBoundary | null = null;

  const flushOutside = () => {
    if (!buffer.length) return;
    segments.push(transform(buffer.join("\n")));
    buffer = [];
  };

  const flushFence = () => {
    if (!buffer.length) return;
    segments.push(buffer.join("\n"));
    buffer = [];
  };

  for (const line of lines) {
    const boundary = parseFencedCodeBoundary(line);
    if (!activeFence && boundary) {
      flushOutside();
      activeFence = boundary;
      buffer.push(line);
      continue;
    }
    if (activeFence) {
      buffer.push(line);
      if (boundary && isClosingFence(boundary, activeFence)) {
        flushFence();
        activeFence = null;
      }
      continue;
    }
    buffer.push(line);
  }

  if (activeFence) {
    flushFence();
  } else {
    flushOutside();
  }
  return segments.join("\n");
}

export function normalizeIndentedFencedCodeBlocks(content: string) {
  const lines = content.split(/\r?\n/);
  const normalized: string[] = [];
  let activeFence: FencedCodeBoundary | null = null;
  let fenceIndent = 0;
  let insideIndentedFence = false;

  for (const line of lines) {
    const boundary = parseFencedCodeBoundary(line);
    if (boundary) {
      if (activeFence && isClosingFence(boundary, activeFence)) {
        activeFence = null;
        insideIndentedFence = false;
        fenceIndent = 0;
      } else if (!activeFence) {
        activeFence = boundary;
        fenceIndent = boundary.indent.length;
        insideIndentedFence = fenceIndent > 0;
      }
      normalized.push(line);
      continue;
    }

    if (insideIndentedFence && line.trim() && line.match(/^\s*/)?.[0].length < fenceIndent) {
      normalized.push(`${" ".repeat(fenceIndent)}${line}`);
      continue;
    }

    normalized.push(line);
  }

  return normalized.join("\n");
}

function expandCollapsedMarkdownTableRows(lines: string[]) {
  const expanded: string[] = [];
  let activeTableCells = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isLikelyMarkdownTableHeader(line) && i + 1 < lines.length && isMarkdownTableSeparatorFragment(lines[i + 1])) {
      activeTableCells = countMarkdownTableCells(line);
      expanded.push(line);
      continue;
    }
    if (!activeTableCells || isMarkdownTableSeparatorFragment(line)) {
      expanded.push(line);
      continue;
    }
    if (!line.trim() || !line.includes("|")) {
      activeTableCells = 0;
      expanded.push(line);
      continue;
    }
    if (countMarkdownTableCells(line) <= activeTableCells) {
      expanded.push(line);
      continue;
    }

    const cells: string[] = [];
    let cursor = i;
    while (cursor < lines.length && cells.length < activeTableCells * 20) {
      const candidate = lines[cursor];
      if (!candidate.trim() || !candidate.includes("|")) break;
      cells.push(...candidate
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean));
      cursor += 1;
      if (cells.length >= activeTableCells && cells.length % activeTableCells === 0) break;
    }

    if (cells.length >= activeTableCells && cells.length % activeTableCells === 0) {
      for (let offset = 0; offset < cells.length; offset += activeTableCells) {
        expanded.push(`| ${cells.slice(offset, offset + activeTableCells).join(" | ")} |`);
      }
      i = cursor - 1;
      continue;
    }
    expanded.push(line);
  }

  return expanded;
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
  return mapMarkdownOutsideFences(content, (segment) => {
    const lines = segment.split(/\r?\n/);
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
      if (cells.length >= 2) {
        const normalizedCells = cells.slice(0, headerCells);
        while (normalizedCells.length < headerCells) normalizedCells.push("---");
        restored.push(`|${normalizedCells.join("|")}|`);
        i = cursor - 1;
      }
    }

    return restoreBrokenMarkdownTableRows(expandCollapsedMarkdownTableRows(restored)).join("\n");
  });
}

export function restoreInlineMarkdownHeadings(content: string) {
  if (!content.includes("#")) return content;
  return mapMarkdownOutsideFences(content, (segment) => segment.replace(
    /([^`\n])([。！？；：.!?:;])\s+(#{1,6}\s+\S)/g,
    "$1$2\n\n$3",
  ));
}

export function restoreAssistantProgressParagraphs(content: string): string {
  const withTables = restoreInlineMarkdownHeadings(restoreMarkdownTables(normalizeIndentedFencedCodeBlocks(normalizeNestedMarkdownFencedCodeBlocks(content))));
  if (withTables.length < 120 || withTables.includes("\n") || !hasProgressBoundary(withTables)) return withTables;
  const pattern = /([。！？；.!?])(?=(先|现在|然后|同时|接着|下一步|利用|构建|分析|批次\d*|云端|版本号|上传|修复))/g;
  const restored = withTables.replace(pattern, "$1\n\n");
  const paragraphCount = restored.split(/\n\n+/).filter((part) => part.trim()).length;
  return paragraphCount >= 3 ? restored : withTables;
}
