import { useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import type { UiStyleDocumentV1 } from "../utils/uiStyleContract";

/**
 * 界面风格收件箱同步：/自定义风格 与设置页 AI 提示词引导 agent 把生成的
 * UI Style JSON 直接写入 ~/.kimix/ui-styles/，主进程监听并广播到这里。
 * - 新 id → upsert（与手动导入一致，自动启用）；
 * - 已有 id 内容变化 → 仅更新文档，不劫持用户当前的启用选择；
 * - 启动时兜底扫描一次，补导入应用关闭期间写入的文件。
 */
export function useUiStyleInboxSync() {
  useEffect(() => {
    const importDocuments = (documents: UiStyleDocumentV1[]) => {
      const applied: string[] = [];
      const updated: string[] = [];
      for (const document of documents) {
        const state = useAppStore.getState();
        const existing = state.customUiStyles.find((item) => item.id === document.id);
        if (!existing) {
          state.upsertCustomUiStyle(document);
          applied.push(document.name);
        } else if (JSON.stringify(existing) !== JSON.stringify(document)) {
          state.setCustomUiStyles(state.customUiStyles.map((item) => (item.id === document.id ? document : item)));
          updated.push(document.name);
        }
      }
      if (applied.length > 0) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `已自动导入并启用界面风格：${applied.join("、")}` }));
      }
      if (updated.length > 0) {
        window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `界面风格已更新：${updated.join("、")}` }));
      }
    };
    window.api.scanUiStyleInbox().then((res) => {
      if (res.success) importDocuments(res.data.documents);
    }).catch(() => {});
    return window.api.onUiStyleInbox((payload) => importDocuments(payload.documents));
  }, []);
}
