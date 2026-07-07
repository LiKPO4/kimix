import { describe, expect, it } from "vitest";
import { splitCjkTrailingTextFromAutolink } from "../markdownLinks";

describe("splitCjkTrailingTextFromAutolink", () => {
  it("splits Chinese punctuation and prose that GFM autolink can swallow", () => {
    expect(splitCjkTrailingTextFromAutolink("https://www.doubao.com/），由用户手动粘贴发送。")).toEqual({
      href: "https://www.doubao.com/",
      linkText: "https://www.doubao.com/",
      trailingText: "），由用户手动粘贴发送。",
    });
  });

  it("keeps plain URLs unchanged", () => {
    expect(splitCjkTrailingTextFromAutolink("https://www.doubao.com/")).toBeNull();
  });
});
