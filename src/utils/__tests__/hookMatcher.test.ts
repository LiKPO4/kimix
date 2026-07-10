import { describe, expect, it } from "vitest";
import { hasBacktrackingRisk, matchesHookTarget } from "@/utils/hookMatcher";

describe("hasBacktrackingRisk", () => {
  it("returns false for simple literals", () => {
    expect(hasBacktrackingRisk("hello")).toBe(false);
  });

  it("returns false for safe alternations with a single quantifier", () => {
    expect(hasBacktrackingRisk("(foo|bar)+")).toBe(false);
  });

  it("returns true for nested quantifiers", () => {
    expect(hasBacktrackingRisk("(a+)+")).toBe(true);
    expect(hasBacktrackingRisk("(a*)*")).toBe(true);
    expect(hasBacktrackingRisk("(a+)*")).toBe(true);
    expect(hasBacktrackingRisk("(a?)+")).toBe(true);
    expect(hasBacktrackingRisk("((a+)+)")).toBe(true);
    expect(hasBacktrackingRisk("((a+|b+)+)")).toBe(true);
  });

  it("returns true for backreferences", () => {
    expect(hasBacktrackingRisk("(\\w+)\\s+\\1")).toBe(true);
  });
});

describe("matchesHookTarget", () => {
  it("matches everything for wildcard matcher", () => {
    expect(matchesHookTarget(".*", "anything")).toBe(true);
    expect(matchesHookTarget(undefined, "anything")).toBe(true);
  });

  it("matches using regex for safe patterns", () => {
    expect(matchesHookTarget("test", "this is a Test string")).toBe(true);
    expect(matchesHookTarget("^test", "test string")).toBe(true);
    expect(matchesHookTarget("^test", "not test")).toBe(false);
  });

  it("falls back to substring matching for backtracking-risk patterns", () => {
    expect(matchesHookTarget("(a+)+$", "pattern (a+)+$ here")).toBe(true);
    expect(matchesHookTarget("(a+)+$", "bbb")).toBe(false);
  });

  it("falls back to substring matching for invalid regex", () => {
    expect(matchesHookTarget("[invalid", "[invalid pattern")).toBe(true);
  });
});
