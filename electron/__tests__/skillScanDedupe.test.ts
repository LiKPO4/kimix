/**
 * dedupeScannedSkills 定向测试。
 *
 * 覆盖目标：
 * - 同名不同路径的 Skill 只保留先出现者（roots 扫描优先级），副本记入 mergedDuplicates；
 * - 名称大小写/首尾空白差异视为同一 Skill；
 * - Kimi Plugin 卡与本地 Skill 卡同名不合并；
 * - 空名条目不参与去重；
 * - 被合并副本的启用态并入保留项（旧配置按副本路径启用时不丢开关）。
 */
import { describe, expect, it } from "vitest";
import { dedupeScannedSkills, type ScannedSkillLike } from "../skillScanDedupe";

function skill(partial: Partial<ScannedSkillLike> & Pick<ScannedSkillLike, "name" | "path">): ScannedSkillLike {
  return { enabled: false, ...partial };
}

describe("dedupeScannedSkills", () => {
  it("同名不同路径只保留先出现者并记录合并明细", () => {
    const input = [
      skill({ name: "find-skills", path: "C:/u/.kimi-code/skills/find-skills/SKILL.md" }),
      skill({ name: "find-skills", path: "C:/u/.agents/skills/find-skills/SKILL.md" }),
      skill({ name: "frontend-design", path: "C:/u/.agents/skills/frontend-design/SKILL.md" }),
    ];
    const { skills, mergedDuplicates } = dedupeScannedSkills(input);
    expect(skills.map((item) => item.path)).toEqual([
      "C:/u/.kimi-code/skills/find-skills/SKILL.md",
      "C:/u/.agents/skills/frontend-design/SKILL.md",
    ]);
    expect(mergedDuplicates).toEqual([
      {
        name: "find-skills",
        keptPath: "C:/u/.kimi-code/skills/find-skills/SKILL.md",
        droppedPath: "C:/u/.agents/skills/find-skills/SKILL.md",
      },
    ]);
  });

  it("名称大小写与首尾空白差异视为同一 Skill", () => {
    const input = [
      skill({ name: "Find-Skills", path: "C:/a/SKILL.md" }),
      skill({ name: " find-skills ", path: "C:/b/SKILL.md" }),
    ];
    const { skills, mergedDuplicates } = dedupeScannedSkills(input);
    expect(skills).toHaveLength(1);
    expect(mergedDuplicates).toHaveLength(1);
  });

  it("kimi-official 插件卡与本地 Skill 卡同名不合并", () => {
    const input = [
      skill({ name: "superpowers", path: "C:/u/.kimi-code/plugins/superpowers/plugin.json", trustLevel: "kimi-official" }),
      skill({ name: "superpowers", path: "C:/u/.agents/skills/superpowers/SKILL.md", trustLevel: "local" }),
    ];
    const { skills, mergedDuplicates } = dedupeScannedSkills(input);
    expect(skills).toHaveLength(2);
    expect(mergedDuplicates).toHaveLength(0);
  });

  it("插件判定只看 trustLevel，sourceLabel 文案变化不影响去重", () => {
    const input = [
      skill({ name: "superpowers", path: "C:/u/.kimi-code/plugins/superpowers/plugin.json", trustLevel: "kimi-official", sourceLabel: "插件（文案已改版）" }),
      skill({ name: "superpowers", path: "C:/u/.agents/skills/superpowers/SKILL.md", trustLevel: "local", sourceLabel: "本地 Skill" }),
    ];
    const { skills, mergedDuplicates } = dedupeScannedSkills(input);
    expect(skills).toHaveLength(2);
    expect(mergedDuplicates).toHaveLength(0);
  });

  it("sourceLabel 写 Kimi Plugin 但 trustLevel 非 kimi-official 时仍按 skill 合并", () => {
    const input = [
      skill({ name: "legacy", path: "C:/a/SKILL.md", sourceLabel: "Kimi Plugin" }),
      skill({ name: "legacy", path: "C:/b/SKILL.md", sourceLabel: "本地 Skill" }),
    ];
    const { skills, mergedDuplicates } = dedupeScannedSkills(input);
    expect(skills).toHaveLength(1);
    expect(mergedDuplicates).toHaveLength(1);
  });

  it("空名条目不参与去重", () => {
    const input = [
      skill({ name: "  ", path: "C:/a/SKILL.md" }),
      skill({ name: "", path: "C:/b/SKILL.md" }),
    ];
    const { skills, mergedDuplicates } = dedupeScannedSkills(input);
    expect(skills).toHaveLength(2);
    expect(mergedDuplicates).toHaveLength(0);
  });

  it("被合并副本的启用态并入保留项", () => {
    const input = [
      skill({ name: "find-skills", path: "C:/a/SKILL.md", enabled: false }),
      skill({ name: "find-skills", path: "C:/b/SKILL.md", enabled: true }),
    ];
    const { skills } = dedupeScannedSkills(input);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.enabled).toBe(true);
  });

  it("无重复时原样返回", () => {
    const input = [
      skill({ name: "a", path: "C:/a/SKILL.md" }),
      skill({ name: "b", path: "C:/b/SKILL.md" }),
    ];
    const { skills, mergedDuplicates } = dedupeScannedSkills(input);
    expect(skills).toEqual(input);
    expect(mergedDuplicates).toEqual([]);
  });
});
