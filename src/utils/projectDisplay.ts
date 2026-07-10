import { normalizePathForComparison } from "./pathCase";
const DEFAULT_PROJECT_ID = "default-kimi-project";
const DEFAULT_PROJECT_DISPLAY_NAME = "Kimix 默认项目";

type ProjectLike = {
  id?: string;
  name?: string;
  path?: string;
} | null | undefined;

function normalizeProjectPath(value?: string) {
  return normalizePathForComparison(value);
}

export function isDefaultKimixProject(project: ProjectLike) {
  if (!project) return false;
  if (project.id === DEFAULT_PROJECT_ID) return true;

  const normalizedPath = normalizeProjectPath(project.path);
  return project.name?.trim().toLowerCase() === "kimix" && normalizedPath.endsWith("/default-project");
}

export function displayProjectName(project: ProjectLike, fallback = "未选择项目") {
  if (!project) return fallback;
  if (isDefaultKimixProject(project)) return DEFAULT_PROJECT_DISPLAY_NAME;
  return project.name?.trim() || fallback;
}
