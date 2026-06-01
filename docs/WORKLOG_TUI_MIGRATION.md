# 过夜 Worklog —— TUI 迁移 阶段 A/B/C

> 时间：2026-06-01 凌晨～早晨，无人值守连续执行。
> 基线提交：8b8f506b（v2.8.215，已推送留档）。
> 本轮版本：**v2.8.216**（三处已同步，未提交、未推送，等你实机验收）。

---

## 本轮做了什么（按计划第 6 节阶段推进）

### 阶段 A —— 核实并修正计划（无代码改动）

计划旧稿写“wire 路径缺 `session_<uuid>` 层”是**我误判**。
我用真实文件系统脚本验证了 `electron/tuiHost.ts` 的 `findKimiSessionDir`：

- 计算 bucket `wd_kimix_90b5212d0d7e` 与真实目录**完全匹配**。
- 已正确按 `bucketDir/session_<uuid>/agents/main/wire.jsonl` 两层定位。
- 93 个 session 全部解析到 wire，latest 锁定正确。

结论：**wire 路径解析本来就对，不改**（不为改而改）。

### 阶段 B —— steer（Ctrl+S 立即注入）

官方确认 steer = `Ctrl+S`（运行中立即注入当前 turn），与 Enter 排队严格区分。

改动：
- `electron/types/ipc.ts`：`SendTuiInputRequest` 加 `submit?: "enter" | "steer"`；`TuiKeyName` 加 `"ctrlS"`。
- `electron/tuiHost.ts`：键序列加 `ctrlS = \x13`；`sendTuiInput` 支持 `submit==="steer"` 时用 `\x13` 结尾（而非 `\r`）。
- `electron/main.ts`：`tui:sendInput` 透传 `submit`。
- `src/components/chat/Composer.tsx`：新增 `handleSteer()`；运行中且 TUI 引擎且有输入时，停止按钮左侧出现蓝色「引导」按钮（Zap 图标）。点击 → `sendTuiInput({submit:"steer"})`，并在时间线追加 `已引导当前任务：…` 状态。普通 Enter 仍只排队。

### 阶段 C —— 图片 Ctrl+V 原生剪贴板粘贴（探针，零破坏）

按计划纪律“先探针后切换”。**没有**动现有图片主链路（仍是已验证可用的路径直发 `materializeTuiInputImages`），
只新增了一个**调试页探针**，让你能实机验证官方 Ctrl+V 原生粘贴是否可行。

改动：
- `electron/types/ipc.ts`：`TuiKeyName` 加 `"ctrlV"`；新增 `ProbeTuiClipboardImageRequest`。
- `electron/tuiHost.ts`：键序列加 `ctrlV = \x16`。
- `electron/main.ts`：`tui:sendKey` 白名单补 `ctrlS/ctrlV`；新增 `tui:probeClipboardImage` —— `nativeImage.createFromDataURL` + `clipboard.writeImage` 写系统剪贴板，停 80ms 后发 `Ctrl+V`。
- `electron/preload.ts` + `src/main.tsx`：暴露 `probeTuiClipboardImage`。
- `src/components/layout/TuiDebugPanel.tsx`：停止按钮旁新增「剪贴板图片探针」按钮 + 隐藏 file input。

---

## 自验结果（已全绿）

- `pnpm build`：通过。
- `npx vitest run src/utils/__tests__/tuiSemanticReducer.test.ts`：3/3 通过。
- `git diff --check`：干净（仅 LF/CRLF warning）。
- `tsc --noEmit`：与干净树基线逐行对比，**本轮零新增类型错误**（仓库本就有大量预存 tsc 报错，esbuild 构建不做 tsc 门禁）。
- 预存失败：`src/utils/__tests__/sessionTitle.test.ts` 2 个用例 —— stash 后干净树同样失败，**与本轮无关**。

---

## 需要你实机验收的项

### B. steer 引导
1. 开 TUI 引擎，发一个长任务让当前轮运行中。
2. 输入框打字 → 看停止按钮左边出现蓝色「引导」按钮。
3. 点「引导」→ 看 TUI 调试页 Wire/Semantic：该文本是否**立即注入当前 turn**（不是等下一轮）。
4. 对照：普通 Enter 仍进排队，不立即注入。

### C. 剪贴板图片探针（决定下一步方向）
1. 进 TUI 调试页，启动/选中一个 running 会话。
2. 点「剪贴板图片探针」→ 选桌面图片（如 `C:\Users\Administrator\Desktop\原始数据\1.png`）。
3. 看 **Screen**：输入框是否出现官方 `[image:…]` 占位。
4. 看 **Wire/Semantic**：是否出现 `ReadMediaFile`。
5. 判定：
   - **成功**（出现 `[image:…]`）→ 下一轮把图片主链路从“路径直发”切到“剪贴板 + Ctrl+V”，正式去掉路径包装。
   - **失败**（无占位）→ 保留路径直发过渡态，记录原因，再探 bracketed paste / OSC 等其它入口，**绝不回退 prompt 包装**。

---

## 下一轮建议（取决于你 C 的验收结果）

- C 成功：阶段 C-切换（改 `materializeTuiInputImages` 链路为剪贴板粘贴，Composer 图片发送走新路径）。
- C 失败：继续探针（其它粘贴协议）。
- 无论 C 结果：可并行推进**阶段 D**（`/fork` `/undo` `/compact` `/import` `/title` `/add-dir` 接入），它们与图片无关。

## 注意
- v2.8.216 **未提交未推送**，按硬规则等你验收。
- 改动文件：`docs/KIMIX_TUI_ENGINE_MIGRATION_PLAN.md`、`docs/WORKLOG_TUI_MIGRATION.md`(本文)、`electron/{types/ipc.ts,tuiHost.ts,main.ts,preload.ts}`、`src/main.tsx`、`src/components/chat/Composer.tsx`、`src/components/layout/{TuiDebugPanel.tsx,Sidebar.tsx}`、`src/components/settings/SettingsPanel.tsx`、`package.json`。
