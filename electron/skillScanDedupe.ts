/**
 * Skill 扫描结果按名称去重。
 *
 * 背景：scanSkillsWithDiagnostics 会扫多个技能根目录（~/.kimix/skills、
 * ~/.kimi-code/skills、~/.agents/skills 等），同一份 Skill 经常同时存在于
 * ~/.kimi-code/skills 与 ~/.agents/skills。旧逻辑只按绝对路径去重，
 * 导致同名 Skill 在插件页出现两张卡片。
 *
 * 调用方必须按扫描优先级（roots 数组顺序）传入，同名保留先出现者；
 * 被合并的副本记录进 mergedDuplicates，供 UI 明示，不静默吞掉。
 */

export type ScannedSkillLike = {
  name: string;
  path: string;
  sourceLabel?: string;
  trustLevel?: "kimi-official" | "curated" | "third-party" | "local";
  enabled?: boolean;
};

export type SkillMergedDuplicate = {
  name: string;
  keptPath: string;
  droppedPath: string;
};

function dedupeKey(skill: ScannedSkillLike): string {
  // 插件清单卡片与本地 Skill 卡片是两类实体，同名也不合并。
  // 用 trustLevel 枚举判断插件（main.ts 中 .kimi-code/plugins 产物恒为 kimi-official），
  // 不依赖 UI 文案 sourceLabel，避免文案调整导致同名插件与本地 Skill 被误合并或失去隔离。
  const kind = skill.trustLevel === "kimi-official" ? "plugin" : "skill";
  return `${kind}:${skill.name.trim().toLowerCase()}`;
}

export function dedupeScannedSkills<T extends ScannedSkillLike>(
  skills: readonly T[],
): { skills: T[]; mergedDuplicates: SkillMergedDuplicate[] } {
  const seen = new Map<string, T>();
  const kept: T[] = [];
  const mergedDuplicates: SkillMergedDuplicate[] = [];

  for (const skill of skills) {
    if (!skill.name.trim()) {
      kept.push(skill);
      continue;
    }
    const key = dedupeKey(skill);
    const existing = seen.get(key);
    if (existing) {
      // 旧配置可能按被合并副本的路径标记启用，启用态取并集避免丢开关。
      if (skill.enabled) existing.enabled = true;
      mergedDuplicates.push({ name: skill.name, keptPath: existing.path, droppedPath: skill.path });
      continue;
    }
    seen.set(key, skill);
    kept.push(skill);
  }

  return { skills: kept, mergedDuplicates };
}
