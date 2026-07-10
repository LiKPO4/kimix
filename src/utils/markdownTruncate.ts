function isInsideFencedCodeBlock(content: string, index: number): boolean {
  const before = content.slice(0, index);
  const fences = before.match(/^```[a-zA-Z0-9]*\s*$/gm);
  return fences ? fences.length % 2 === 1 : false;
}

export function truncateMarkdownForPreview(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  const minPos = Math.floor(maxLength * 0.75);

  const paragraphBoundary = content.lastIndexOf("\n\n", maxLength);
  if (paragraphBoundary >= minPos && !isInsideFencedCodeBlock(content, paragraphBoundary)) {
    return content.slice(0, paragraphBoundary);
  }

  let lineBoundary = content.lastIndexOf("\n", maxLength);
  while (lineBoundary >= minPos) {
    if (!isInsideFencedCodeBlock(content, lineBoundary)) {
      return content.slice(0, lineBoundary);
    }
    lineBoundary = content.lastIndexOf("\n", lineBoundary - 1);
  }

  const after = content.slice(maxLength);
  const nextFenceEnd = after.search(/\n```/);
  if (nextFenceEnd !== -1) {
    return content.slice(0, maxLength + nextFenceEnd + 4);
  }

  return content.slice(0, maxLength);
}
