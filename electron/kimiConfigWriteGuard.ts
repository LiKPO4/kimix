import fs from "node:fs";

export function writeKimiConfigTomlIfUnchanged(configPath: string, expectedCurrent: string, next: string) {
  const latest = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
  if (latest !== expectedCurrent) {
    throw new Error("Kimi Code 配置已被其他程序修改，本次保存已取消。请刷新设置后重试。");
  }
  fs.writeFileSync(configPath, next, "utf-8");
}
