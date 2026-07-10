const MAX_HOOK_MATCHER_LENGTH = 500;
const MAX_HOOK_TARGET_LENGTH = 4096;

function containsQuantifierOutsideCharClass(s: string): boolean {
  let inCharClass = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[" && !inCharClass) {
      inCharClass = true;
    } else if (ch === "]" && inCharClass) {
      inCharClass = false;
    } else if (!inCharClass && /[*+?{]/.test(ch)) {
      return true;
    }
  }
  return false;
}

export function hasBacktrackingRisk(pattern: string): boolean {
  if (/\\[1-9]/.test(pattern)) return true;

  // Detect nested quantifiers such as (a+)+ or ((a+)+) by scanning for any
  // parenthesized group that is itself quantified and contains a quantifier.
  const stack: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "(") {
      stack.push(i);
    } else if (ch === ")" && stack.length > 0) {
      const openIndex = stack.pop()!;
      if (i + 1 < pattern.length && /[*+?{]/.test(pattern[i + 1])) {
        const inner = pattern.slice(openIndex + 1, i);
        if (containsQuantifierOutsideCharClass(inner)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function matchesHookTarget(matcher: string | undefined, target: string): boolean {
  const trimmed = matcher?.trim();
  if (!trimmed || trimmed === ".*") return true;
  if (trimmed.length > MAX_HOOK_MATCHER_LENGTH) return false;
  const input = target.length > MAX_HOOK_TARGET_LENGTH ? target.slice(0, MAX_HOOK_TARGET_LENGTH) : target;
  if (hasBacktrackingRisk(trimmed)) {
    return input.toLowerCase().includes(trimmed.toLowerCase());
  }
  try {
    return new RegExp(trimmed, "i").test(input);
  } catch {
    return input.toLowerCase().includes(trimmed.toLowerCase());
  }
}
