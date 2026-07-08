type ImageUrlPart = Record<string, unknown>;

function imageReference(part: ImageUrlPart) {
  const value = part.image_url ?? part.imageUrl;
  const imageUrl = value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  const id = imageUrl?.id;
  return typeof id === "string" && id.trim() ? id : "[图片]";
}

export function rewriteOpenAIContentForNonVision(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;

  const textParts: string[] = [];
  const imageRefs: string[] = [];
  let hasImage = false;

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      textParts.push(record.text);
    } else if (record.type === "image_url") {
      hasImage = true;
      imageRefs.push(`[图片: ${imageReference(record)}]`);
    }
  }

  if (!hasImage) return content;
  return [...textParts, ...imageRefs].join("\n") || "";
}
