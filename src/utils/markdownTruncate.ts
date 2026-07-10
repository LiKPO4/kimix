function isInsideFencedCodeBlock(content: string, index: number): boolean {
  const before = content.slice(0, index);
  const fences = before.match(/^```[a-zA-Z0-9]*\s*$/gm);
  return fences ? fences.length % 2 === 1 : false;
}

function isInsideMathBlock(content: string, index: number): boolean {
  const before = content.slice(0, index);
  const fences = before.match(/^\s*\$\$\s*$/gm);
  return fences ? fences.length % 2 === 1 : false;
}

export function truncateMarkdownForPreview(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  const minPos = Math.floor(maxLength * 0.75);

  const after = content.slice(maxLength);

  if (isInsideFencedCodeBlock(content, maxLength)) {
    const nextFenceEnd = after.search(/\n```/);
    if (nextFenceEnd !== -1) {
      return content.slice(0, maxLength + nextFenceEnd + 4);
    }
  }

  if (isInsideMathBlock(content, maxLength)) {
    const mathEndMatch = after.match(/\n\s*\$\$/);
    if (mathEndMatch && mathEndMatch.index !== undefined) {
      return content.slice(0, maxLength + mathEndMatch.index + mathEndMatch[0].length);
    }
  }

  const paragraphBoundary = content.lastIndexOf("\n\n", maxLength);
  if (paragraphBoundary >= minPos && !isInsideFencedCodeBlock(content, paragraphBoundary) && !isInsideMathBlock(content, paragraphBoundary)) {
    return content.slice(0, paragraphBoundary);
  }

  let lineBoundary = content.lastIndexOf("\n", maxLength);
  while (lineBoundary >= minPos) {
    if (!isInsideFencedCodeBlock(content, lineBoundary) && !isInsideMathBlock(content, lineBoundary)) {
      return content.slice(0, lineBoundary);
    }
    lineBoundary = content.lastIndexOf("\n", lineBoundary - 1);
  }

  return content.slice(0, maxLength);
}
