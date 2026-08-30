import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { canonicalizeCustomUiStyleDocument } from "../src/utils/builtinUiStyleDocuments";
import { parseUiStyleDocument, type UiStyleDocumentV1 } from "../src/utils/uiStyleContract";

/**
 * Kimix 界面风格收件箱：/自定义风格 与设置页 AI 提示词引导 agent 把生成的
 * UI Style v1 JSON 直接写入该目录，主进程监听并广播给 renderer 自动导入启用，
 * 用户不再需要手动「导入界面风格」。
 */
export const UI_STYLE_INBOX_DIR = path.join(os.homedir(), ".kimix", "ui-styles");

const MAX_STYLE_FILE_BYTES = 256 * 1024;
const WATCH_DEBOUNCE_MS = 600;

export function ensureUiStyleInboxDir(dir: string = UI_STYLE_INBOX_DIR): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export type UiStyleInboxScanResult = {
  documents: UiStyleDocumentV1[];
  errors: { file: string; error: string }[];
};

function readInboxDocument(filePath: string): UiStyleDocumentV1 | null {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_STYLE_FILE_BYTES) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
  const parsed = parseUiStyleDocument(raw);
  if (!parsed.success) return null;
  return canonicalizeCustomUiStyleDocument(parsed.data);
}

export function scanUiStyleInbox(dir: string = UI_STYLE_INBOX_DIR): UiStyleInboxScanResult {
  const result: UiStyleInboxScanResult = { documents: [], errors: [] };
  try {
    ensureUiStyleInboxDir(dir);
    const files = fs.readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith(".json"))
      .sort();
    const byId = new Map<string, UiStyleDocumentV1>();
    for (const name of files) {
      try {
        const document = readInboxDocument(path.join(dir, name));
        if (document) byId.set(document.id, document);
      } catch (err) {
        result.errors.push({ file: name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    result.documents = [...byId.values()];
  } catch (err) {
    result.errors.push({ file: "", error: err instanceof Error ? err.message : String(err) });
  }
  return result;
}

/** 删除收件箱中所有解析后 id 匹配的风格文件，防止删除后的风格在下次扫描时复活。 */
export function deleteUiStyleInboxDocuments(styleId: string, dir: string = UI_STYLE_INBOX_DIR): string[] {
  const deleted: string[] = [];
  const normalizedId = styleId.trim().replace(/^custom:/, "");
  if (!normalizedId) return deleted;
  try {
    ensureUiStyleInboxDir(dir);
    for (const name of fs.readdirSync(dir)) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      const filePath = path.join(dir, name);
      try {
        const document = readInboxDocument(filePath);
        if (document && document.id === normalizedId) {
          fs.rmSync(filePath, { force: true });
          deleted.push(filePath);
        }
      } catch {
        // 单个文件损坏不阻塞其他文件的清理
      }
    }
  } catch {
    // 目录不可用时静默失败：设置里的删除已生效，收件箱残留只会在下次扫描时重新导入
  }
  return deleted;
}

/**
 * 监听收件箱目录变化。启动时先 priming 一次指纹（不广播），之后只在文件
 * 新增/内容变化时广播变化的风格文档；renderer 启动扫描负责历史补导入。
 */
export function startUiStyleInboxWatcher(onChanged: (documents: UiStyleDocumentV1[]) => void): () => void {
  let watcher: fs.FSWatcher | null = null;
  let timer: NodeJS.Timeout | null = null;
  let fingerprints = new Map<string, string>();
  const fingerprint = (documents: UiStyleDocumentV1[]) =>
    new Map(documents.map((document) => [document.id, JSON.stringify(document)]));
  try {
    ensureUiStyleInboxDir();
    fingerprints = fingerprint(scanUiStyleInbox().documents);
    watcher = fs.watch(UI_STYLE_INBOX_DIR, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const { documents } = scanUiStyleInbox();
        const changed = documents.filter((document) => fingerprints.get(document.id) !== JSON.stringify(document));
        fingerprints = fingerprint(documents);
        if (changed.length > 0) onChanged(changed);
      }, WATCH_DEBOUNCE_MS);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    watcher = null;
  }
  return () => {
    watcher?.close();
    if (timer) clearTimeout(timer);
  };
}
