import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const sdkEntry = path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");
const skillsDir = argument("--skills-dir");
const workDir = argument("--work-dir");

if (!skillsDir || !path.isAbsolute(skillsDir)) throw new Error("--skills-dir 必须是绝对路径");
if (!workDir || !path.isAbsolute(workDir)) throw new Error("--work-dir 必须是绝对路径");

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-extra-skill-probe-"));
const sdk = await import(pathToFileURL(sdkEntry).href);
const harness = sdk.createKimiHarnessV2({
  homeDir,
  identity: { productName: "Kimix", version: "extra-skill-probe", platform: "kimi_code_desktop" },
  uiMode: "extra-skill-probe",
});

try {
  await harness.setConfig({
    extraSkillDirs: [skillsDir],
    providers: { probe: { type: "openai", apiKey: "probe", baseUrl: "http://127.0.0.1:1" } },
    models: { "probe/model": { provider: "probe", model: "model", maxContextSize: 128000, maxOutputSize: 8192 } },
    defaultModel: "probe/model",
  });
  const session = await harness.createSession({ workDir, model: "probe/model" });
  try {
    const skills = await session.listSkills();
    console.log(JSON.stringify({
      ok: true,
      configuredDirs: (await harness.getConfig({ reload: true })).extraSkillDirs ?? [],
      skills: skills.map((skill) => ({ name: skill.name, path: skill.path, source: skill.source })),
    }, null, 2));
  } finally {
    await session.close();
  }
} finally {
  await harness.close();
  fs.rmSync(homeDir, { recursive: true, force: true });
}
