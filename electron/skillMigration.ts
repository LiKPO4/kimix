import fs from "node:fs";
import path from "node:path";

function safeSkillDirectoryName(name: string) {
  return (name || "skill").replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").trim() || "skill";
}

export function prepareSkillDirectoryForKimi(sourceSkillFile: string, skillName: string, kimiHome: string) {
  if (path.basename(sourceSkillFile).toLowerCase() !== "skill.md" || !fs.existsSync(sourceSkillFile)) {
    throw new Error(`Skill 入口文件不存在：${sourceSkillFile}`);
  }
  const sourceDir = path.dirname(path.resolve(sourceSkillFile));
  const targetRoot = path.resolve(kimiHome, "skills");
  const targetDir = path.join(targetRoot, safeSkillDirectoryName(skillName));
  const targetSkillFile = path.join(targetDir, "SKILL.md");

  if (sourceDir === targetDir) {
    return { name: skillName, path: targetSkillFile, copied: false };
  }
  if (fs.existsSync(targetDir)) {
    if (!fs.existsSync(targetSkillFile)) {
      throw new Error(`Kimi Code Skill 目录已存在但缺少 SKILL.md：${targetDir}`);
    }
    return { name: skillName, path: targetSkillFile, copied: false };
  }

  fs.mkdirSync(targetRoot, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true, errorOnExist: true });
  return { name: skillName, path: targetSkillFile, copied: true };
}
