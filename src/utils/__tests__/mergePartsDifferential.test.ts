import { describe, expect, it } from "vitest";
import { mergeAssistantThinkingPartsSequential } from "../eventMapper";
import { appendCollapsedNormalized, collapseForOverlap } from "../thinkingBlocks";

// ============ 差分基线：用「全量归一化」的朴素实现重放同一批序列 ============
// 与 mergeAssistantThinkingPartsSequential 的语义基线一致：批内逐段
// 同 id 替换（仅变长时）、被覆盖段跳过、覆盖小段、按 timestamp 有序插入。
// 差异只允许出现在「增量归一化视图」——结果 parts 必须逐字段一致。

type Part = { id: string; text: string; timestamp: number };

function baselineMerge(batches: ReadonlyArray<Part[] | undefined>): Part[] {
  const parts: Part[] = [];
  for (const batch of batches) {
    if (!batch?.length) continue;
    for (const part of batch) {
      if (!part.text.trim()) continue;
      const sameIdx = parts.findIndex((p) => p.id === part.id);
      if (sameIdx !== -1) {
        if (part.text.length > parts[sameIdx].text.length) {
          parts[sameIdx] = { ...parts[sameIdx], ...part, timestamp: parts[sameIdx].timestamp, text: part.text };
        }
        continue;
      }
      const norm = (t: string) => collapseForOverlap(t).trim();
      const partNorm = norm(part.text);
      const coveredFrag = parts.some((p) => {
        const pn = norm(p.text);
        return pn.length >= partNorm.length && pn.includes(partNorm);
      });
      if (coveredFrag) continue;
      const coveredIdx = parts
        .map((p, index) => {
          const pn = norm(p.text);
          return pn && partNorm.length > pn.length && partNorm.includes(pn) ? index : -1;
        })
        .filter((index) => index !== -1);
      if (coveredIdx.length > 0) {
        const insertIndex = coveredIdx[0];
        const firstCovered = parts[insertIndex];
        const kept = parts.filter((_, index) => !coveredIdx.includes(index));
        kept.splice(insertIndex, 0, { ...firstCovered, ...part, text: part.text });
        parts.length = 0;
        parts.push(...kept);
        continue;
      }
      const tail = parts.length > 0 ? parts[parts.length - 1] : null;
      if (!tail || part.timestamp >= tail.timestamp) {
        parts.push({ ...part });
      } else {
        let low = 0;
        let high = parts.length;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (parts[mid].timestamp <= part.timestamp) low = mid + 1;
          else high = mid;
        }
        parts.splice(low, 0, { ...part });
      }
    }
    // 批末稳定排序：覆盖分支 splice / 同 id 保留原 ts 均可造成批内乱序，现实现
    // 在 changed 时做稳定 sort 兜底——基线必须复刻同一位置与语义。
    const needsSort = parts.some((p, index) => index > 0 && p.timestamp < parts[index - 1].timestamp);
    if (needsSort) {
      const ordered = parts.map((p, index) => ({ p, index }))
        .sort((l, r) => l.p.timestamp - r.p.timestamp || l.index - r.index);
      parts.length = 0;
      parts.push(...ordered.map((entry) => entry.p));
    }
  }
  return parts;
}

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const WORDS = ["分析", "代码", "结构", "调用", "边界", "重叠", "测试", "修复", "快照", "回放", "子代理", "思考", "内容", "片段", "流式", "归一"];
const SEPS = ["", " ", "\n", "  ", "\n\n", "\t", " \n "];

function makeText(rng: () => number, len: number): string {
  let out = "";
  while (out.length < len) {
    out += WORDS[Math.floor(rng() * WORDS.length)];
    out += SEPS[Math.floor(rng() * SEPS.length)];
  }
  return out.slice(0, len);
}

describe("mergeAssistantThinkingPartsSequential 差分对拍（全量归一化基线）", () => {
  it("500 轮随机批次：同 id 增长/碎片覆盖/乱序/空白差异", () => {
    const rng = makeRng(20260916);
    for (let round = 0; round < 500; round++) {
      const ids = Array.from({ length: 1 + Math.floor(rng() * 4) }, (_, i) => `id-${i}`);
      const texts = new Map<string, string>();
      ids.forEach((id) => texts.set(id, makeText(rng, 20 + Math.floor(rng() * 300))));
      const batches: Part[][] = [];
      let ts = 1_000;
      const batchCount = 1 + Math.floor(rng() * 8);
      for (let b = 0; b < batchCount; b++) {
        const batch: Part[] = [];
        const partCount = 1 + Math.floor(rng() * 6);
        for (let p = 0; p < partCount; p++) {
          const id = ids[Math.floor(rng() * ids.length)];
          const current = texts.get(id) ?? "";
          const kind = rng();
          let text: string;
          if (kind < 0.35) {
            // 前缀增长（流式）
            text = current + makeText(rng, 5 + Math.floor(rng() * 80));
          } else if (kind < 0.5) {
            // 缩短（不替换）
            text = current.slice(0, Math.max(1, current.length - 5));
          } else if (kind < 0.65 && current.length > 10) {
            // 真子串碎片（应被覆盖跳过）
            const start = Math.floor(rng() * (current.length - 8));
            text = current.slice(start, start + 4 + Math.floor(rng() * 6));
          } else if (kind < 0.8) {
            // 空白差异全量重发（等价内容）
            text = current.split("").join(rng() < 0.5 ? " " : "").slice(0, current.length + 10) || current;
          } else {
            // 全新内容
            text = makeText(rng, 10 + Math.floor(rng() * 200));
          }
          texts.set(id, text);
          ts += rng() < 0.15 ? -Math.floor(rng() * 30) : 1 + Math.floor(rng() * 10);
          batch.push({ id, text, timestamp: ts });
        }
        batches.push(batch);
      }
      const expected = baselineMerge(batches);
      const actual = mergeAssistantThinkingPartsSequential(undefined, batches as never) as Part[];
      expect(actual.map((p) => ({ id: p.id, text: p.text, timestamp: p.timestamp })))
        .toEqual(expected.map((p) => ({ id: p.id, text: p.text, timestamp: p.timestamp })));
    }
  });

  it("增量归一化视图与全量归一化一致（覆盖检查口径）", () => {
    const rng = makeRng(777);
    for (let round = 0; round < 300; round++) {
      let text = makeText(rng, 30);
      let view = collapseForOverlap(text);
      const steps = 1 + Math.floor(rng() * 10);
      for (let s = 0; s < steps; s++) {
        const addition = makeText(rng, 5 + Math.floor(rng() * 40));
        text += addition;
        view = appendCollapsedNormalized(view, collapseForOverlap(addition));
        expect(view.trim()).toBe(collapseForOverlap(text).trim());
      }
    }
  });
});