import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const CONFIG_CHANGED_MESSAGE = "Kimi Code 配置已被其他程序修改，本次保存已取消。请刷新设置后重试。";

function readCurrent(configPath: string): string {
  return fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : "";
}

export function writeKimiConfigTomlIfUnchanged(configPath: string, expectedCurrent: string, next: string) {
  if (readCurrent(configPath) !== expectedCurrent) throw new Error(CONFIG_CHANGED_MESSAGE);

  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(configPath)}.kimix-${process.pid}-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(tempPath, "wx");
    try {
      fs.writeFileSync(fd, next, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // Writing the temporary file can take long enough for another Kimi client to
    // save in between. Recheck immediately before replacement to preserve the
    // compare-before-write contract across that window.
    if (readCurrent(configPath) !== expectedCurrent) throw new Error(CONFIG_CHANGED_MESSAGE);
    fs.renameSync(tempPath, configPath);
  } finally {
    try { fs.rmSync(tempPath, { force: true }); } catch {}
  }
}
