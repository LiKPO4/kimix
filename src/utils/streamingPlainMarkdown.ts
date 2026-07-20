/**
 * Lightweight streaming markdown: fence-aware block split + plain HTML.
 * Used while an assistant turn is active; settled turns use full ReactMarkdown.
 */

export function splitStreamingPlainBlocks(content: string): string[] {
  if (!content) return [];
  const blocks: string[] = [];
  let buffer = "";
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);

    if (!inFence && fenceMatch) {
      if (buffer.trim().length > 0) {
        pushParagraphBlocks(blocks, buffer);
        buffer = "";
      }
      inFence = true;
      fenceChar = fenceMatch[2][0];
      fenceLen = fenceMatch[2].length;
      buffer = line;
      continue;
    }

    if (inFence) {
      buffer = `${buffer}\n${line}`;
      const close = line.match(/^(\s*)(`{3,}|~{3,})\s*$/);
      if (close && close[2][0] === fenceChar && close[2].length >= fenceLen) {
        blocks.push(buffer);
        buffer = "";
        inFence = false;
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }

    if (line.trim() === "") {
      if (buffer.length > 0) {
        buffer = `${buffer}\n`;
        // Collapse one or more blank lines into a paragraph boundary.
        const lookAhead = lines[index + 1];
        if (lookAhead === undefined || lookAhead.trim() !== "") {
          pushParagraphBlocks(blocks, buffer);
          buffer = "";
        }
      }
      continue;
    }

    buffer = buffer.length > 0 ? `${buffer}\n${line}` : line;
  }

  if (buffer.length > 0) {
    if (inFence) blocks.push(buffer);
    else pushParagraphBlocks(blocks, buffer);
  }

  return blocks.length > 0 ? blocks : [content];
}

function pushParagraphBlocks(blocks: string[], raw: string) {
  const parts = raw
    .split(/\n{2,}/)
    .map((part) => part.replace(/^\n+|\n+$/g, ""))
    .filter((part) => part.length > 0);
  for (const part of parts) blocks.push(part);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderStreamingPlainBlockToHtml(block: string): string {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const open = lines[0]?.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
  if (open) {
    const markerChar = open[2][0];
    const markerLen = open[2].length;
    let end = -1;
    for (let i = 1; i < lines.length; i += 1) {
      const close = lines[i]?.match(/^(\s*)(`{3,}|~{3,})\s*$/);
      if (close && close[2][0] === markerChar && close[2].length >= markerLen) {
        end = i;
        break;
      }
    }
    const code = (end >= 0 ? lines.slice(1, end) : lines.slice(1)).join("\n");
    const language = (open[3] ?? "").trim();
    return `<pre class="kimix-streaming-plain-code"${language ? ` data-language="${escapeHtml(language)}"` : ""}><code>${escapeHtml(code)}</code></pre>`;
  }

  return `<p class="kimix-streaming-plain-p">${escapeHtml(block).replace(/\n/g, "<br />")}</p>`;
}
