// 文件预览列表的排序方式：默认（后端返回顺序，按目录层级+名称）、最新/最旧（按修改时间）、最大/最小（按文件大小）。
export type PreviewFileSortMode = "default" | "newest" | "oldest" | "largest" | "smallest";

export const PREVIEW_FILE_SORT_MODES: PreviewFileSortMode[] = ["default", "newest", "oldest", "largest", "smallest"];

export const PREVIEW_FILE_SORT_LABELS: Record<PreviewFileSortMode, string> = {
  default: "默认",
  newest: "最新",
  oldest: "最旧",
  largest: "最大",
  smallest: "最小",
};

export function sortPreviewFiles<T extends { updatedAt: number; size: number }>(
  files: readonly T[],
  mode: PreviewFileSortMode,
): T[] {
  const sorted = [...files];
  switch (mode) {
    case "newest":
      sorted.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
    case "oldest":
      sorted.sort((a, b) => a.updatedAt - b.updatedAt);
      break;
    case "largest":
      sorted.sort((a, b) => b.size - a.size);
      break;
    case "smallest":
      sorted.sort((a, b) => a.size - b.size);
      break;
    default:
      break; // 默认保持后端返回顺序（目录层级 + 名称）
  }
  return sorted;
}
