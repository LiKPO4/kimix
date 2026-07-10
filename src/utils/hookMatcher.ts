const MAX_HOOK_MATCHER_LENGTH = 500;
const MAX_HOOK_TARGET_LENGTH = 4096;

export function hasBacktrackingRisk(pattern: string): boolean {
  if (/\\[1-9]/.test(pattern)) return true;
  if (/\([^()]*[*+?][^()]*\)[*+?]/.test(pattern)) return true;
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
