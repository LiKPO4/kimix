import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/utils/appVersion";
import packageJson from "../../../package.json";

describe("APP_VERSION", () => {
  it("matches the version in package.json", () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it("is a non-empty semantic version string", () => {
    expect(typeof APP_VERSION).toBe("string");
    expect(APP_VERSION.length).toBeGreaterThan(0);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
