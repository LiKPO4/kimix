export function compactModelDisplayName(model: string | null | undefined): string {
  const value = model?.trim() ?? "";
  if (!value.includes("/")) return value;
  return value.split("/").filter(Boolean).at(-1) ?? value;
}

export function compactModelText(text: string): string {
  return text.replace(/(模型[：:]\s*)(\S+)/g, (_match, prefix: string, model: string) => {
    return `${prefix}${compactModelDisplayName(model)}`;
  });
}
