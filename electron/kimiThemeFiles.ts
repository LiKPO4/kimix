import fs from "node:fs";
import path from "node:path";

export function resolveDeletableKimiThemeFile(themesDir: string, requestedPath: string) {
  const resolvedDir = path.resolve(themesDir);
  const resolvedTarget = path.resolve(requestedPath);
  const relative = path.relative(resolvedDir, resolvedTarget);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative) || segments.length !== 1) {
    throw new Error("只能删除当前 Kimi Code themes 目录中的直接子文件。");
  }
  if (path.extname(resolvedTarget).toLowerCase() !== ".json") {
    throw new Error("只能删除 Kimi Code 主题 JSON 文件。");
  }
  return resolvedTarget;
}

export function deleteKimiThemeSourceFile(themesDir: string, requestedPath: string) {
  const target = resolveDeletableKimiThemeFile(themesDir, requestedPath);
  if (!fs.existsSync(target)) throw new Error("主题源文件已不存在，请重新扫描主题。");
  const stat = fs.lstatSync(target);
  if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error("目标不是可删除的主题文件。");
  fs.unlinkSync(target);
  return target;
}
