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

function readSkillName(skillFile: string, fallbackName: string) {
  const content = fs.readFileSync(skillFile, "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const nameLine = frontmatter?.[1].split(/\r?\n/).find((line) => line.trim().startsWith("name:"));
  return nameLine?.slice(nameLine.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "") || fallbackName;
}

function rewriteCopiedSkillName(skillFile: string, name: string) {
  const lines = fs.readFileSync(skillFile, "utf8").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return;
  const frontmatterEnd = lines.slice(1).findIndex((line) => line.trim() === "---");
  if (frontmatterEnd < 0) return;
  const nameIndex = lines.slice(1, frontmatterEnd + 1).findIndex((line) => line.trim().startsWith("name:"));
  if (nameIndex < 0) return;
  lines[nameIndex + 1] = `name: ${name}`;
  fs.writeFileSync(skillFile, lines.join("\n"), "utf8");
}

export function syncAgentSkillDirectories(agentSkillsRoot: string, kimiHome: string) {
  if (!fs.existsSync(agentSkillsRoot)) {
    return { names: [], copiedNames: [], latestModifiedAt: 0, warnings: [] };
  }

  const names: string[] = [];
  const copiedNames: string[] = [];
  const warnings: string[] = [];
  let latestModifiedAt = 0;
  const syncSubSkills = (parentDir: string, parentName: string, relativeParts: string[] = []) => {
    for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const sourceDir = path.join(parentDir, entry.name);
      const skillFile = path.join(sourceDir, "SKILL.md");
      const nextParts = [...relativeParts, entry.name];
      if (fs.existsSync(skillFile)) {
        const routeName = `${parentName}/${nextParts.join("/")}`;
        try {
          const result = prepareSkillDirectoryForKimi(skillFile, routeName, kimiHome);
          names.push(routeName);
          if (result.copied) {
            rewriteCopiedSkillName(result.path, routeName);
            copiedNames.push(routeName);
          }
          latestModifiedAt = Math.max(latestModifiedAt, fs.statSync(skillFile).mtimeMs);
        } catch (error) {
          warnings.push(`${routeName}：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      syncSubSkills(sourceDir, parentName, nextParts);
    }
  };
  for (const entry of fs.readdirSync(agentSkillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillFile = path.join(agentSkillsRoot, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      const name = readSkillName(skillFile, entry.name);
      const result = prepareSkillDirectoryForKimi(skillFile, name, kimiHome);
      names.push(name);
      if (result.copied) copiedNames.push(name);
      latestModifiedAt = Math.max(latestModifiedAt, fs.statSync(skillFile).mtimeMs);
      syncSubSkills(path.join(agentSkillsRoot, entry.name), name);
    } catch (error) {
      warnings.push(`${entry.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    names,
    copiedNames,
    // A newly flattened Skill is a registry change even when its source mtime
    // predates the current session (common after installing a packaged bundle).
    latestModifiedAt: copiedNames.length > 0 ? Date.now() : latestModifiedAt,
    warnings,
  };
}
