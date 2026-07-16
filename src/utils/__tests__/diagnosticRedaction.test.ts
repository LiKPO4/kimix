import { describe, expect, it } from "vitest";
import { redactDiagnosticData } from "@/utils/diagnosticRedaction";

describe("redactDiagnosticData", () => {
  it("removes message bodies, tool results, paths and image data", () => {
    expect(redactDiagnosticData({
      localBody: "private assistant text",
      result: { output: "tool secret" },
      filePath: "C:\\Users\\name\\secret.txt",
      image: "data:image/png;base64,AAAA",
      message: "failed at C:\\Users\\name\\secret.txt",
      count: 3,
    })).toEqual({
      localBody: "[redacted]",
      result: "[redacted]",
      filePath: "[redacted]",
      image: "[redacted-data-url]",
      message: "failed at [redacted-path]",
      count: 3,
    });
  });

  it("preserves non-sensitive structured metadata", () => {
    expect(redactDiagnosticData({ sessionId: "s-1", eventTypes: { tool_call: 2 }, contentLength: 42 })).toEqual({
      sessionId: "s-1",
      eventTypes: { tool_call: 2 },
      contentLength: 42,
    });
  });
});
